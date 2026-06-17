import prisma from "../prisma/client.js";
import { randomUUID } from "node:crypto";
import { createAuditLog } from "../services/auditLogService.js";
import { createPayout, initiatePayout } from "../services/facultyPayoutService.js";
import { sendFacultyExtraIncentiveEmail } from "../services/emailNotificationService.js";

const money = (value) => Number(Number(value || 0).toFixed(2));

const adminName = (req) => req.user?.name || req.user?.email || "Admin";

const typeDto = (type) => ({
  id: type.id,
  name: type.name,
  rate: money(type.rate),
  isActive: Boolean(type.isActive),
  createdAt: type.createdAt,
  updatedAt: type.updatedAt,
});

const summarizeEntries = (entries = []) => {
  const byType = new Map();
  for (const entry of entries) {
    const key = entry.incentiveTypeId;
    const existing = byType.get(key) || {
      incentiveTypeId: key,
      name: entry.incentiveType?.name || "Incentive",
      quantity: 0,
      rate: money(entry.rateSnapshot),
      amount: 0,
    };
    existing.quantity += Number(entry.quantityChange || 0);
    existing.amount += money(entry.amountSnapshot);
    byType.set(key, existing);
  }
  return [...byType.values()].filter((item) => item.quantity > 0 && item.amount > 0);
};

const paymentDto = (payment) => ({
  id: payment.id,
  facultyId: payment.facultyId,
  facultyName: payment.faculty?.fullName || "",
  facultyCode: payment.faculty?.facultyId || "",
  totalAmount: money(payment.totalAmount),
  status: payment.status,
  paymentMethod: payment.paymentMethod || "CASH",
  facultyPayoutId: payment.facultyPayoutId || null,
  cashfreeTransferId: payment.cashfreeTransferId || "",
  cashfreeReferenceId: payment.cashfreeReferenceId || "",
  utr: payment.utr || "",
  transactionId: payment.transactionId || "",
  failureReason: payment.failureReason || "",
  paidByAdminId: payment.paidByAdminId,
  paidByAdminName: payment.paidByAdminName || "",
  paidAt: payment.paidAt,
  summary: payment.summaryJson || [],
});

const isMissingExtraPaymentColumnsError = (error) => {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  return /P2022|paymentMethod|facultyPayoutId|cashfreeTransferId|cashfreeReferenceId|transactionId|failureReason|does not exist/i.test(text);
};

const createCashPaymentLegacy = async ({ facultyId, req }) =>
  prisma.$transaction(async (tx) => {
    const faculty = await tx.faculty.findUnique({ where: { id: facultyId } });
    if (!faculty) {
      const error = new Error("Faculty not found.");
      error.status = 404;
      throw error;
    }
    const entries = await tx.facultyExtraIncentiveEntry.findMany({
      where: { facultyId, status: "PENDING" },
      include: { incentiveType: true },
    });
    const summary = summarizeEntries(entries);
    const totalAmount = money(summary.reduce((sum, item) => sum + item.amount, 0));
    if (totalAmount <= 0) {
      const error = new Error("No pending extra incentive amount to pay.");
      error.status = 400;
      throw error;
    }

    const now = new Date();
    const paymentId = randomUUID();
    const rows = await tx.$queryRaw`
      INSERT INTO "FacultyExtraIncentivePayment"
        ("id", "facultyId", "totalAmount", "status", "paidByAdminId", "paidByAdminName", "paidAt", "summaryJson", "createdAt", "updatedAt")
      VALUES
        (${paymentId}, ${facultyId}, ${totalAmount}, ${"PAID"}, ${req.user.id}, ${adminName(req)}, ${now}, ${JSON.stringify(summary)}::jsonb, ${now}, ${now})
      RETURNING "id", "facultyId", "totalAmount", "status", "paidByAdminId", "paidByAdminName", "paidAt", "summaryJson", "createdAt", "updatedAt"
    `;

    await tx.facultyExtraIncentiveEntry.updateMany({
      where: { id: { in: entries.map((entry) => entry.id) } },
      data: { status: "PAID", paymentRecordId: paymentId },
    });

    return {
      payment: {
        ...(rows?.[0] || {}),
        paymentMethod: "CASH",
        facultyPayoutId: null,
        cashfreeTransferId: "",
        cashfreeReferenceId: "",
        utr: "",
        transactionId: "",
        failureReason: "",
      },
      faculty,
      summary,
    };
  });

