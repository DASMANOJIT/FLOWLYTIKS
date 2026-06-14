import prisma from "../prisma/client.js";
import { isWhatsAppConfigured, sendWhatsAppTextMessage } from "./whatsappservice.js";

const RESEND_API_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15_000;

const text = (value) => String(value || "").trim();
const money = (value) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0));
const dateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};
const dateOnly = (value) => {
  const key = dateKey(value);
  return key ? new Date(`${key}T00:00:00.000Z`) : null;
};

const normalizePhoneForWa = (phone) => {
  const digits = text(phone).replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits.slice(1);
  if (digits.length === 10) return `${process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91"}${digits}`;
  return digits;
};

export const buildWhatsAppLink = ({ phone, message }) => {
  const normalized = normalizePhoneForWa(phone);
  if (!normalized) return "";
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
};

const sendEmailNotification = async ({ to, subject, textBody, html }) => {
  const apiKey = text(process.env.RESEND_API_KEY);
  const from = text(process.env.EMAIL_FROM);
  if (!apiKey || !from) {
    const error = new Error("Email notification skipped: Resend is not configured.");
    error.skip = true;
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text: textBody, html }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error?.message || "Email notification failed.");
    }
    return { providerMessageId: payload?.id || null };
  } finally {
    clearTimeout(timeout);
  }
};

const createBaseLog = async (data) => {
  try {
    return await prisma.notificationLog.create({ data });
  } catch (error) {
    if (error?.code === "P2002") {
      return prisma.notificationLog.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
    }
    throw error;
  }
};

const sendChannel = async ({ recipient, channel, eventType, title, message, html, related = {} }) => {
  const idempotencyKey = [
    eventType,
    channel,
    recipient.type,
    recipient.id || recipient.email || recipient.phone || "unknown",
    related.payoutId || related.payrollId || `${dateKey(related.weekStart)}:${dateKey(related.weekEnd)}`,
  ].join(":");

  const existing = await prisma.notificationLog.findUnique({ where: { idempotencyKey } }).catch(() => null);
  if (existing && ["SENT", "PENDING", "PENDING_MANUAL", "SKIPPED"].includes(existing.status)) {
    return existing;
  }

  const base = await createBaseLog({
    recipientType: recipient.type,
    recipientId: recipient.id ? String(recipient.id) : null,
    recipientEmail: recipient.email || null,
    recipientPhone: recipient.phone || null,
    channel,
    eventType,
    title,
    message,
    status: "PENDING",
    relatedWeekStart: dateOnly(related.weekStart),
    relatedWeekEnd: dateOnly(related.weekEnd),
    relatedPayrollId: related.payrollId || null,
    relatedPayoutId: related.payoutId || null,
    idempotencyKey,
  });

  try {
    if (channel === "EMAIL") {
      if (!recipient.email) {
        return prisma.notificationLog.update({ where: { id: base.id }, data: { status: "SKIPPED", errorMessage: "Recipient email missing." } });
      }
      const result = await sendEmailNotification({ to: recipient.email, subject: title, textBody: message, html });
      return prisma.notificationLog.update({
        where: { id: base.id },
        data: { status: "SENT", providerMessageId: result.providerMessageId, sentAt: new Date() },
      });
    }

    if (channel === "WHATSAPP") {
      if (!recipient.phone) {
        return prisma.notificationLog.update({ where: { id: base.id }, data: { status: "SKIPPED", errorMessage: "Recipient phone missing." } });
      }
      const whatsappLink = buildWhatsAppLink({ phone: recipient.phone, message });
      if (!isWhatsAppConfigured()) {
        return prisma.notificationLog.update({
          where: { id: base.id },
          data: { status: "PENDING_MANUAL", whatsappLink },
        });
      }
      const result = await sendWhatsAppTextMessage({ to: recipient.phone, message });
      return prisma.notificationLog.update({
        where: { id: base.id },
        data: { status: "SENT", providerMessageId: result?.messages?.[0]?.id || null, whatsappLink, sentAt: new Date() },
      });
    }

    return prisma.notificationLog.update({ where: { id: base.id }, data: { status: "SKIPPED", errorMessage: "Unsupported channel." } });
  } catch (error) {
    return prisma.notificationLog.update({
      where: { id: base.id },
      data: {
        status: error?.skip ? "SKIPPED" : "FAILED",
        errorMessage: error?.message || "Notification failed.",
      },
    });
  }
};

