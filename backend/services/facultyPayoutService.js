import prisma from "../prisma/client.js";
import { randomUUID } from "node:crypto";
import { logInfo } from "../utils/appLogger.js";
import {
  createBeneficiaryForFaculty,
  initiatePayoutTransfer,
  retryFailedPayout,
  syncPayoutStatus,
} from "./cashfreePayoutService.js";

const actorKey = (value) => (value ? String(value) : "system");
const moneyNumber = (value) => Number(value || 0);

const withPayoutIncludes = {
  faculty: {
    select: {
      id: true,
      facultyId: true,
      fullName: true,
      email: true,
      phone: true,
      bankAccounts: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          payoutMode: true,
          accountHolderName: true,
          ifscCode: true,
          bankName: true,
          verificationStatus: true,
          payoutEligible: true,
          cashfreeBeneficiaryId: true,
          cashfreeBeneficiaryStatus: true,
        },
      },
    },
  },
  payroll: { include: { payrollCycle: true } },
};

const makeReferenceId = () => `FPAY-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

export const createFacultyBankAccount = async (data) => {
  const existing = await prisma.facultyBankAccount.findFirst({ where: { facultyId: data.facultyId }, orderBy: { updatedAt: "desc" } });
  if (existing) {
    return prisma.facultyBankAccount.update({ where: { id: existing.id }, data });
  }
  return prisma.facultyBankAccount.create({ data });
};

export const updateFacultyBankAccount = async (id, data) => {
  return prisma.facultyBankAccount.update({ where: { id }, data });
};

export const getFacultyBankAccount = async (facultyId) => {
  return prisma.facultyBankAccount.findFirst({ where: { facultyId } });
};

export const listFacultyPayouts = async ({ page = 1, limit = 20, status = "all" }) => {
  const where = {};
  if (status && status !== "all") where.status = status;
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.facultyPayout.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: limit, include: withPayoutIncludes }),
    prisma.facultyPayout.count({ where }),
  ]);
  return { rows, total };
};

export const createPayout = async ({ facultyId, payrollId = null, amount, paymentMethod, createdBy }) => {
  let payrollAmount = amount;
  if (payrollId) {
    const payroll = await prisma.facultyEarningsPayroll.findUnique({ where: { id: payrollId } });
    if (!payroll) throw new Error("Referenced payroll not found");
    if (String(payroll.status || "").toUpperCase() !== "APPROVED") {
      throw new Error("Payroll must be APPROVED before creating a payout.");
    }
    facultyId = payroll.facultyId;
    payrollAmount = payroll.totalAmount;
  }
  if (!facultyId || !moneyNumber(payrollAmount)) {
    throw new Error("Faculty and payout amount are required.");
  }

  const payout = await prisma.facultyPayout.create({
    data: {
      facultyId,
      payrollId,
      amount: payrollAmount,
      payoutAmount: payrollAmount,
      paidAmount: 0,
      unpaidAmount: payrollAmount,
      paymentMethod: paymentMethod || "BANK_TRANSFER",
      payoutMode: paymentMethod || "BANK",
      referenceId: makeReferenceId(),
      createdBy: actorKey(createdBy),
    },
    include: withPayoutIncludes,
  });
  logInfo("payout.created", { id: payout.id, facultyId, amount: Number(payout.amount), referenceId: payout.referenceId });
  return payout;
};

export const createPayoutsForApprovedPayrolls = async ({ payrollCycleId, createdBy }) => {
  const payrolls = await prisma.facultyEarningsPayroll.findMany({
    where: {
      payrollCycleId,
      status: "APPROVED",
      payouts: { none: { status: { in: ["PENDING", "PROCESSING", "SUCCESS"] } } },
    },
    include: { faculty: true, payrollCycle: true },
  });

  const created = [];
  for (const payroll of payrolls) {
    created.push(await createPayout({
      facultyId: payroll.facultyId,
      payrollId: payroll.id,
      amount: payroll.totalAmount,
      paymentMethod: "BANK_TRANSFER",
      createdBy,
    }));
  }
  return created;
};

export const getPayoutDashboardStats = async () => {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const weekStart = new Date(now);
  weekStart.setUTCHours(0, 0, 0, 0);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 2) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  const [pendingPayouts, processingPayouts, completedPayouts, failedPayouts, weekRows, monthRows] = await Promise.all([
    prisma.facultyPayout.count({ where: { status: "PENDING" } }),
    prisma.facultyPayout.count({ where: { status: "PROCESSING" } }),
    prisma.facultyPayout.count({ where: { status: "SUCCESS" } }),
    prisma.facultyPayout.count({ where: { status: "FAILED" } }),
    prisma.facultyPayout.findMany({ where: { createdAt: { gte: weekStart, lte: weekEnd } }, select: { amount: true } }),
    prisma.facultyPayout.findMany({ where: { createdAt: { gte: monthStart, lte: monthEnd } }, select: { amount: true } }),
  ]);
  return {
    pendingPayouts,
    processingPayouts,
    completedPayouts,
    failedPayouts,
    currentWeekTotal: weekRows.reduce((sum, row) => sum + moneyNumber(row.amount), 0),
    currentMonthTotal: monthRows.reduce((sum, row) => sum + moneyNumber(row.amount), 0),
  };
};

export const initiatePayout = async (payoutId, opts = {}) => {
  const updated = await initiatePayoutTransfer(payoutId, { adminId: opts.paidBy || opts.adminId });
  await prisma.notification.create({
    data: {
      facultyId: updated.facultyId,
      title: "Payment initiated",
      message: `Your payout of INR ${Number(updated.amount || 0)} has been initiated through Cashfree.`,
      type: "PAYOUT_PROCESSING",
    },
  });
  return { success: true, payout: updated };
};

export const markPayoutPaid = async (payoutId, { transactionId, paidBy }) => {
  const payout = await prisma.facultyPayout.findUnique({ where: { id: payoutId }, include: { payroll: true } });
  if (!payout) throw new Error("Payout not found");
  if (!["PENDING", "PROCESSING", "FAILED"].includes(payout.status)) throw new Error("Only pending, processing, or failed payouts can be marked paid.");
  if (!transactionId) throw new Error("UTR / transaction ID is required.");
  if (payout.payroll && !["APPROVED", "PAID"].includes(payout.payroll.status)) throw new Error("Only approved payrolls can be marked paid.");

  const now = new Date();
  await prisma.$transaction([
    prisma.facultyPayout.update({
      where: { id: payoutId },
      data: {
        status: "SUCCESS",
        paidAt: now,
        paidBy: actorKey(paidBy),
        transactionId,
        utr: transactionId,
        paidAmount: payout.amount,
        unpaidAmount: 0,
        gatewayReference: transactionId,
        payoutDate: now,
        failureReason: null,
      },
    }),
    ...(payout.payrollId ? [
      prisma.facultyEarningsPayroll.update({
        where: { id: payout.payrollId },
        data: { status: "PAID", paidAt: now, paidBy: actorKey(paidBy) },
      }),
    ] : []),
    prisma.notification.create({
      data: {
        facultyId: payout.facultyId,
        title: "Payment successful",
        message: `Your payout of INR ${Number(payout.amount || 0)} has been paid. Transaction ID: ${transactionId}.`,
        type: "PAYOUT_SUCCESS",
      },
    }),
  ]);
  return { success: true };
};

export const markPayoutFailed = async (payoutId, { failureReason, modifiedBy }) => {
  const payout = await prisma.facultyPayout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new Error("Payout not found");
  await prisma.facultyPayout.update({
    where: { id: payoutId },
    data: { status: "FAILED", failureReason: failureReason || "Marked failed manually", paidBy: actorKey(modifiedBy) },
  });
  await prisma.notification.create({
    data: {
      facultyId: payout.facultyId,
      title: "Payment failed",
      message: `Your payout of INR ${Number(payout.amount || 0)} was marked failed.`,
      type: "PAYOUT_FAILED",
    },
  });
  return { success: true };
};

export const retryPayout = async (payoutId, opts = {}) => {
  const updated = await retryFailedPayout(payoutId, { adminId: opts.paidBy || opts.adminId });
  return { success: true, payout: updated };
};

export const initiateBulkPayouts = async (payoutIds, opts = {}) => {
  const results = [];
  for (const payoutId of payoutIds) {
    try {
      results.push({ payoutId, ...(await initiatePayout(payoutId, opts)) });
    } catch (error) {
      results.push({ payoutId, success: false, message: error?.message || "Failed to process payout." });
    }
  }
  return results;
};

export const markBulkPayoutsPaid = async (payoutIds, opts = {}) => {
  const results = [];
  for (const payoutId of payoutIds) {
    try {
      results.push({ payoutId, ...(await markPayoutPaid(payoutId, opts)) });
    } catch (error) {
      results.push({ payoutId, success: false, message: error?.message || "Failed to mark payout paid." });
    }
  }
  return results;
};

export const createBeneficiary = async (facultyId) => createBeneficiaryForFaculty(facultyId);
export const verifyBeneficiary = async (bankAccountId) =>
  prisma.facultyBankAccount.update({ where: { id: bankAccountId }, data: { verificationStatus: "VERIFIED" } });
export const trackPayout = async (payoutId) =>
  prisma.facultyPayout.findUnique({ where: { id: payoutId }, include: withPayoutIncludes });
export const fetchPayoutStatus = async (payoutId) => {
  const payout = await syncPayoutStatus(payoutId);
  return payout ? { status: payout.status, transactionId: payout.transactionId, gatewayReference: payout.gatewayReference, payout } : null;
};
