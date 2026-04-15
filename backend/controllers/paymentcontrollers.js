import prisma from "../prisma/client.js";
import { getAcademicYear } from "../utils/academicYear.js";
import { isLatePaymentForPeriod } from "../utils/paymentPeriod.js";
import { autoPromoteIfEligible } from "./studentcontrollers.js";
import { sendFeePaidWhatsAppNotification } from "../services/whatsappservice.js";
import {
  isPaymentSchemaCompatibilityError,
  legacyPaymentSelect,
  logPaymentCompatibilityFallback,
  stripExtendedPaymentWriteData,
} from "../utils/paymentCompat.js";
import { buildRequestLogMeta, logInfo, logWarn } from "../utils/appLogger.js";

const isUniqueConstraintError = (error) => error?.code === "P2002";
const isDevelopmentPaymentTestMode = process.env.NODE_ENV === "development";

const createUserFacingError = (status, message, extra = {}) => {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
};

const buildAuditMessage = ({
  studentId,
  month,
  previousStatus,
  newStatus,
  adminId,
  action = "updated",
}) =>
  `Payment ${action}: student ${studentId} | ${month} | ${previousStatus} → ${newStatus} | by admin ${adminId}`;

const buildAffectedStudentEntry = ({
  student = null,
  payment = null,
  month = null,
  previousStatus = null,
  newStatus = null,
}) => ({
  studentId: Number(student?.id || payment?.studentId || 0) || null,
  name: student?.name || null,
  month: month || payment?.month || null,
  academicYear: payment?.academicYear || null,
  paymentId: payment?.id || null,
  previousStatus,
  newStatus,
  isLatePayment: Boolean(payment?.isLatePayment),
});

const buildFailedStudentEntry = ({
  studentId,
  name = null,
  month = null,
  reason,
  code = null,
}) => ({
  studentId: Number(studentId || 0) || null,
  name,
  month,
  reason,
  code,
});

const buildPaymentActionResponse = ({
  success,
  message,
  affectedStudents = [],
  failedStudents = [],
  extra = {},
}) => ({
  success,
  message,
  affectedStudents,
  failedStudents,
  meta: {
    testMode: isDevelopmentPaymentTestMode,
    timestampUtc: new Date().toISOString(),
  },
  ...extra,
});

const paymentStudentListSelect = {
  id: true,
  name: true,
  class: true,
  school: true,
  phone: true,
  email: true,
};

const VALID_PAYMENT_MONTHS = new Set([
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
]);

const paymentReadSelect = {
  ...legacyPaymentSelect,
  paymentProvider: true,
  paidAt: true,
  isLatePayment: true,
};