const findExtraIncentivePayments = async ({ facultyId = null } = {}) => {
  const where = facultyId ? { facultyId } : {};
  try {
    return await prisma.facultyExtraIncentivePayment.findMany({
      where,
      include: { faculty: true },
      orderBy: { paidAt: "desc" },
      take: 200,
    });
  } catch (error) {
    if (!isMissingExtraPaymentColumnsError(error)) throw error;
    const rows = facultyId
      ? await prisma.$queryRaw`
          SELECT p."id", p."facultyId", p."totalAmount", p."status", p."paidByAdminId", p."paidByAdminName", p."paidAt", p."summaryJson",
                 'CASH' AS "paymentMethod", NULL AS "facultyPayoutId", NULL AS "cashfreeTransferId", NULL AS "cashfreeReferenceId",
                 NULL AS "utr", NULL AS "transactionId", NULL AS "failureReason",
                 f."fullName" AS "facultyName", f."facultyId" AS "facultyCode"
          FROM "FacultyExtraIncentivePayment" p
          LEFT JOIN "Faculty" f ON f."id" = p."facultyId"
          WHERE p."facultyId" = ${facultyId}
          ORDER BY p."paidAt" DESC
          LIMIT 200
        `
      : await prisma.$queryRaw`
          SELECT p."id", p."facultyId", p."totalAmount", p."status", p."paidByAdminId", p."paidByAdminName", p."paidAt", p."summaryJson",
                 'CASH' AS "paymentMethod", NULL AS "facultyPayoutId", NULL AS "cashfreeTransferId", NULL AS "cashfreeReferenceId",
                 NULL AS "utr", NULL AS "transactionId", NULL AS "failureReason",
                 f."fullName" AS "facultyName", f."facultyId" AS "facultyCode"
          FROM "FacultyExtraIncentivePayment" p
          LEFT JOIN "Faculty" f ON f."id" = p."facultyId"
          ORDER BY p."paidAt" DESC
          LIMIT 200
        `;
    return rows.map((row) => ({
      ...row,
      faculty: { fullName: row.facultyName, facultyId: row.facultyCode },
    }));
  }
};

export const listIncentiveTypes = async (req, res) => {
  const onlyActive = req.userRole === "faculty";
  const types = await prisma.extraIncentiveType.findMany({
    where: onlyActive ? { isActive: true } : {},
    orderBy: { createdAt: "desc" },
  });
  return res.json({ success: true, types: types.map(typeDto) });
};

export const createIncentiveType = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const rate = money(req.body?.rate);
    if (!name) return res.status(400).json({ success: false, message: "Incentive name is required." });
    if (!Number.isFinite(rate) || rate <= 0) {
      return res.status(400).json({ success: false, message: "Rate must be a positive number." });
    }
    const type = await prisma.extraIncentiveType.create({ data: { name, rate } });
    await createAuditLog({
      req,
      action: "EXTRA_INCENTIVE_TYPE_CREATED",
      entityType: "ExtraIncentiveType",
      entityId: type.id,
      metadata: { name, rate },
    });
    return res.status(201).json({ success: true, type: typeDto(type) });
  } catch (error) {
    console.error("Create extra incentive type error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to create incentive type." });
  }
};

export const updateIncentiveType = async (req, res) => {
  try {
    const data = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name) return res.status(400).json({ success: false, message: "Incentive name is required." });
      data.name = name;
    }
    if (req.body?.rate !== undefined) {
      const rate = money(req.body.rate);
      if (!Number.isFinite(rate) || rate <= 0) {
        return res.status(400).json({ success: false, message: "Rate must be a positive number." });
      }
      data.rate = rate;
    }
    if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
    const type = await prisma.extraIncentiveType.update({ where: { id: req.params.id }, data });
    await createAuditLog({
      req,
      action: "EXTRA_INCENTIVE_TYPE_UPDATED",
      entityType: "ExtraIncentiveType",
      entityId: type.id,
      metadata: data,
    });
    return res.json({ success: true, type: typeDto(type) });
  } catch (error) {
    console.error("Update extra incentive type error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to update incentive type." });
  }
};

