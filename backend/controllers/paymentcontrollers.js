import prisma from "../prisma/client.js";
import { getAcademicYear } from "../utils/academicYear.js";
import { autoPromoteIfEligible } from "./studentcontrollers.js";
import { sendFeePaidWhatsAppNotification } from "../services/whatsappservice.js";
import {
  isPaymentSchemaCompatibilityError,
  legacyPaymentSelect,
  logPaymentCompatibilityFallback,
  stripExtendedPaymentWriteData,
} from "../utils/paymentCompat.js";

const paymentStudentListSelect = {
  id: true,
  name: true,
  class: true,
  school: true,
  phone: true,
  email: true,
};

const formatGatewayProviderLabel = (provider) => {
  switch (String(provider || "").toUpperCase()) {
    case "CASHFREE":
      return "Cashfree";
    case "PHONEPE":
      return "PhonePe";
    case "CASH":
      return "Cash";
    default:
      return "Online Payment";
  }
};

const formatPaymentMethodLabel = ({ payment, gatewayOrder, latestAttempt }) => {
  const rawMethod =
    latestAttempt?.paymentMethod ||
    gatewayOrder?.paymentMethod ||
    gatewayOrder?.paymentMethodHint ||
    payment?.paymentProvider ||
    "";

  switch (String(rawMethod || "").trim().toUpperCase()) {
    case "UPI":
      return "UPI";
    case "CC":
    case "DC":
    case "CARD":
      return "Card";
    case "NB":
    case "NETBANK":
    case "NETBANKING":
      return "Net Banking";
    case "PHONEPE":
      return "UPI";
    case "CASHFREE":
      return "Online Payment";
    case "CASH":
      return "Cash";
    default:
      return rawMethod ? String(rawMethod) : "Online Payment";
  }
};

const buildReceiptMeta = ({ payment, gatewayOrder }) => {
  const latestAttempt = gatewayOrder?.attempts?.[0] || null;
  const paymentGateway = gatewayOrder?.provider
    ? formatGatewayProviderLabel(gatewayOrder.provider)
    : payment?.phonepeTransactionId
      ? "PhonePe"
      : "Online Payment";
  const paymentDate =
    gatewayOrder?.paidAt ||
    latestAttempt?.paymentTime ||
    payment?.paidAt ||
    payment?.createdAt ||
    null;

  return {
    receiptNumber: `FL-${payment.academicYear}-${String(payment.id).padStart(6, "0")}`,
    paymentDate,
    paymentMethod: formatPaymentMethodLabel({ payment, gatewayOrder, latestAttempt }),
    paymentGateway,
    cashfreeOrderId: gatewayOrder?.cashfreeOrderId || null,
    cashfreeCfOrderId: gatewayOrder?.cashfreeCfOrderId || null,
    cashfreePaymentId: latestAttempt?.cfPaymentId || null,
    internalReferenceId: gatewayOrder?.id || String(payment.id),
    transactionId:
      payment?.phonepeTransactionId ||
      payment?.phonepePaymentId ||
      latestAttempt?.gatewayPaymentId ||
      latestAttempt?.cfPaymentId ||
      null,
    gatewayReference:
      gatewayOrder?.gatewayReference ||
      latestAttempt?.gatewayOrderReference ||
      latestAttempt?.bankReference ||
      null,
  };
};

const parsePositiveInt = (value, fallback, max = 100) => {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, max);
};

const normalizeDateBoundary = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
};
/**
 * Academic Year Logic
 * Academic session = March → February
 * Example:
 *  - April 2024 → academicYear 2024
 *  - January 2025 → academicYear 2024
 */
const getCurrentAcademicYear = () => {
  const now = new Date();
  const month = now.getMonth(); // 0 = Jan, 2 = March
  return month >= 2 ? now.getFullYear() : now.getFullYear() - 1;
};

