import { randomUUID } from "node:crypto";
import prisma from "../prisma/client.js";
import { logInfo, logWarn } from "../utils/appLogger.js";

const RESEND_API_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15_000;

const clean = (value) => String(value || "").trim();
const money = (value) => Number(Number(value || 0).toFixed(2));

const isEmailEnabled = () =>
  clean(process.env.NOTIFICATION_EMAIL_ENABLED).toLowerCase() === "true";

const getSenderEmail = () =>
  clean(process.env.RESEND_FROM_EMAIL) || clean(process.env.EMAIL_FROM);

export const getFacultyPayoutEmailConfigStatus = () => ({
  enabled: isEmailEnabled(),
  resendApiConfigured: Boolean(clean(process.env.RESEND_API_KEY)),
  resendFromConfigured: Boolean(getSenderEmail()),
  fromEmail: getSenderEmail(),
});

const formatDate = (value) => {
  const date = value instanceof Date ? value : new Date(value || "");
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
};

const formatDateOnly = (value) => {
  const date = value instanceof Date ? value : new Date(value || "");
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
};

const formatCurrency = (value) => `INR ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const facultyName = (faculty = {}) =>
  clean(faculty.fullName || faculty.name || faculty.facultyName);

const facultyGreetingName = (faculty = {}) =>
  facultyName(faculty) || "Faculty Member";

const escapeHtml = (value) =>
  clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const detailRow = (label, value, highlight = false) => `
  <tr>
    <td style="padding: 12px 0; color: #64748b; font-size: 14px; border-bottom: 1px solid #e5edf6;">${escapeHtml(label)}</td>
    <td align="right" style="padding: 12px 0; color: ${highlight ? "#047857" : "#0f172a"}; font-size: 14px; font-weight: 700; border-bottom: 1px solid #e5edf6;">${escapeHtml(value)}</td>
  </tr>