export const getAdminSummary = async (req, res) => {
  try {
    const [types, faculties, pendingEntries] = await Promise.all([
      prisma.extraIncentiveType.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.faculty.findMany({ orderBy: { fullName: "asc" } }),
      prisma.facultyExtraIncentiveEntry.findMany({
        where: { status: "PENDING" },
        include: { incentiveType: true },
      }),
    ]);

    const entriesByFaculty = new Map();
    for (const entry of pendingEntries) {
      const list = entriesByFaculty.get(entry.facultyId) || [];
      list.push(entry);
      entriesByFaculty.set(entry.facultyId, list);
    }

    const facultySummaries = faculties.map((faculty) => {
      const summary = summarizeEntries(entriesByFaculty.get(faculty.id) || []);
      return {
        facultyId: faculty.id,
        facultyCode: faculty.facultyId,
        facultyName: faculty.fullName,
        pendingSummary: summary,
        pendingCount: summary.reduce((sum, item) => sum + item.quantity, 0),
        pendingAmount: money(summary.reduce((sum, item) => sum + item.amount, 0)),
      };
    });

    return res.json({ success: true, types: types.map(typeDto), facultySummaries });
  } catch (error) {
    console.error("Extra incentive admin summary error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load extra incentive summary." });
  }
};

export const adjustMyIncentive = async (req, res) => {
  try {
    const direction = req.params.action === "decrement" ? -1 : 1;
    const facultyId = req.user.id;
    const type = await prisma.extraIncentiveType.findFirst({
      where: { id: req.params.incentiveTypeId, isActive: true },
    });
    if (!type) return res.status(404).json({ success: false, message: "Incentive type not found." });

    if (direction < 0) {
      const pending = await prisma.facultyExtraIncentiveEntry.findMany({
        where: { facultyId, incentiveTypeId: type.id, status: "PENDING" },
      });
      const quantity = pending.reduce((sum, entry) => sum + Number(entry.quantityChange || 0), 0);
      if (quantity <= 0) {
        return res.status(400).json({ success: false, message: "Pending count cannot go below zero." });
      }
    }

    const rate = money(type.rate);
    const entry = await prisma.facultyExtraIncentiveEntry.create({
      data: {
        facultyId,
        incentiveTypeId: type.id,
        quantityChange: direction,
        rateSnapshot: rate,
        amountSnapshot: money(direction * rate),
        status: "PENDING",
        createdByType: "FACULTY",
        createdById: facultyId,
      },
    });
    await createAuditLog({
      req,
      action: direction > 0 ? "EXTRA_INCENTIVE_INCREMENTED" : "EXTRA_INCENTIVE_DECREMENTED",
      entityType: "FacultyExtraIncentiveEntry",
      entityId: entry.id,
      metadata: { incentiveTypeId: type.id, quantityChange: direction },
    });
    return res.json({ success: true, entry });
  } catch (error) {
    console.error("Adjust my extra incentive error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to update extra incentive." });
  }
};