// ===============================
// CREATE PAYMENT (Student / Gateway)
// ===============================
export const makePayment = async (req, res) => {
  try {
    const { studentId, amount, month, status } = req.body;

    if (!studentId || !month || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const academicYear = getCurrentAcademicYear();

    // Prevent duplicate month payment in same academic year
    const existing = await prisma.payment.findFirst({
      where: {
        studentId: Number(studentId),
        month,
        academicYear,
        status: "paid",
      },
    });

    if (existing) {
      return res.status(400).json({ message: "This month already paid" });
    }

    const paymentData = {
      studentId: Number(studentId),
      amount,
      month,
      status: status || "paid",
      currency: "INR",
      paymentProvider: status === "paid" ? "CASH" : null,
      paidAt: status === "paid" ? new Date() : null,
      teacherAdminId: req.userRole === "admin" ? Number(req.user?.id) : null,
      academicYear,
    };

    let payment;
    try {
      payment = await prisma.payment.create({ data: paymentData });
    } catch (err) {
      if (!isPaymentSchemaCompatibilityError(err)) throw err;
      logPaymentCompatibilityFallback("makePayment", err);
      payment = await prisma.payment.create({
        data: stripExtendedPaymentWriteData(paymentData),
      });
    }

    res.json(payment);
  } catch (err) {
    console.error("makePayment error:", err);
    res.status(500).json({ error: "Payment failed" });
  }
};

// ===============================
// STUDENT: GET OWN PAYMENTS (CURRENT SESSION)
// ===============================
export const getMyPayments = async (req, res) => {
  try {
    if (req.userRole !== "student") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const academicYear = getCurrentAcademicYear();

    const payments = await prisma.payment.findMany({
      where: {
        studentId: req.user.id,
        academicYear,
      },
      select: legacyPaymentSelect,
      orderBy: {
        createdAt: "asc",
      },
    });

    if (!payments.length) {
      return res.json(payments);
    }

    try {
      const gatewayOrders = await prisma.paymentGatewayOrder.findMany({
        where: {
          paymentId: {
            in: payments.map((payment) => payment.id),
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          paymentId: true,
          provider: true,
          paymentMethod: true,
          paymentMethodHint: true,
          cashfreeOrderId: true,
          cashfreeCfOrderId: true,
          gatewayReference: true,
          paidAt: true,
          attempts: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              cfPaymentId: true,
              paymentMethod: true,
              gatewayPaymentId: true,
              gatewayOrderReference: true,
              bankReference: true,
              paymentTime: true,
            },
          },
        },
      });

      const latestGatewayOrderByPaymentId = new Map();
      for (const gatewayOrder of gatewayOrders) {
        if (!latestGatewayOrderByPaymentId.has(gatewayOrder.paymentId)) {
          latestGatewayOrderByPaymentId.set(gatewayOrder.paymentId, gatewayOrder);
        }
      }

      return res.json(
        payments.map((payment) => ({
          ...payment,
          receiptMeta: buildReceiptMeta({
            payment,
            gatewayOrder: latestGatewayOrderByPaymentId.get(payment.id) || null,
          }),
        }))
      );
    } catch (gatewayError) {
      console.warn(
        "getMyPayments receipt metadata fallback:",
        gatewayError?.message || gatewayError
      );
      return res.json(
        payments.map((payment) => ({
          ...payment,
          receiptMeta: buildReceiptMeta({
            payment,
            gatewayOrder: null,
          }),
        }))
      );
    }
  } catch (err) {
    console.error("getMyPayments error:", err);
    res.status(500).json({ message: "Failed to fetch payments" });
  }
};