`;

const buildEmailShell = ({ title, preheader, badge = "Paid", children }) => `
  <!doctype html>
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
      <title>${escapeHtml(title)}</title>
    </head>
    <body style="margin: 0; padding: 0; background: #eef6ff; font-family: Arial, Helvetica, sans-serif; color: #0f172a;">
      <div style="display: none; max-height: 0; overflow: hidden; opacity: 0; color: transparent;">${escapeHtml(preheader)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #eef6ff; margin: 0; padding: 24px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 640px; background: #ffffff; border-radius: 18px; overflow: hidden; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);">
              <tr>
                <td style="background: linear-gradient(135deg, #0f62fe 0%, #2563eb 52%, #06b6d4 100%); padding: 28px 30px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <div style="font-size: 22px; line-height: 28px; color: #ffffff; font-weight: 800; letter-spacing: 0.2px;">Flowlytiks</div>
                        <div style="font-size: 13px; line-height: 20px; color: #dbeafe; margin-top: 4px;">${escapeHtml(title)}</div>
                      </td>
                      <td align="right">
                        <span style="display: inline-block; background: #dcfce7; color: #047857; font-size: 12px; line-height: 16px; font-weight: 800; padding: 8px 12px; border-radius: 999px;">${escapeHtml(badge)}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px;">
                  ${children}
                </td>
              </tr>
              <tr>
                <td style="background: #f8fbff; padding: 20px 30px; color: #64748b; font-size: 12px; line-height: 18px; border-top: 1px solid #e5edf6;">
                  This is an automated payout confirmation from Flowlytiks.<br />
                  Thank you for your continued contribution.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;

const providerMessageId = (payload) =>
  clean(payload?.id || payload?.data?.id || payload?.message_id || payload?.data?.message_id) || null;

const isNotificationLogMissing = (error) => {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  return /NotificationLog|does not exist|P2021|P2022|42P01/i.test(text);
};

const isDuplicateLogError = (error) => {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  return /P2002|duplicate key|idempotencyKey/i.test(text);
};

const findNotificationLog = async (idempotencyKey) => {
  try {
    if (prisma.notificationLog) {
      return await prisma.notificationLog.findUnique({ where: { idempotencyKey } });
    }

    const rows = await prisma.$queryRaw`
      SELECT "id", "status"
      FROM "NotificationLog"
      WHERE "idempotencyKey" = ${idempotencyKey}
      LIMIT 1
    `;
    return rows?.[0] || null;
  } catch (error) {
    if (!isNotificationLogMissing(error)) {
      logWarn("email.notification_log_lookup_failed", { message: error?.message || error });
    }
    return null;
  }
};

const reserveNotificationLog = async (data) => {
  try {
    const existing = await findNotificationLog(data.idempotencyKey);
    if (String(existing?.status || "").toUpperCase() === "SENT") {
      return { reserved: false, duplicate: true, status: "SENT" };
    }
    if (existing?.id) {
      if (prisma.notificationLog) {
        await prisma.notificationLog.update({
          where: { id: existing.id },
          data: {
            ...data,
            status: "PENDING",
            providerMessageId: null,
            errorMessage: null,
            sentAt: null,
          },
        });
      } else {
        await prisma.$executeRaw`
          UPDATE "NotificationLog"
          SET "recipientType" = ${data.recipientType},
              "recipientId" = ${data.recipientId || null},
              "recipientEmail" = ${data.recipientEmail || null},
              "channel" = ${data.channel},
              "eventType" = ${data.eventType},
              "title" = ${data.title},
              "message" = ${data.message},
              "status" = ${"PENDING"},
              "providerMessageId" = NULL,
              "errorMessage" = NULL,
              "sentAt" = NULL
          WHERE "id" = ${existing.id}
        `;
      }
      return { reserved: true, id: existing.id, retried: true };
    }

    if (prisma.notificationLog) {
      const row = await prisma.notificationLog.create({
        data: {
          ...data,
          status: "PENDING",
        },
      });
      return { reserved: true, id: row.id };
    }

    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "NotificationLog"
        ("id", "recipientType", "recipientId", "recipientEmail", "channel", "eventType", "title", "message", "status",
         "relatedWeekStart", "relatedWeekEnd", "relatedPayrollId", "relatedPayoutId", "idempotencyKey", "createdAt")
      VALUES
        (${id}, ${data.recipientType}, ${data.recipientId || null}, ${data.recipientEmail || null}, ${data.channel},
         ${data.eventType}, ${data.title}, ${data.message}, ${"PENDING"}, ${data.relatedWeekStart || null},
         ${data.relatedWeekEnd || null}, ${data.relatedPayrollId || null}, ${data.relatedPayoutId || null},
         ${data.idempotencyKey}, ${new Date()})
    `;
    return { reserved: true, id };
  } catch (error) {
    if (isDuplicateLogError(error)) return { reserved: false, duplicate: true };
    if (isNotificationLogMissing(error)) {
      logWarn("email.notification_log_unavailable", { message: "NotificationLog table is not available." });
      return { reserved: true, id: null, logUnavailable: true };
    }
    logWarn("email.notification_log_reserve_failed", { message: error?.message || error });
    return { reserved: true, id: null, logUnavailable: true };
  }
};

const updateNotificationLog = async (id, data = {}) => {
  if (!id) return null;
  try {
    if (prisma.notificationLog) {
      return await prisma.notificationLog.update({ where: { id }, data });
    }

    await prisma.$executeRaw`
      UPDATE "NotificationLog"
      SET "status" = ${data.status || "FAILED"},
          "providerMessageId" = ${data.providerMessageId || null},
          "errorMessage" = ${data.errorMessage || null},
          "sentAt" = ${data.sentAt || null}
      WHERE "id" = ${id}
    `;
    return null;
  } catch (error) {
    if (!isNotificationLogMissing(error)) {
      logWarn("email.notification_log_update_failed", { message: error?.message || error });
    }
    return null;
  }
};

const sendViaResend = async ({ to, subject, text, html }) => {
  const apiKey = clean(process.env.RESEND_API_KEY);
  const from = getSenderEmail();
  if (!apiKey) {
    return { success: false, skipped: true, reason: "RESEND_API_KEY_MISSING" };
  }
  if (!from) {
    return { success: false, skipped: true, reason: "RESEND_FROM_EMAIL_MISSING" };
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
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        success: false,
        error: payload?.message || payload?.error?.message || response.statusText || "Email delivery failed.",
        statusCode: response.status,
      };
    }
    return { success: true, providerMessageId: providerMessageId(payload) };
  } catch (error) {
    return {
      success: false,
      error: error?.name === "AbortError" ? "Email API request timed out." : error?.message || "Email delivery failed.",
      errorName: error?.name || "Error",
    };
  } finally {
    clearTimeout(timeout);
  }
};

const deliverFacultyEmail = async ({
  faculty,
  subject,
  text,
  html,
  eventType,
  idempotencyKey,
  related = {},
  skipNotificationLog = false,
}) => {
  try {
    const recipientEmail = clean(faculty?.email);
    const recipientId = clean(faculty?.id);
    const title = subject;
    const message = text.slice(0, 500);

    if (!isEmailEnabled()) {
      logInfo("email.skipped", { eventType, reason: "NOTIFICATION_EMAIL_DISABLED", facultyId: recipientId });
      return { success: false, skipped: true, reason: "NOTIFICATION_EMAIL_DISABLED" };
    }

    if (!clean(process.env.RESEND_API_KEY)) {
      logWarn("email.skipped", { eventType, reason: "RESEND_API_KEY_MISSING", facultyId: recipientId });
      return { success: false, skipped: true, reason: "RESEND_API_KEY_MISSING" };
    }

    if (!getSenderEmail()) {
      logWarn("email.skipped", { eventType, reason: "RESEND_FROM_EMAIL_MISSING", facultyId: recipientId });
      return { success: false, skipped: true, reason: "RESEND_FROM_EMAIL_MISSING" };
    }

    if (!recipientEmail) {
      logWarn("email.skipped", { eventType, reason: "RECIPIENT_EMAIL_MISSING", facultyId: recipientId });
      return { success: false, skipped: true, reason: "RECIPIENT_EMAIL_MISSING" };
    }

    const reservation = skipNotificationLog
      ? { reserved: true, id: null }
      : await reserveNotificationLog({
          recipientType: "FACULTY",
          recipientId,
          recipientEmail,
          channel: "EMAIL",
          eventType,
          title,
          message,
          idempotencyKey,
          relatedWeekStart: related.weekStart || null,
          relatedWeekEnd: related.weekEnd || null,
          relatedPayrollId: related.payrollId || null,
          relatedPayoutId: related.payoutId || related.paymentId || null,
        });

    if (reservation.duplicate) {
      logInfo("email.skipped", { eventType, reason: "duplicate", facultyId: recipientId });
      return { success: false, skipped: true, duplicate: true, reason: "DUPLICATE_NOTIFICATION" };
    }

    const result = await sendViaResend({ to: recipientEmail, subject, text, html });
    if (result.success) {
      await updateNotificationLog(reservation.id, {
        status: "SENT",
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
      });
      logInfo("email.sent", { eventType, facultyId: recipientId, providerMessageId: result.providerMessageId || null });
      return result;
    }

    await updateNotificationLog(reservation.id, {
      status: result.skipped ? "SKIPPED" : "FAILED",
      errorMessage: result.reason || result.error || "Email delivery failed.",
    });
    logWarn(result.skipped ? "email.skipped" : "email.failed", {
      eventType,
      reason: result.reason || result.error,
      statusCode: result.statusCode || null,
      facultyId: recipientId,
    });
    return result;
  } catch (error) {
    logWarn("email.failed", { eventType, message: error?.message || error });
    return { success: false, error: error?.message || "Email notification failed." };
  }
};

export const sendFacultyWeeklyPayoutEmail = async ({
  faculty,
  payout = {},
  breakdown = {},
  idempotencyKey: idempotencyKeyOverride,
  skipNotificationLog = false,
} = {}) => {
  const weekStart = breakdown.weekStart || payout.weekStart || payout.weeklyPaymentRecord?.weekStart;
  const weekEnd = breakdown.weekEnd || payout.weekEnd || payout.weeklyPaymentRecord?.weekEnd;
  const paymentMethod = breakdown.paymentMethod || payout.paymentMode || payout.payoutMode || "Cashfree Payout";
  const paidAt = breakdown.paidAt || payout.paidAt || new Date();
  const reference = breakdown.reference || payout.utr || payout.transactionId || payout.cashfreeReferenceId || payout.cashfreeTransferId || "-";
  const payableAmount = breakdown.payableAmount ?? payout.amount ?? payout.paidAmount;
  const paidAmount = breakdown.paidAmount ?? payout.paidAmount ?? payout.amount;
  const idempotencyKey = idempotencyKeyOverride || `faculty-weekly-payout-paid:${payout.id || breakdown.id}`;

  if (!payout.id && !breakdown.id) {
    logWarn("email.skipped", { eventType: "FACULTY_WEEKLY_PAYOUT_PAID", reason: "missing_payout_id" });
    return { success: false, skipped: true, reason: "missing_payout_id" };
  }

  const name = facultyGreetingName(faculty);
  const subject = "Flowlytiks Weekly Payout Confirmation";
  const text = [
    `Dear ${name},`,
    "",
    "Your weekly faculty payout has been marked as paid.",
    `Week period: ${formatDateOnly(weekStart)} to ${formatDateOnly(weekEnd)}`,
    `Paid amount: ${formatCurrency(paidAmount)}`,
    `Payment method: ${paymentMethod}`,
    `UTR / transaction reference: ${reference}`,
    `Paid date: ${formatDate(paidAt)}`,
    "",
    "This is an automated payout confirmation from Flowlytiks.",
  ].join("\n");
  const html = buildEmailShell({
    title: "Weekly Payout Confirmation",
    preheader: `Your weekly payout of ${formatCurrency(paidAmount)} has been marked as paid.`,
    children: `
      <p style="margin: 0 0 10px; color: #0f172a; font-size: 18px; line-height: 26px; font-weight: 800;">Dear ${escapeHtml(name)},</p>
      <p style="margin: 0 0 22px; color: #475569; font-size: 15px; line-height: 24px;">Your weekly faculty payout has been marked as paid. The details are below for your records.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f8fbff; border: 1px solid #dbeafe; border-radius: 14px; padding: 0 18px; margin: 0 0 22px;">
        ${detailRow("Week period", `${formatDateOnly(weekStart)} to ${formatDateOnly(weekEnd)}`)}
        ${detailRow("Paid amount", formatCurrency(paidAmount), true)}
        ${detailRow("Payment method", paymentMethod)}
        ${detailRow("UTR / transaction reference", reference)}
        ${detailRow("Paid date", formatDate(paidAt))}
      </table>
      <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 20px;">If you have any questions about this payout, please contact the institute administration.</p>
    `,
  });

  return deliverFacultyEmail({
    faculty,
    subject,
    text,
    html,
    eventType: "FACULTY_WEEKLY_PAYOUT_PAID",
    idempotencyKey,
    skipNotificationLog,
    related: {
      weekStart,
      weekEnd,
      payrollId: breakdown.payrollId || payout.payrollId,
      payoutId: payout.id,
    },
  });
};

export const sendFacultyExtraIncentiveEmail = async ({
  faculty,
  payment = {},
  lineItems = [],
  idempotencyKey: idempotencyKeyOverride,
  skipNotificationLog = false,
} = {}) => {
  const idempotencyKey = idempotencyKeyOverride || `faculty-extra-incentive-paid:${payment.id}`;
  if (!payment.id) {
    logWarn("email.skipped", { eventType: "FACULTY_EXTRA_INCENTIVE_PAID", reason: "missing_payment_id" });
    return { success: false, skipped: true, reason: "missing_payment_id" };
  }

  const rows = (Array.isArray(lineItems) ? lineItems : []).map((item) => ({
    name: item.name || "Incentive",
    quantity: Number(item.quantity || item.count || 0),
    rate: money(item.rate),
    amount: money(item.amount),
  }));
  const method = payment.paymentMethod === "CASHFREE" ? "Cashfree Payout" : "Cash";
  const reference = payment.utr || payment.transactionId || payment.cashfreeReferenceId || payment.cashfreeTransferId || "-";
  const paidAt = payment.paidAt || new Date();
  const name = facultyGreetingName(faculty);
  const breakdownText = rows.length
    ? rows.map((item) => `- ${item.name}: ${item.quantity} x ${formatCurrency(item.rate)} = ${formatCurrency(item.amount)}`).join("\n")
    : "-";
  const breakdownHtml = rows.length
    ? rows
        .map(
          (item) =>
            `<tr>
              <td style="padding: 12px 10px; color: #0f172a; font-size: 13px; border-bottom: 1px solid #e5edf6;">${escapeHtml(item.name)}</td>
              <td align="center" style="padding: 12px 10px; color: #334155; font-size: 13px; border-bottom: 1px solid #e5edf6;">${escapeHtml(item.quantity)}</td>
              <td align="right" style="padding: 12px 10px; color: #334155; font-size: 13px; border-bottom: 1px solid #e5edf6;">${escapeHtml(formatCurrency(item.rate))}</td>
              <td align="right" style="padding: 12px 10px; color: #047857; font-size: 13px; font-weight: 800; border-bottom: 1px solid #e5edf6;">${escapeHtml(formatCurrency(item.amount))}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="4" style="padding: 14px 10px; color: #64748b; font-size: 13px;">-</td></tr>`;

  const subject = "Flowlytiks Extra Incentive Payout Confirmation";
  const text = [
    `Dear ${name},`,
    "",
    "Your extra incentive payout has been completed.",
    "Incentive breakdown:",
    breakdownText,
    `Total amount: ${formatCurrency(payment.totalAmount)}`,
    `Payment method: ${method}`,
    `UTR / transaction reference: ${reference}`,
    `Paid date: ${formatDate(paidAt)}`,
    "",
    "This is an automated payout confirmation from Flowlytiks.",
  ].join("\n");
  const html = buildEmailShell({
    title: "Extra Incentive Payout Confirmation",
    preheader: `Your extra incentive payout of ${formatCurrency(payment.totalAmount)} has been completed.`,
    children: `
      <p style="margin: 0 0 10px; color: #0f172a; font-size: 18px; line-height: 26px; font-weight: 800;">Dear ${escapeHtml(name)},</p>
      <p style="margin: 0 0 22px; color: #475569; font-size: 15px; line-height: 24px;">Your extra incentive payout has been completed. The incentive-wise breakdown is included below.</p>
      <div style="overflow-x: auto; margin: 0 0 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #dbeafe; border-radius: 14px; overflow: hidden; min-width: 520px;">
          <tr>
            <th align="left" style="background: #eff6ff; padding: 12px 10px; color: #1d4ed8; font-size: 12px; text-transform: uppercase;">Incentive Name</th>
            <th align="center" style="background: #eff6ff; padding: 12px 10px; color: #1d4ed8; font-size: 12px; text-transform: uppercase;">Count</th>
            <th align="right" style="background: #eff6ff; padding: 12px 10px; color: #1d4ed8; font-size: 12px; text-transform: uppercase;">Rate</th>
            <th align="right" style="background: #eff6ff; padding: 12px 10px; color: #1d4ed8; font-size: 12px; text-transform: uppercase;">Amount</th>
          </tr>
          ${breakdownHtml}
        </table>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #f8fbff; border: 1px solid #dbeafe; border-radius: 14px; padding: 0 18px; margin: 0 0 22px;">
        ${detailRow("Total paid", formatCurrency(payment.totalAmount), true)}
        ${detailRow("Payment method", method)}
        ${detailRow("UTR / transaction reference", reference)}
        ${detailRow("Paid date", formatDate(paidAt))}
      </table>
      <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 20px;">If you have any questions about this payout, please contact the institute administration.</p>
    `,
  });

  return deliverFacultyEmail({
    faculty,
    subject,
    text,
    html,
    eventType: "FACULTY_EXTRA_INCENTIVE_PAID",
    idempotencyKey,
    skipNotificationLog,
    related: { paymentId: payment.id },
  });
};