export const getMyIncentives = async (req, res) => {
  try {
    const [types, entries] = await Promise.all([
      prisma.extraIncentiveType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.facultyExtraIncentiveEntry.findMany({
        where: { facultyId: req.user.id },
        include: { incentiveType: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    ]);
    const payments = await findExtraIncentivePayments({ facultyId: req.user.id });
    const pendingEntries = entries.filter((entry) => entry.status === "PENDING");
    return res.json({
      success: true,
      types: types.map(typeDto),
      pendingSummary: summarizeEntries(pendingEntries),
      entries: entries.map((entry) => ({
        id: entry.id,
        incentiveTypeId: entry.incentiveTypeId,
        name: entry.incentiveType?.name || "Incentive",
        quantityChange: entry.quantityChange,
        rate: money(entry.rateSnapshot),
        amount: money(entry.amountSnapshot),
        status: entry.status,
        createdAt: entry.createdAt,
      })),
      payments: payments.map(paymentDto),
    });
  } catch (error) {
    console.error("My extra incentives error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load extra incentives." });
  }
};

export const payFacultyIncentives = async (req, res) => {
  try {
    const facultyId = req.params.facultyId;
    const method = String(req.body?.method || "CASH").trim().toUpperCase();
    if (!["CASH", "CASHFREE"].includes(method)) {
      return res.status(400).json({ success: false, message: "Payment method must be CASH or CASHFREE." });
    }

    let cashfreePayout = null;
    if (method === "CASHFREE") {
      const entries = await prisma.facultyExtraIncentiveEntry.findMany({
        where: { facultyId, status: "PENDING" },
        include: { incentiveType: true },
      });
      const summary = summarizeEntries(entries);
      const totalAmount = money(summary.reduce((sum, item) => sum + item.amount, 0));
      if (totalAmount <= 0) {
        return res.status(400).json({ success: false, message: "No pending extra incentive amount to pay." });
      }
      const payout = await createPayout({
        facultyId,
        amount: totalAmount,
        paymentMethod: "BANK_TRANSFER",
        createdBy: req.user?.id,
      });
      const initiated = await initiatePayout(payout.id, { paidBy: req.user?.id });
      cashfreePayout = initiated?.payout || payout;
      if (String(cashfreePayout.status || "").toUpperCase() === "FAILED") {
        return res.status(502).json({
          success: false,
          message: cashfreePayout.failureReason || "Cashfree payout failed.",
        });
      }
    }

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
      const faculty = await tx.faculty.findUnique({ where: { id: facultyId } });
      if (!faculty) {
        const error = new Error("Faculty not found.");
        error.status = 404;
        throw error;
      }
      const entries = await tx.facultyExtraIncentiveEntry.findMany({
        where: { facultyId, status: "PENDING" },
        include: { incentiveType: true },
      });
      const summary = summarizeEntries(entries);
      const totalAmount = money(summary.reduce((sum, item) => sum + item.amount, 0));
      if (totalAmount <= 0) {
        const error = new Error("No pending extra incentive amount to pay.");
        error.status = 400;
        throw error;
      }
      const payment = await tx.facultyExtraIncentivePayment.create({
        data: {
          facultyId,
          totalAmount,
          status: method === "CASHFREE" && String(cashfreePayout?.status || "").toUpperCase() !== "SUCCESS" ? "PROCESSING" : "PAID",
          paymentMethod: method,
          facultyPayoutId: cashfreePayout?.id || null,
          cashfreeTransferId: cashfreePayout?.cashfreeTransferId || null,
          cashfreeReferenceId: cashfreePayout?.cashfreeReferenceId || cashfreePayout?.referenceId || null,
          utr: cashfreePayout?.utr || null,
          transactionId: cashfreePayout?.transactionId || null,
          failureReason: cashfreePayout?.failureReason || null,
          paidByAdminId: req.user.id,
          paidByAdminName: adminName(req),
          paidAt: new Date(),
          summaryJson: summary,
        },
      });
      await tx.facultyExtraIncentiveEntry.updateMany({
        where: { id: { in: entries.map((entry) => entry.id) } },
        data: { status: "PAID", paymentRecordId: payment.id },
      });
      return { payment, faculty, summary };
      });
    } catch (error) {
      if (method === "CASH" && isMissingExtraPaymentColumnsError(error)) {
        result = await createCashPaymentLegacy({ facultyId, req });
      } else {
        throw error;
      }
    }

    await createAuditLog({
      req,
      action: "EXTRA_INCENTIVE_PAID",
      entityType: "FacultyExtraIncentivePayment",
      entityId: result.payment.id,
      metadata: { facultyId, method, totalAmount: money(result.payment.totalAmount), summary: result.summary },
    });
    if (String(result.payment.status || "").toUpperCase() === "PAID") {
      await sendFacultyExtraIncentiveEmail({
        faculty: result.faculty,
        payment: result.payment,
        lineItems: result.summary,
        idempotencyKey: `faculty-extra-incentive-paid:${result.payment.id}`,
      });
    }
    return res.json({
      success: true,
      message: "Extra incentives paid successfully",
      payment: paymentDto({ ...result.payment, faculty: result.faculty }),
    });
  } catch (error) {
    console.error("Pay extra incentives error:", error?.message || error);
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.status ? error.message : "Failed to pay extra incentives.",
    });
  }
};

export const listIncentivePayments = async (req, res) => {
  try {
    const payments = await findExtraIncentivePayments({
      facultyId: req.userRole === "faculty" ? req.user.id : null,
    });
    return res.json({ success: true, payments: payments.map(paymentDto) });
  } catch (error) {
    console.error("Extra incentive payments error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load extra incentive payments." });
  }
};