// ===============================
// ADMIN: GET ALL PAYMENTS (ALL YEARS)
// ===============================
export const getAllPayments = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const shouldPaginate = "page" in req.query || "limit" in req.query;
    const page = parsePositiveInt(req.query.page, 1, 10_000);
    const limit = parsePositiveInt(req.query.limit, 25, 100);
    const paymentSelect = {
      ...legacyPaymentSelect,
      student: {
        select: paymentStudentListSelect,
      },
    };

    if (!shouldPaginate) {
      const payments = await prisma.payment.findMany({
        select: paymentSelect,
        orderBy: { createdAt: "desc" },
      });

      return res.json(payments);
    }

    const [totalPayments, payments] = await Promise.all([
      prisma.payment.count(),
      prisma.payment.findMany({
        select: paymentSelect,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return res.json({
      payments,
      totalPayments,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(totalPayments / limit)),
    });
  } catch (err) {
    console.error("getAllPayments error:", err);
    res.status(500).json({ message: "Failed to fetch payments" });
  }
};

// ===============================
// ADMIN: MARK CASH PAYMENT (CURRENT SESSION)
// ===============================


export const markPaid = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { studentId, month } = req.body;

    if (!studentId || !month) {
      return res.status(400).json({ message: "studentId and month required" });
    }

    const academicYear = getAcademicYear();

    // Prevent duplicate payment for same month & year
    const existing = await prisma.payment.findFirst({
      where: {
        studentId: Number(studentId),
        month,
        academicYear,
        status: "paid",
      },
    });

    if (existing) {
      return res.status(400).json({ message: "This month already paid" });
    }

    const appSettings = await prisma.appSettings.findUnique({
      where: { id: 1 },
    });

    if (!appSettings) {
      return res.status(500).json({ message: "App settings not found" });
    }

    // ✅ CREATE PAYMENT
    const paymentData = {
      studentId: Number(studentId),
      month,
      academicYear,
      amount: appSettings.monthlyFee,
      status: "paid",
      currency: "INR",
      paymentProvider: "CASH",
      paidAt: new Date(),
      teacherAdminId: Number(req.user?.id),
    };

    let payment;
    try {
      payment = await prisma.payment.create({ data: paymentData });
    } catch (err) {
      if (!isPaymentSchemaCompatibilityError(err)) throw err;
      logPaymentCompatibilityFallback("markPaid", err);
      payment = await prisma.payment.create({
        data: stripExtendedPaymentWriteData(paymentData),
      });
    }

    const student = await prisma.student.findUnique({
      where: { id: Number(studentId) },
      select: { id: true, name: true, phone: true },
    });

    if (student) {
      sendFeePaidWhatsAppNotification({
        student,
        payment,
        mode: "cash",
      }).catch((err) => {
        console.error("WhatsApp fee-paid send failed (cash):", err.message);
      });
    }

    // Promote immediately when all 12 months of this academic year are paid.
    await autoPromoteIfEligible(Number(studentId), academicYear);

    res.json({
      message: "Payment marked successfully",
      payment,
    });

  } catch (err) {
    console.error("markPaid error:", err);
    res.status(500).json({ message: "Failed to mark payment" });
  }
};


// ===============================
// ADMIN: TOTAL REVENUE (ALL YEARS)
// ===============================
export const getTotalRevenue = async (req, res) => {
  try {
    if (!req.user || req.userRole !== "admin") {
      return res.json({ totalRevenue: 0 });
    }

    const fromDate =
      req.query.from && !normalizeDateBoundary(req.query.from)
        ? null
        : normalizeDateBoundary(req.query.from);
    const toDate =
      req.query.to && !normalizeDateBoundary(req.query.to, true)
        ? null
        : normalizeDateBoundary(req.query.to, true);

    if ((req.query.from && !fromDate) || (req.query.to && !toDate)) {
      return res.status(400).json({ message: "Invalid date filter" });
    }

    const dateWhere = {};
    if (fromDate) dateWhere.gte = fromDate;
    if (toDate) dateWhere.lte = toDate;

    const baseWhere = Object.keys(dateWhere).length
      ? { createdAt: dateWhere }
      : {};

    const [grossResult, paidResult] = await Promise.all([
      prisma.payment.aggregate({
        _sum: {
          amount: true,
        },
        where: baseWhere,
      }),
      prisma.payment.aggregate({
        _sum: {
          amount: true,
        },
        where: {
          ...baseWhere,
          status: "paid",
        },
      }),
    ]);

    res.json({
      totalRevenue: paidResult._sum.amount ?? 0,
      paidRevenue: paidResult._sum.amount ?? 0,
      grossRevenue: grossResult._sum.amount ?? 0,
    });
  } catch (err) {
    console.error("Revenue error:", err);
    res.json({ totalRevenue: 0 });
  }
};

// ===============================
// ADMIN: SET MONTHLY FEE
// ===============================
export const setMonthlyFee = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { fee } = req.body;
    const numericFee = Number(fee);

    if (!numericFee || numericFee <= 0) {
      return res.status(400).json({ message: "Valid fee is required" });
    }

    await prisma.appSettings.upsert({
      where: { id: 1 },
      update: { monthlyFee: numericFee },
      create: { id: 1, monthlyFee: numericFee },
    });

    res.json({
      message: `Monthly fee updated to ₹${numericFee}.`,
    });
  } catch (err) {
    console.error("setMonthlyFee error:", err);
    res.status(500).json({ message: "Failed to update monthly fee" });
  }
};
