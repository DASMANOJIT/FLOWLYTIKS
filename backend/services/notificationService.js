import prisma from "../prisma/client.js";
import { logWarn } from "../utils/appLogger.js";
import { sendFacultyWeeklyPayoutEmail } from "./emailNotificationService.js";

const safeCreateNotification = async (data) => {
  if (!prisma.notification) return null;
  try {
    return await prisma.notification.create({ data });
  } catch (error) {
    logWarn("notification.create_failed", { message: error?.message || error });
    return null;
  }
};

export const notifyPayoutSuccess = async ({ payout } = {}) => {
  const notification = await safeCreateNotification({
    facultyId: payout?.facultyId || payout?.faculty?.id,
    title: "Payment successful",
    message: `Your payout of INR ${Number(payout?.amount || 0)} has been paid.`,
    type: "PAYOUT_SUCCESS",
  });
  if (payout?.payroll?.payrollCycle) {
    await sendFacultyWeeklyPayoutEmail({
      faculty: payout.faculty,
      payout,
      breakdown: {
        weekStart: payout.payroll.payrollCycle.startDate,
        weekEnd: payout.payroll.payrollCycle.endDate,
        paymentMethod: payout.payoutMode === "CASH" ? "Cash" : "Cashfree Payout",
        payableAmount: payout.amount,
        paidAmount: payout.paidAmount || payout.amount,
        paidAt: payout.paidAt,
        reference: payout.utr || payout.transactionId || payout.cashfreeReferenceId || payout.cashfreeTransferId || "-",
        payrollId: payout.payrollId,
      },
    });
  }
  return notification;
};

export const notifyPayoutFailed = async ({ payout } = {}) =>
  safeCreateNotification({
    facultyId: payout?.facultyId || payout?.faculty?.id,
    title: "Payment failed",
    message: `Your payout of INR ${Number(payout?.amount || 0)} could not be processed.`,
    type: "PAYOUT_FAILED",
  });

export const notifyPayoutInitiated = async ({ payouts = [] } = {}) => {
  await Promise.all(
    payouts.map((payout) =>
      safeCreateNotification({
        facultyId: payout?.facultyId || payout?.faculty?.id,
        title: "Payment initiated",
        message: `Your payout of INR ${Number(payout?.amount || 0)} has been initiated.`,
        type: "PAYOUT_PROCESSING",
      })
    )
  );
};

export const notifyPayrollGenerated = async () => null;
export const notifyLedgerLocked = async () => null;

export const listAdminNotificationLogs = async ({ eventType, channel, status, limit = 100 } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit || 100), 1), 300);

  if (prisma.notificationLog) {
    const where = {};
    if (eventType && eventType !== "all") where.eventType = eventType;
    if (channel && channel !== "all") where.channel = channel;
    if (status && status !== "all") where.status = status;
    return prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: safeLimit,
    });
  }

  const conditions = [];
  const values = [];
  const addCondition = (field, value) => {
    values.push(value);
    conditions.push(`"${field}" = $${values.length}`);
  };

  if (eventType && eventType !== "all") addCondition("eventType", String(eventType));
  if (channel && channel !== "all") addCondition("channel", String(channel));
  if (status && status !== "all") addCondition("status", String(status));

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    return await prisma.$queryRawUnsafe(
      `SELECT "id", "recipientType", "recipientId", "recipientEmail", "recipientPhone", "channel", "eventType", "title", "message", "status", "providerMessageId", "errorMessage", "whatsappLink", "relatedWeekStart", "relatedWeekEnd", "relatedPayrollId", "relatedPayoutId", "createdAt", "sentAt"
       FROM "NotificationLog"
       ${whereSql}
       ORDER BY "createdAt" DESC
       LIMIT $${values.length + 1}`,
      ...values,
      safeLimit
    );
  } catch (error) {
    logWarn("notification.log.list_unavailable", { message: error?.message || error });
    return [];
  }
};

export const listFacultyNotificationLogs = async (input = {}) => {
  const facultyId = typeof input === "object" && input !== null ? input.facultyId : input;
  if (!prisma.notification || !facultyId) return [];
  return prisma.notification.findMany({
    where: { facultyId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
};