const sendToRecipient = async (payload) => Promise.all([
  sendChannel({ ...payload, channel: "EMAIL" }),
  sendChannel({ ...payload, channel: "WHATSAPP" }),
]);

const facultyRecipient = (faculty) => ({
  type: "FACULTY",
  id: faculty?.id,
  email: faculty?.email || null,
  phone: faculty?.phone || null,
});

const adminRecipient = (admin) => ({
  type: "ADMIN",
  id: admin?.id,
  email: admin?.email || null,
  phone: admin?.phone || null,
});

export const notifyPayrollGenerated = async ({ admin, payrolls = [], cycle }) => {
  const week = `${dateKey(cycle?.startDate)} to ${dateKey(cycle?.endDate)}`;
  const tasks = payrolls.map((payroll) => {
    const amount = money(payroll.totalAmount);
    const title = `Flowlytiks Payroll Generated - ${week}`;
    const message = `Hello ${payroll.faculty?.fullName || "Faculty"},\n\nYour payroll for ${week} has been generated.\n\nAttendance entries: ${payroll.totalEntries}\nPayable amount: ${amount}\nStatus: Pending payout\n\nRegards,\nFlowlytiks`;
    return sendToRecipient({
      recipient: facultyRecipient(payroll.faculty),
      eventType: "PAYROLL_GENERATED",
      title,
      message,
      html: message.replace(/\n/g, "<br />"),
      related: { weekStart: cycle?.startDate, weekEnd: cycle?.endDate, payrollId: payroll.id },
    });
  });
  if (admin) {
    const total = money(payrolls.reduce((sum, payroll) => sum + Number(payroll.totalAmount || 0), 0));
    tasks.push(sendToRecipient({
      recipient: adminRecipient(admin),
      eventType: "PAYROLL_GENERATED",
      title: `Flowlytiks Payroll Generated - ${week}`,
      message: `Payroll generated for ${week}. Faculty count: ${payrolls.length}. Total payable: ${total}.`,
      related: { weekStart: cycle?.startDate, weekEnd: cycle?.endDate },
    }));
  }
  return Promise.allSettled(tasks);
};

export const notifyPayoutInitiated = async ({ admin, payouts = [] }) => {
  const tasks = [];
  for (const payout of payouts) {
    const week = payout.payroll?.payrollCycle
      ? `${dateKey(payout.payroll.payrollCycle.startDate)} to ${dateKey(payout.payroll.payrollCycle.endDate)}`
      : "-";
    const amount = money(payout.amount);
    const message = `Flowlytiks: Your payout of ${amount} for ${week} has been initiated. Status: Processing.`;
    tasks.push(sendToRecipient({
      recipient: facultyRecipient(payout.faculty),
      eventType: "PAYOUT_INITIATED",
      title: `Flowlytiks Payout Initiated - ${amount}`,
      message,
      related: { weekStart: payout.payroll?.payrollCycle?.startDate, weekEnd: payout.payroll?.payrollCycle?.endDate, payrollId: payout.payrollId, payoutId: payout.id },
    }));
  }
  if (admin && payouts.length) {
    const total = money(payouts.reduce((sum, payout) => sum + Number(payout.amount || 0), 0));
    tasks.push(sendToRecipient({
      recipient: adminRecipient(admin),
      eventType: "PAYOUT_INITIATED",
      title: `Flowlytiks Payout Batch Initiated - ${total}`,
      message: `Faculty payout batch initiated. Transfers: ${payouts.length}. Total: ${total}.`,
      related: {
        weekStart: payouts[0]?.payroll?.payrollCycle?.startDate,
        weekEnd: payouts[0]?.payroll?.payrollCycle?.endDate,
      },
    }));
  }
  return Promise.allSettled(tasks);
};