const buildPaymentStatusLabel = (payment, paymentDateOverride = null) => {
  const isLate =
    payment?.isLatePayment ??
    isLatePaymentForPeriod({
      month: payment?.month,
      academicYear: payment?.academicYear,
      paidAt: paymentDateOverride || payment?.paidAt || payment?.createdAt,
    });

  if (String(payment?.status || "").toLowerCase() === "paid" && isLate) {
    return "Late Payment";
  }

  return String(payment?.status || "created")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
  if (String(payment?.paymentProvider || "").trim().toUpperCase() === "CASH") {
    return "Cash";
  }

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
  const effectiveGatewayOrder =
    String(payment?.paymentProvider || "").trim().toUpperCase() === "CASH"
      ? null
      : gatewayOrder;
  const latestAttempt = effectiveGatewayOrder?.attempts?.[0] || null;
  let paymentGateway = "Online Payment";
  if (String(payment?.paymentProvider || "").trim().toUpperCase() === "CASH") {
    paymentGateway = "Cash";
  } else if (effectiveGatewayOrder?.provider) {
    paymentGateway = formatGatewayProviderLabel(effectiveGatewayOrder.provider);
  } else if (payment?.phonepeTransactionId) {
    paymentGateway = "PhonePe";
  }
  const paymentDate =
    effectiveGatewayOrder?.paidAt ||
    latestAttempt?.paymentTime ||
    payment?.paidAt ||
    payment?.createdAt ||
    null;
  const isLatePayment =
    payment?.isLatePayment ??
    isLatePaymentForPeriod({
      month: payment?.month,
      academicYear: payment?.academicYear,
      paidAt: paymentDate,
    });

  return {
    receiptNumber: `FL-${payment.academicYear}-${String(payment.id).padStart(6, "0")}`,
    paymentDate,
    isLatePayment,
    paymentStatusLabel: buildPaymentStatusLabel(payment, paymentDate),
    paymentMethod: formatPaymentMethodLabel({
      payment,
      gatewayOrder: effectiveGatewayOrder,
      latestAttempt,
    }),
    paymentGateway,
    cashfreeOrderId: effectiveGatewayOrder?.cashfreeOrderId || null,
    cashfreeCfOrderId: effectiveGatewayOrder?.cashfreeCfOrderId || null,
    cashfreePaymentId: latestAttempt?.cfPaymentId || null,
    internalReferenceId: effectiveGatewayOrder?.id || String(payment.id),
    transactionId:
      payment?.phonepeTransactionId ||
      payment?.phonepePaymentId ||
      latestAttempt?.gatewayPaymentId ||
      latestAttempt?.cfPaymentId ||
      null,
    gatewayReference:
      effectiveGatewayOrder?.gatewayReference ||
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

const runCashPaymentPostActions = async ({
  student,
  payment,
  academicYear,
}) => {
  if (student) {
    sendFeePaidWhatsAppNotification({
      student,
      payment,
      mode: "cash",
    }).catch((err) => {
      console.error("WhatsApp fee-paid send failed (cash):", err.message);
    });
  }

  await autoPromoteIfEligible(Number(student?.id || payment?.studentId), academicYear);
};

const createCashPaymentForStudent = async ({
  tx = prisma,
  studentId,
  month,
  academicYear,
  monthlyFee,
  adminId,
  runPostPaymentActions = true,
}) => {
  const normalizedStudentId = Number(studentId);
  const paidAt = new Date();
  const isLatePayment = isLatePaymentForPeriod({
    month,
    academicYear,
    paidAt,
  });
  const student = await tx.student.findUnique({
    where: { id: normalizedStudentId },
    select: { id: true, name: true, phone: true },
  });

  if (!student) {
    return {
      outcome: "missing",
      payment: null,
      student: null,
      previousStatus: null,
      newStatus: null,
      action: "missing",
    };
  }

  const existing = await tx.payment.findUnique({
    where: {
      studentId_month_academicYear: {
        studentId: normalizedStudentId,
        month,
        academicYear,
      },
    },
  });

  if (existing?.status === "paid") {
    return {
      outcome: "duplicate",
      payment: existing,
      student,
      previousStatus: existing.status,
      newStatus: existing.status,
      action: "unchanged",
    };
  }

  const paymentData = {
    amount: Number(monthlyFee),
    status: "paid",
    currency: "INR",
    paymentProvider: "CASH",
    paidAt,
    isLatePayment,
    phonepeTransactionId: null,
    phonepePaymentId: null,
    teacherAdminId: adminId ? Number(adminId) : null,
  };

  let payment;
  try {
    if (existing) {
      payment = await tx.payment.update({
        where: { id: existing.id },
        data: paymentData,
      });
    } else {
      payment = await tx.payment.create({
        data: {
          studentId: normalizedStudentId,
          month,
          academicYear,
          ...paymentData,
        },
      });
    }
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const conflictedPayment = await tx.payment.findUnique({
        where: {
          studentId_month_academicYear: {
            studentId: normalizedStudentId,
            month,
            academicYear,
          },
        },
      });

      if (conflictedPayment?.status === "paid") {
        return {
          outcome: "duplicate",
          payment: conflictedPayment,
          student,
          previousStatus: conflictedPayment.status,
          newStatus: conflictedPayment.status,
          action: "unchanged",
        };
      }
    }

    if (!isPaymentSchemaCompatibilityError(err)) throw err;
    logPaymentCompatibilityFallback("createCashPaymentForStudent", err);
    if (existing) {
      payment = await tx.payment.update({
        where: { id: existing.id },
        data: stripExtendedPaymentWriteData(paymentData),
      });
    } else {
      payment = await tx.payment.create({
        data: stripExtendedPaymentWriteData({
          studentId: normalizedStudentId,
          month,
          academicYear,
          ...paymentData,
        }),
      });
    }
  }

  if (runPostPaymentActions) {
    await runCashPaymentPostActions({
      student,
      payment,
      academicYear,
    });
  }

  return {
    outcome: "created",
    payment,
    student,
    previousStatus: existing?.status || "none",
    newStatus: payment?.status || "paid",
    action: existing ? "updated" : "created",
  };
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

    if (!VALID_PAYMENT_MONTHS.has(month)) {
      return res.status(400).json({ message: "Valid month is required" });
    }

    const academicYear = getCurrentAcademicYear();

    const existing = await prisma.payment.findUnique({
      where: {
        studentId_month_academicYear: {
          studentId: Number(studentId),
          month,
          academicYear,
        },
      },
    });

    if (existing?.status === "paid") {
      return res.status(400).json({ message: "This month already paid" });
    }

    const paidAt = status === "paid" ? new Date() : null;
    const paymentData = {
      amount,
      status: status || "paid",
      currency: "INR",
      paymentProvider: status === "paid" ? "CASH" : null,
      paidAt,
      isLatePayment:
        status === "paid"
        ? isLatePaymentForPeriod({
            month,
            academicYear,
            paidAt,
          })
        : false,
      teacherAdminId: req.userRole === "admin" ? Number(req.user?.id) : null,
      academicYear,
    };

    let payment;
    try {
      if (existing) {
        payment = await prisma.payment.update({
          where: { id: existing.id },
          data: paymentData,
        });
      } else {
        payment = await prisma.payment.create({
          data: {
            studentId: Number(studentId),
            month,
            ...paymentData,
          },
        });
      }
    } catch (err) {
      if (!isPaymentSchemaCompatibilityError(err)) throw err;
      logPaymentCompatibilityFallback("makePayment", err);
      if (existing) {
        payment = await prisma.payment.update({
          where: { id: existing.id },
          data: stripExtendedPaymentWriteData(paymentData),
        });
      } else {
        payment = await prisma.payment.create({
          data: stripExtendedPaymentWriteData({
            studentId: Number(studentId),
            month,
            ...paymentData,
          }),
        });
      }
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

    let payments;
    try {
      payments = await prisma.payment.findMany({
        where: {
          studentId: req.user.id,
          academicYear,
        },
        select: paymentReadSelect,
        orderBy: {
          createdAt: "asc",
        },
      });
    } catch (error) {
      if (!isPaymentSchemaCompatibilityError(error)) throw error;
      logPaymentCompatibilityFallback("getMyPayments", error);
      payments = await prisma.payment.findMany({
        where: {
          studentId: req.user.id,
          academicYear,
        },
        select: legacyPaymentSelect,
        orderBy: {
          createdAt: "asc",
        },
      });
    }

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
      ...paymentReadSelect,
      student: {
        select: paymentStudentListSelect,
      },
    };

    if (!shouldPaginate) {
      let payments;
      try {
        payments = await prisma.payment.findMany({
          select: paymentSelect,
          orderBy: { createdAt: "desc" },
        });
      } catch (error) {
        if (!isPaymentSchemaCompatibilityError(error)) throw error;
        logPaymentCompatibilityFallback("getAllPayments", error);
        payments = await prisma.payment.findMany({
          select: {
            ...legacyPaymentSelect,
            student: {
              select: paymentStudentListSelect,
            },
          },
          orderBy: { createdAt: "desc" },
        });
      }

      return res.json(payments);
    }

    const totalPayments = await prisma.payment.count();
    let payments;
    try {
      payments = await prisma.payment.findMany({
        select: paymentSelect,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });
    } catch (error) {
      if (!isPaymentSchemaCompatibilityError(error)) throw error;
      logPaymentCompatibilityFallback("getAllPayments", error);
      payments = await prisma.payment.findMany({
        select: {
          ...legacyPaymentSelect,
          student: {
            select: paymentStudentListSelect,
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      });
    }

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

    if (!VALID_PAYMENT_MONTHS.has(month)) {
      return res.status(400).json({ message: "Valid month is required" });
    }

    const academicYear = getAcademicYear();

    const appSettings = await prisma.appSettings.findUnique({
      where: { id: 1 },
    });

    if (!appSettings) {
      return res.status(500).json(
        buildPaymentActionResponse({
          success: false,
          message: "App settings not found",
          affectedStudents: [],
          failedStudents: [],
        })
      );
    }

    const result = await prisma.$transaction(async (tx) =>
      createCashPaymentForStudent({
        tx,
        studentId,
        month,
        academicYear,
        monthlyFee: appSettings.monthlyFee,
        adminId: req.user?.id,
        runPostPaymentActions: false,
      })
    );

    if (!result?.payment && result?.outcome === "missing") {
      logWarn("payments.mark_paid_missing_student", buildRequestLogMeta(req, {
        studentId: Number(studentId),
        month,
        academicYear,
      }));
      return res.status(404).json(
        buildPaymentActionResponse({
          success: false,
          message: "Student not found",
          affectedStudents: [],
          failedStudents: [
            buildFailedStudentEntry({
              studentId: Number(studentId),
              month,
              reason: "Student not found",
              code: "STUDENT_NOT_FOUND",
            }),
          ],
        })
      );
    }

    if (result?.outcome === "duplicate") {
      const auditMessage = buildAuditMessage({
        studentId: Number(studentId),
        month,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        adminId: req.user?.id || null,
        action: "duplicate-blocked",
      });
      logWarn("payments.mark_paid_duplicate", buildRequestLogMeta(req, {
        studentId: Number(studentId),
        month,
        academicYear,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        adminId: req.user?.id || null,
        auditMessage,
      }));
      return res.status(409).json(
        buildPaymentActionResponse({
          success: false,
          message: "Student already paid for this month",
          affectedStudents: [],
          failedStudents: [
            buildFailedStudentEntry({
              studentId: Number(studentId),
              name: result.student?.name || null,
              month,
              reason: "Student already paid",
              code: "ALREADY_PAID",
            }),
          ],
          extra: {
            alreadyPaid: true,
            payment: result.payment,
          },
        })
      );
    }

    await runCashPaymentPostActions({
      student: result.student,
      payment: result.payment,
      academicYear,
    });

    const auditMessage = buildAuditMessage({
      studentId: Number(studentId),
      month,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      adminId: req.user?.id || null,
      action: "updated",
    });
    logInfo("payments.mark_paid_success", buildRequestLogMeta(req, {
      studentId: Number(studentId),
      month,
      academicYear,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
      isLatePayment: Boolean(result.payment.isLatePayment),
      paymentId: result.payment.id,
      paymentMode: "cash",
      adminId: req.user?.id || null,
      auditMessage,
    }));

    res.json({
      ...buildPaymentActionResponse({
        success: true,
        message: result.payment.isLatePayment
          ? "Payment marked as PAID (Late Payment)"
          : "Payment marked as PAID",
        affectedStudents: [
          buildAffectedStudentEntry({
            student: result.student,
            payment: result.payment,
            month,
            previousStatus: result.previousStatus,
            newStatus: result.newStatus,
          }),
        ],
        failedStudents: [],
      }),
      payment: result.payment,
    });

  } catch (err) {
    console.error("markPaid error:", err);
    res.status(500).json(
      buildPaymentActionResponse({
        success: false,
        message: "Failed to mark payment",
        affectedStudents: [],
        failedStudents: [],
      })
    );
  }
};

export const bulkUpdatePayments = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { studentIds, month, status, paymentMode } = req.body || {};

    if (!Array.isArray(studentIds) || !studentIds.length) {
      return res.status(400).json({ message: "studentIds are required" });
    }

    if (studentIds.length > 10) {
      return res.status(400).json({ message: "You can select up to 10 students only" });
    }

    if (!month) {
      return res.status(400).json({ message: "month is required" });
    }

    if (!VALID_PAYMENT_MONTHS.has(month)) {
      return res.status(400).json({ message: "Valid month is required" });
    }

    if (String(status || "").toLowerCase() !== "paid") {
      return res.status(400).json({ message: "Only paid status is supported" });
    }

    if (String(paymentMode || "").toLowerCase() !== "cash") {
      return res.status(400).json({ message: "Only cash payment mode is supported" });
    }

    const normalizedStudentIds = [
      ...new Set(
        studentIds
          .map((value) => Number.parseInt(String(value), 10))
          .filter((value) => Number.isInteger(value) && value > 0)
      ),
    ];

    if (!normalizedStudentIds.length) {
      return res.status(400).json({ message: "Valid studentIds are required" });
    }

    if (normalizedStudentIds.length > 10) {
      return res.status(400).json({ message: "You can select up to 10 students only" });
    }

    const appSettings = await prisma.appSettings.findUnique({
      where: { id: 1 },
    });

    if (!appSettings) {
      return res.status(500).json(
        buildPaymentActionResponse({
          success: false,
          message: "App settings not found",
          affectedStudents: [],
          failedStudents: [],
        })
      );
    }

    const academicYear = getAcademicYear();
    const students = await prisma.student.findMany({
      where: {
        id: {
          in: normalizedStudentIds,
        },
      },
      select: {
        id: true,
        name: true,
        phone: true,
      },
    });

    const studentById = new Map(students.map((student) => [Number(student.id), student]));
    const existingPayments = await prisma.payment.findMany({
      where: {
        studentId: {
          in: normalizedStudentIds,
        },
        month,
        academicYear,
      },
      select: {
        id: true,
        studentId: true,
        status: true,
      },
    });
    const existingPaymentByStudentId = new Map(
      existingPayments.map((payment) => [Number(payment.studentId), payment])
    );

    const failedStudents = [];
    for (const currentStudentId of normalizedStudentIds) {
      const student = studentById.get(currentStudentId);
      if (!student) {
        failedStudents.push(
          buildFailedStudentEntry({
            studentId: currentStudentId,
            month,
            reason: "Student not found",
            code: "STUDENT_NOT_FOUND",
          })
        );
        continue;
      }

      const existingPayment = existingPaymentByStudentId.get(currentStudentId);
      if (existingPayment?.status === "paid") {
        failedStudents.push(
          buildFailedStudentEntry({
            studentId: currentStudentId,
            name: student.name,
            month,
            reason: "Student already paid",
            code: "ALREADY_PAID",
          })
        );
      }
    }

    if (failedStudents.length) {
      logWarn("payments.bulk_mark_paid_rejected", buildRequestLogMeta(req, {
        month,
        academicYear,
        adminId: req.user?.id || null,
        failedStudents,
      }));
      return res.status(409).json(
        buildPaymentActionResponse({
          success: false,
          message: "Bulk payment could not be applied. Resolve the listed students and try again.",
          affectedStudents: [],
          failedStudents,
        })
      );
    }

    const batchResults = await prisma.$transaction(async (tx) => {
      const nextResults = [];

      for (const currentStudentId of normalizedStudentIds) {
        const result = await createCashPaymentForStudent({
          tx,
          studentId: currentStudentId,
          month,
          academicYear,
          monthlyFee: appSettings.monthlyFee,
          adminId: req.user?.id,
          runPostPaymentActions: false,
        });

        if (result.outcome === "missing") {
          throw createUserFacingError(404, `Student ${currentStudentId} not found`, {
            studentId: currentStudentId,
            code: "BULK_STUDENT_NOT_FOUND",
          });
        }

        if (result.outcome === "duplicate") {
          throw createUserFacingError(
            409,
            `Student ${currentStudentId} is already paid for ${month}`,
            {
              studentId: currentStudentId,
              code: "BULK_ALREADY_PAID",
            }
          );
        }

        nextResults.push(result);
      }

      return nextResults;
    });

    await Promise.allSettled(
      batchResults.map((result) =>
        runCashPaymentPostActions({
          student: result.student,
          payment: result.payment,
          academicYear,
        })
      )
    );

    const results = {
      updatedCount: batchResults.length,
      skippedCount: 0,
      missingCount: 0,
      lateCount: batchResults.filter((result) => result.payment?.isLatePayment).length,
      updatedStudentIds: batchResults.map((result) => result.student?.id).filter(Boolean),
      skippedStudentIds: [],
      missingStudentIds: [],
    };

    const summaryParts = [`Payment updated for ${results.updatedCount} student${results.updatedCount === 1 ? "" : "s"}`];
    if (results.lateCount) {
      summaryParts.push(`${results.lateCount} marked as late payment`);
    }

    const affectedStudents = batchResults.map((result) =>
      buildAffectedStudentEntry({
        student: result.student,
        payment: result.payment,
        month,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
      })
    );

    for (const result of batchResults) {
      const auditMessage = buildAuditMessage({
        studentId: result.student?.id || null,
        month,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        adminId: req.user?.id || null,
        action: "updated",
      });
      logInfo("payments.bulk_mark_paid_item", buildRequestLogMeta(req, {
        studentId: result.student?.id || null,
        month,
        academicYear,
        previousStatus: result.previousStatus,
        newStatus: result.newStatus,
        paymentId: result.payment?.id || null,
        isLatePayment: Boolean(result.payment?.isLatePayment),
        adminId: req.user?.id || null,
        auditMessage,
      }));
    }

    logInfo("payments.bulk_mark_paid_completed", buildRequestLogMeta(req, {
      month,
      academicYear,
      requestedCount: normalizedStudentIds.length,
      updatedCount: results.updatedCount,
      skippedCount: results.skippedCount,
      missingCount: results.missingCount,
      lateCount: results.lateCount,
      paymentMode: "cash",
    }));

    return res.json({
      ...buildPaymentActionResponse({
        success: true,
        message: summaryParts.join(". "),
        affectedStudents,
        failedStudents: [],
      }),
      ...results,
    });
  } catch (err) {
    if (err?.status) {
      logWarn("payments.bulk_mark_paid_rejected", buildRequestLogMeta(req, {
        month: req.body?.month || null,
        studentId: err?.studentId || null,
        adminId: req.user?.id || null,
        message: err.message,
      }));
      return res.status(err.status).json({
        ...buildPaymentActionResponse({
          success: false,
          message: err.message,
          affectedStudents: [],
          failedStudents: [
            buildFailedStudentEntry({
              studentId: err.studentId || null,
              month: req.body?.month || null,
              reason: err.message,
              code: err.code || "PAYMENT_UPDATE_FAILED",
            }),
          ],
        }),
        studentId: err.studentId || null,
      });
    }
    console.error("bulkUpdatePayments error:", err);
    return res.status(500).json(
      buildPaymentActionResponse({
        success: false,
        message: "Failed to update payments",
        affectedStudents: [],
        failedStudents: [],
      })
    );
  }
};

export const reversePayment = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { paymentId, studentId, month, academicYear } = req.body;

    const student = await prisma.student.findUnique({
      where: { id: Number(studentId) },
      select: { id: true, name: true, phone: true },
    });

    if (!student) {
      return res.status(404).json(
        buildPaymentActionResponse({
          success: false,
          message: "Student not found",
          affectedStudents: [],
          failedStudents: [
            buildFailedStudentEntry({
              studentId: Number(studentId),
              month,
              reason: "Student not found",
              code: "STUDENT_NOT_FOUND",
            }),
          ],
        })
      );
    }

    const payment = await prisma.payment.findFirst({
      where: {
        id: Number(paymentId),
        studentId: Number(studentId),
        month,
        academicYear,
      },
      select: {
        id: true,
        studentId: true,
        month: true,
        academicYear: true,
        status: true,
        paymentProvider: true,
        teacherAdminId: true,
        isLatePayment: true,
      },
    });

    if (!payment) {
      return res.status(404).json(
        buildPaymentActionResponse({
          success: false,
          message: "Payment record not found",
          affectedStudents: [],
          failedStudents: [
            buildFailedStudentEntry({
              studentId: Number(studentId),
              name: student.name,
              month,
              reason: "Payment record not found",
              code: "PAYMENT_NOT_FOUND",
            }),
          ],
        })
      );
    }

    if (payment.status !== "paid") {
      return res.status(409).json(
        buildPaymentActionResponse({
          success: false,
          message: "Only paid payments can be reversed",
          affectedStudents: [],
          failedStudents: [
            buildFailedStudentEntry({
              studentId: Number(studentId),
              name: student.name,
              month,
              reason: "Payment is not currently marked as paid",
              code: "NOT_PAID",
            }),
          ],
        })
      );
    }

    if (String(payment.paymentProvider || "").trim().toUpperCase() !== "CASH") {
      return res.status(409).json(
        buildPaymentActionResponse({
          success: false,
          message: "Only manual cash payments can be reversed",
          affectedStudents: [],
          failedStudents: [
            buildFailedStudentEntry({
              studentId: Number(studentId),
              name: student.name,
              month,
              reason: "Online payments cannot be reversed from this tool",
              code: "UNSAFE_REVERSAL",
            }),
          ],
        })
      );
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "pending",
        paidAt: null,
        isLatePayment: false,
        paymentProvider: null,
        teacherAdminId: req.user?.id ? Number(req.user.id) : payment.teacherAdminId,
      },
    });

    const auditMessage = buildAuditMessage({
      studentId: student.id,
      month,
      previousStatus: payment.status,
      newStatus: updatedPayment.status,
      adminId: req.user?.id || null,
      action: "reversed",
    });
    logWarn("payments.reversed", buildRequestLogMeta(req, {
      studentId: student.id,
      month,
      academicYear,
      previousStatus: payment.status,
      newStatus: updatedPayment.status,
      paymentId: updatedPayment.id,
      adminId: req.user?.id || null,
      auditMessage,
    }));

    return res.json(
      buildPaymentActionResponse({
        success: true,
        message: "Payment reversed to pending",
        affectedStudents: [
          buildAffectedStudentEntry({
            student,
            payment: updatedPayment,
            month,
            previousStatus: payment.status,
            newStatus: updatedPayment.status,
          }),
        ],
        failedStudents: [],
        extra: {
          payment: updatedPayment,
        },
      })
    );
  } catch (err) {
    console.error("reversePayment error:", err);
    return res.status(500).json(
      buildPaymentActionResponse({
        success: false,
        message: "Failed to reverse payment",
        affectedStudents: [],
        failedStudents: [],
      })
    );
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