export const notifyLedgerLocked = async ({ admin, payrolls = [], cycle }) => {
  const week = `${dateKey(cycle?.startDate)} to ${dateKey(cycle?.endDate)}`;
  const message = `Flowlytiks: Attendance for ${week} is locked because payout has been initiated/processed.`;
  const tasks = payrolls.map((payroll) => sendToRecipient({
    recipient: facultyRecipient(payroll.faculty),
    eventType: "LEDGER_LOCKED",
    title: `Flowlytiks Attendance Locked - ${week}`,
    message,
    related: { weekStart: cycle?.startDate, weekEnd: cycle?.endDate, payrollId: payroll.id },
  }));
  if (admin) {
    tasks.push(sendToRecipient({
      recipient: adminRecipient(admin),
      eventType: "LEDGER_LOCKED",
      title: `Flowlytiks Attendance Locked - ${week}`,
      message,
      related: { weekStart: cycle?.startDate, weekEnd: cycle?.endDate },
    }));
  }
  return Promise.allSettled(tasks);
};

export const notifyPayoutSuccess = async ({ payout, admin }) => {
  const week = payout.payroll?.payrollCycle
    ? `${dateKey(payout.payroll.payrollCycle.startDate)} to ${dateKey(payout.payroll.payrollCycle.endDate)}`
    : "-";
  const amount = money(payout.amount);
  const utr = payout.utr || payout.transactionId || "-";
  const message = `Flowlytiks: Your payout of ${amount} is successful. UTR: ${utr}. Week: ${week}.`;
  const related = { weekStart: payout.payroll?.payrollCycle?.startDate, weekEnd: payout.payroll?.payrollCycle?.endDate, payrollId: payout.payrollId, payoutId: payout.id };
  return Promise.allSettled([
    sendToRecipient({ recipient: facultyRecipient(payout.faculty), eventType: "PAYOUT_SUCCESS", title: `Flowlytiks Payout Successful - ${amount}`, message, related }),
    admin ? sendToRecipient({ recipient: adminRecipient(admin), eventType: "PAYOUT_SUCCESS", title: `Flowlytiks Faculty Payout Successful - ${amount}`, message: `${payout.faculty?.fullName || "Faculty"} payout successful. ${message}`, related }) : null,
  ].filter(Boolean));
};

export const notifyPayoutFailed = async ({ payout, admin }) => {
  const week = payout.payroll?.payrollCycle
    ? `${dateKey(payout.payroll.payrollCycle.startDate)} to ${dateKey(payout.payroll.payrollCycle.endDate)}`
    : "-";
  const amount = money(payout.amount);
  const reason = payout.failureReason || "Gateway reported failure.";
  const message = `Flowlytiks: Your payout of ${amount} for ${week} failed. Reason: ${reason}. Please contact admin.`;
  const related = { weekStart: payout.payroll?.payrollCycle?.startDate, weekEnd: payout.payroll?.payrollCycle?.endDate, payrollId: payout.payrollId, payoutId: payout.id };
  return Promise.allSettled([
    sendToRecipient({ recipient: facultyRecipient(payout.faculty), eventType: "PAYOUT_FAILED", title: "Flowlytiks Payout Failed - Action Required", message, related }),
    admin ? sendToRecipient({ recipient: adminRecipient(admin), eventType: "PAYOUT_FAILED", title: "Flowlytiks Faculty Payout Failed", message: `${payout.faculty?.fullName || "Faculty"} payout failed. Reason: ${reason}.`, related }) : null,
  ].filter(Boolean));
};

export const listAdminNotificationLogs = async ({ eventType, channel, status, limit = 100 } = {}) => {
  const where = {};
  if (eventType && eventType !== "all") where.eventType = eventType;
  if (channel && channel !== "all") where.channel = channel;
  if (status && status !== "all") where.status = status;
  return prisma.notificationLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(limit) || 100, 300),
  });
};

export const listFacultyNotificationLogs = async (facultyId) =>
  prisma.notificationLog.findMany({
    where: { recipientType: "FACULTY", recipientId: String(facultyId) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
