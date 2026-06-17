import crypto from "node:crypto";
import prisma from "../prisma/client.js";
import { logInfo, logWarn } from "../utils/appLogger.js";
import {
  sendFacultyExtraIncentiveEmail,
  sendFacultyWeeklyPayoutEmail,
} from "./emailNotificationService.js";

const CASHFREE_API_VERSION = "2024-01-01";
const PROCESSING_STATUSES = new Set(["PENDING", "PROCESSING"]);
const PAID_STATUSES = new Set(["SUCCESS", "PAID"]);
const FAILED_STATUSES = new Set(["FAILED", "CANCELLED", "REVERSED"]);

const clean = (value) => String(value || "").trim();
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

const normalizeEnvironment = () => {
  const env = clean(process.env.CASHFREE_PAYOUT_ENVIRONMENT || process.env.CASHFREE_ENVIRONMENT || "sandbox").toLowerCase();
  return env === "production" ? "production" : "sandbox";
};

const defaultBaseUrl = (environment) =>
  environment === "production"
    ? "https://api.cashfree.com/payout"
    : "https://sandbox.cashfree.com/payout";

export const getCashfreePayoutConfig = () => {
  const environment = normalizeEnvironment();
  return {
    clientId: clean(process.env.CASHFREE_PAYOUT_CLIENT_ID),
    clientSecret: clean(process.env.CASHFREE_PAYOUT_CLIENT_SECRET),
    environment,
    baseUrl: clean(process.env.CASHFREE_PAYOUT_API_BASE_URL) || defaultBaseUrl(environment),
    webhookSecret: clean(process.env.CASHFREE_PAYOUT_WEBHOOK_SECRET),
    sandboxEnabled: clean(process.env.ENABLE_CASHFREE_PAYOUT_SANDBOX || "true") !== "false",
    realPayoutsEnabled: clean(process.env.ENABLE_REAL_CASHFREE_PAYOUTS || "false") === "true",
  };
};

const assertPayoutConfig = () => {
  const config = getCashfreePayoutConfig();
  const allowed =
    config.environment === "sandbox" ? config.sandboxEnabled : config.realPayoutsEnabled;

  if (!config.clientId || !config.clientSecret || !allowed) {
    const error = new Error("Cashfree payout configuration is not available.");
    error.statusCode = 503;
    throw error;
  }

  return config;
};

const cashfreeHeaders = (config, requestId) => ({
  "Content-Type": "application/json",
  "x-client-id": config.clientId,
  "x-client-secret": config.clientSecret,
  "x-api-version": CASHFREE_API_VERSION,
  "x-request-id": requestId,
});

const cashfreeRequest = async (path, { method = "GET", body, requestId = crypto.randomUUID() } = {}) => {
  const config = assertPayoutConfig();
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: cashfreeHeaders(config, requestId),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || "Cashfree payout request failed.");
    error.statusCode = response.status >= 500 ? 502 : response.status;
    error.cashfreeStatus = response.status;
    error.responseData = data;
    throw error;
  }

  return data;
};

export const mapCashfreePayoutStatus = (value) => {
  const status = clean(value).toUpperCase();
  if (["SUCCESS", "COMPLETED", "PAID", "SUCCESSFUL"].includes(status)) return "SUCCESS";
  if (["FAILED", "REJECTED", "REVERSED", "CANCELLED", "CANCELED"].includes(status)) return "FAILED";
  if (["PENDING", "PROCESSING", "RECEIVED", "ACCEPTED", "QUEUED", "INITIATED"].includes(status)) return "PROCESSING";
  return "PROCESSING";
};

const getLatestBankAccount = (faculty) =>
  Array.isArray(faculty?.bankAccounts) ? faculty.bankAccounts[0] : null;

export const maskSensitivePayoutData = (value = {}) => {
  if (!value || typeof value !== "object") return {};
  const blocked = /(accountNumber|upiId|ifsc|clientSecret|secret|authorization|token)/i;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, blocked.test(key) ? "[redacted]" : entry])
  );
};

export const createOrGetBeneficiary = async (faculty) => {
  const bank = getLatestBankAccount(faculty);
  if (!faculty || !bank) {
    const error = new Error("Faculty payout details are missing.");
    error.statusCode = 400;
    throw error;
  }
  if (bank.verificationStatus !== "VERIFIED" || !bank.payoutEligible) {
    const error = new Error("Faculty payout details are not verified.");
    error.statusCode = 400;
    throw error;
  }
  if (bank.cashfreeBeneficiaryId) return bank.cashfreeBeneficiaryId;

  const beneficiaryId = `faculty_${faculty.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const payload = {
    beneficiary_id: beneficiaryId,
    beneficiary_name: bank.accountHolderName || faculty.fullName || faculty.facultyId || "Faculty",
    beneficiary_email: bank.payoutContactEmail || faculty.email || undefined,
    beneficiary_phone: bank.payoutContactPhone || faculty.phone || undefined,
    beneficiary_instrument_details: {
      bank_account_number: bank.accountNumber || undefined,
      bank_ifsc: bank.ifscCode || undefined,
      vpa: bank.upiId || undefined,
    },
  };

  try {
    await cashfreeRequest("/beneficiaries", { method: "POST", body: payload, requestId: `beneficiary-${beneficiaryId}` });
  } catch (error) {
    const message = String(error?.message || "");
    if (!/already exists|duplicate/i.test(message)) throw error;
  }

  await prisma.facultyBankAccount.update({
    where: { id: bank.id },
    data: {
      cashfreeBeneficiaryId: beneficiaryId,
      cashfreeBeneficiaryStatus: "CREATED",
      cashfreeBeneficiaryCreatedAt: bank.cashfreeBeneficiaryCreatedAt || new Date(),
      cashfreeBeneficiaryUpdatedAt: new Date(),
    },
  });

  return beneficiaryId;
};

export const createBeneficiaryForFaculty = async (facultyId) => {
  const faculty = await prisma.faculty.findUnique({
    where: { id: facultyId },
    include: { bankAccounts: { orderBy: { updatedAt: "desc" }, take: 1 } },
  });
  if (!faculty) {
    const error = new Error("Faculty not found.");
    error.statusCode = 404;
    throw error;
  }
  const beneficiaryId = await createOrGetBeneficiary(faculty);
  return { beneficiaryId };
};

const getPayoutWithFaculty = (payoutId) =>
  prisma.facultyPayout.findUnique({
    where: { id: payoutId },
    include: {
      faculty: { include: { bankAccounts: { orderBy: { updatedAt: "desc" }, take: 1 } } },
      payroll: { include: { payrollCycle: true } },
    },
  });

export const initiateFacultyTransfer = async (paymentRecord, facultyRecord) =>
  initiatePayoutTransfer(paymentRecord?.id || facultyRecord?.payoutId);

export const initiatePayoutTransfer = async (payoutId, opts = {}) => {
  const payout = await getPayoutWithFaculty(payoutId);
  if (!payout) {
    const error = new Error("Payout not found.");
    error.statusCode = 404;
    throw error;
  }
  if (PAID_STATUSES.has(payout.status) || PROCESSING_STATUSES.has(payout.status)) {
    return payout;
  }
  if (money(payout.amount) <= 0) {
    const error = new Error("Payout amount must be greater than zero.");
    error.statusCode = 400;
    throw error;
  }

  const beneficiaryId = await createOrGetBeneficiary(payout.faculty);
  const referenceId =
    payout.cashfreeReferenceId ||
    payout.referenceId ||
    `FPAY-${payout.id}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 45);
  const transferId = payout.cashfreeTransferId || referenceId;
  const payload = {
    transfer_id: transferId,
    transfer_amount: money(payout.amount),
    beneficiary_details: { beneficiary_id: beneficiaryId },
    transfer_mode: payout.payoutMode === "UPI" ? "upi" : "banktransfer",
    remarks: `Flowlytiks faculty payout ${referenceId}`,
  };

  await prisma.facultyPayout.update({
    where: { id: payout.id },
    data: {
      status: "PROCESSING",
      cashfreeReferenceId: referenceId,
      cashfreeTransferId: transferId,
      idempotencyKey: payout.idempotencyKey || referenceId,
      payoutRequestedAt: payout.payoutRequestedAt || new Date(),
      paidBy: opts.adminId ? String(opts.adminId) : payout.paidBy,
      failureReason: null,
    },
  });

  try {
    const result = await cashfreeRequest("/transfers", {
      method: "POST",
      body: payload,
      requestId: referenceId,
    });
    const rawStatus = result?.status || result?.transfer_status || result?.data?.status;
    const mappedStatus = mapCashfreePayoutStatus(rawStatus);
    return prisma.facultyPayout.update({
      where: { id: payout.id },
      data: {
        status: mappedStatus,
        cashfreeStatus: rawStatus || mappedStatus,
        gatewayReference: result?.cf_transfer_id || result?.data?.cf_transfer_id || null,
        transactionId: result?.transfer_id || result?.data?.transfer_id || transferId,
        payoutProcessedAt: new Date(),
        paidAt: mappedStatus === "SUCCESS" ? new Date() : null,
        payoutCompletedAt: mappedStatus === "SUCCESS" ? new Date() : null,
        paidAmount: mappedStatus === "SUCCESS" ? payout.amount : 0,
        unpaidAmount: mappedStatus === "SUCCESS" ? 0 : payout.amount,
      },
    });
  } catch (error) {
    if (Number(error.cashfreeStatus) >= 500) {
      logWarn("cashfree_payout.transfer_unknown_after_5xx", { payoutId: payout.id, referenceId });
      return prisma.facultyPayout.update({
        where: { id: payout.id },
        data: {
          status: "PROCESSING",
          cashfreeStatus: "UNKNOWN_AFTER_5XX",
          failureReason: "Cashfree returned a temporary error. Check transfer status before retrying.",
        },
      });
    }
    await prisma.facultyPayout.update({
      where: { id: payout.id },
      data: {
        status: "FAILED",
        cashfreeStatus: "FAILED",
        failureReason: error?.message || "Cashfree payout failed.",
        payoutFailedAt: new Date(),
        unpaidAmount: payout.amount,
      },
    });
    throw error;
  }
};

export const getTransferStatus = async (transferIdOrReferenceId) => {
  const id = encodeURIComponent(clean(transferIdOrReferenceId));
  if (!id) {
    const error = new Error("Transfer reference is required.");
    error.statusCode = 400;
    throw error;
  }
  return cashfreeRequest(`/transfers/${id}`);
};

const extractWebhookData = (payload = {}) => payload?.data?.transfer || payload?.data || payload || {};

const extractTransferReference = (payload = {}) => {
  const data = extractWebhookData(payload);
  return {
    transferId: clean(data.transfer_id || data.transferId || data.cashfreeTransferId || payload.transfer_id),
    referenceId: clean(data.reference_id || data.referenceId || data.cashfreeReferenceId || data.transfer_id || payload.reference_id),
  };
};

export const updatePayoutFromCashfreePayload = async (payload = {}) => {
  const data = extractWebhookData(payload);
  const { transferId, referenceId } = extractTransferReference(payload);
  if (!transferId && !referenceId) {
    return { ignored: true, reason: "missing_transfer_reference" };
  }

  const payout = await prisma.facultyPayout.findFirst({
    where: {
      OR: [
        transferId ? { cashfreeTransferId: transferId } : undefined,
        transferId ? { transactionId: transferId } : undefined,
        referenceId ? { cashfreeReferenceId: referenceId } : undefined,
        referenceId ? { referenceId } : undefined,
      ].filter(Boolean),
    },
    include: { payroll: { include: { payrollCycle: true } } },
  });
  if (!payout) return { ignored: true, reason: "payout_not_found", transferId, referenceId };

  const rawStatus = data.status || data.transfer_status || payload.status || payload.event;
  const nextStatus = mapCashfreePayoutStatus(rawStatus);
  const now = new Date();
  if (payout.status === nextStatus && ["SUCCESS", "FAILED"].includes(nextStatus)) {
    return { ignored: true, reason: "duplicate_final_status", payoutId: payout.id, status: nextStatus };
  }

  const transactionId = clean(data.utr || data.transaction_id || data.cf_transfer_id || data.transfer_id);
  const failureReason = clean(data.reason || data.failure_reason || data.status_description);
  const updated = await prisma.facultyPayout.update({
    where: { id: payout.id },
    data: {
      status: nextStatus,
      cashfreeStatus: rawStatus || nextStatus,
      cashfreeTransferId: transferId || payout.cashfreeTransferId,
      cashfreeReferenceId: referenceId || payout.cashfreeReferenceId,
      transactionId: transactionId || payout.transactionId,
      utr: clean(data.utr) || payout.utr,
      gatewayReference: clean(data.cf_transfer_id) || payout.gatewayReference,
      failureReason: nextStatus === "FAILED" ? failureReason || "Payout failed." : null,
      paidAt: nextStatus === "SUCCESS" ? payout.paidAt || now : payout.paidAt,
      payoutCompletedAt: nextStatus === "SUCCESS" ? payout.payoutCompletedAt || now : payout.payoutCompletedAt,
      payoutFailedAt: nextStatus === "FAILED" ? payout.payoutFailedAt || now : payout.payoutFailedAt,
      payoutProcessedAt: ["SUCCESS", "FAILED"].includes(nextStatus) ? payout.payoutProcessedAt || now : payout.payoutProcessedAt,
      paidAmount: nextStatus === "SUCCESS" ? payout.amount : payout.paidAmount,
      unpaidAmount: nextStatus === "SUCCESS" ? 0 : payout.unpaidAmount,
    },
  });

  await prisma.facultyPayoutEvent
    .create({
      data: {
        payoutId: payout.id,
        eventType: clean(payload.type || payload.event || "CASHFREE_PAYOUT_WEBHOOK"),
        oldStatus: payout.status,
        newStatus: nextStatus,
        cashfreeReferenceId: referenceId || null,
        cashfreeTransferId: transferId || null,
        utr: clean(data.utr) || null,
        message: failureReason || null,
        rawPayloadJson: maskSensitivePayoutData(payload),
        dedupeKey: `${payout.id}:${clean(payload.event_id || payload.id || transferId || referenceId)}:${nextStatus}`,
      },
    })
    .catch(() => null);

  if (payout.payroll?.payrollCycleId && ["SUCCESS", "FAILED", "PROCESSING"].includes(nextStatus)) {
    await refreshWeeklyRecordFromPayout(updated).catch((error) =>
      logWarn("cashfree_payout.weekly_record_sync_failed", { payoutId: payout.id, message: error?.message })
    );
  }

  if (nextStatus === "SUCCESS") {
    const completedPayout = await prisma.facultyPayout
      .findUnique({
        where: { id: payout.id },
        include: {
          faculty: true,
          payroll: { include: { payrollCycle: true } },
        },
      })
      .catch(() => null);

    if (completedPayout?.payroll?.payrollCycle) {
      await sendFacultyWeeklyPayoutEmail({
        faculty: completedPayout.faculty,
        payout: completedPayout,
        idempotencyKey: `faculty-weekly-payout-paid:${completedPayout.payroll.payrollCycleId || completedPayout.payroll.payrollCycle.id}:${completedPayout.facultyId}`,
        breakdown: {
          weekStart: completedPayout.payroll.payrollCycle.startDate,
          weekEnd: completedPayout.payroll.payrollCycle.endDate,
          paymentMethod: "Cashfree Payout",
          payableAmount: completedPayout.amount,
          paidAmount: completedPayout.paidAmount || completedPayout.amount,
          paidAt: completedPayout.paidAt,
          reference:
            completedPayout.utr ||
            completedPayout.transactionId ||
            completedPayout.cashfreeReferenceId ||
            completedPayout.cashfreeTransferId ||
            "-",
          payrollId: completedPayout.payrollId,
        },
      });
    }

    const extraPayment = prisma.facultyExtraIncentivePayment
      ? await prisma.facultyExtraIncentivePayment
          .findFirst({
            where: { facultyPayoutId: payout.id },
            include: { faculty: true },
          })
          .catch(() => null)
      : null;
    if (extraPayment) {
      await sendFacultyExtraIncentiveEmail({
        faculty: extraPayment.faculty,
        payment: {
          ...extraPayment,
          paymentMethod: extraPayment.paymentMethod || "CASHFREE",
          utr: completedPayout?.utr || extraPayment.utr,
          transactionId: completedPayout?.transactionId || extraPayment.transactionId,
          cashfreeReferenceId: completedPayout?.cashfreeReferenceId || extraPayment.cashfreeReferenceId,
          cashfreeTransferId: completedPayout?.cashfreeTransferId || extraPayment.cashfreeTransferId,
          paidAt: completedPayout?.paidAt || extraPayment.paidAt,
        },
        lineItems: extraPayment.summaryJson || [],
        idempotencyKey: `faculty-extra-incentive-paid:${extraPayment.id}`,
      });
    }
  }

  return { payoutId: payout.id, status: nextStatus };
};

export const handlePayoutWebhook = async (payload, headers = {}) =>
  updatePayoutFromCashfreePayload(payload, headers);

export const handleCashfreePayoutWebhookPayload = async (payload) =>
  updatePayoutFromCashfreePayload(payload);

export const syncPayoutStatus = async (payoutId) => {
  const payout = await prisma.facultyPayout.findUnique({ where: { id: payoutId } });
  if (!payout) return null;
  if (!payout.cashfreeTransferId && !payout.cashfreeReferenceId) return payout;

  const statusPayload = await getTransferStatus(payout.cashfreeTransferId || payout.cashfreeReferenceId);
  await updatePayoutFromCashfreePayload({
    event: "TRANSFER_STATUS_SYNC",
    data: {
      ...statusPayload,
      transfer_id: payout.cashfreeTransferId,
      reference_id: payout.cashfreeReferenceId,
    },
  });
  return prisma.facultyPayout.findUnique({ where: { id: payoutId } });
};

export const retryFailedPayout = async (payoutId, opts = {}) => {
  const payout = await prisma.facultyPayout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new Error("Payout not found.");
  if (PAID_STATUSES.has(payout.status) || PROCESSING_STATUSES.has(payout.status)) {
    throw new Error("Paid or processing payout cannot be retried.");
  }
  await prisma.facultyPayout.update({
    where: { id: payoutId },
    data: {
      status: "PENDING",
      retryCount: { increment: 1 },
      lastRetryAt: new Date(),
      cashfreeTransferId: null,
      cashfreeReferenceId: `FPAY-RETRY-${Date.now()}-${payout.id.slice(0, 8)}`,
      failureReason: null,
    },
  });
  return initiatePayoutTransfer(payoutId, opts);
};

export const verifyCashfreePayoutWebhookSignature = (req) => {
  const secret = getCashfreePayoutConfig().webhookSecret;
  if (!secret) return true;
  const signature =
    req.headers["x-webhook-signature"] ||
    req.headers["x-cf-signature"] ||
    req.headers["x-cashfree-signature"] ||
    req.headers["cashfree-signature"];
  if (!signature) return false;

  const rawBody = req.rawBody || JSON.stringify(req.body || {});
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const hexDigest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return [digest, hexDigest].some((candidate) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(String(signature)));
    } catch {
      return false;
    }
  });
};

const refreshWeeklyRecordFromPayout = async (payout) => {
  if (!payout?.payrollId || !prisma.weeklyFacultyPaymentRecord) return null;
  const full = await prisma.facultyPayout.findUnique({
    where: { id: payout.id },
    include: { payroll: { include: { payrollCycle: true } } },
  });
  const cycle = full?.payroll?.payrollCycle;
  if (!cycle) return null;
  const payouts = await prisma.facultyPayout.findMany({
    where: { payroll: { payrollCycleId: cycle.id } },
  });
  const allPaid = payouts.length > 0 && payouts.every((row) => row.status === "SUCCESS");
  const anyProcessing = payouts.some((row) => row.status === "PROCESSING");
  const allFailed = payouts.length > 0 && payouts.every((row) => FAILED_STATUSES.has(row.status));
  const status = allPaid ? "PAID" : anyProcessing ? "PROCESSING" : allFailed ? "FAILED" : "PROCESSING";
  const paidAmount = payouts
    .filter((row) => row.status === "SUCCESS")
    .reduce((sum, row) => sum + money(row.amount), 0);
  const totalAmount = payouts.reduce((sum, row) => sum + money(row.amount), 0);

  const record = await prisma.weeklyFacultyPaymentRecord.findUnique({
    where: { weekStart_weekEnd: { weekStart: cycle.startDate, weekEnd: cycle.endDate } },
  });
  if (!record) return null;

  await prisma.weeklyFacultyPaymentRecord.update({
    where: { id: record.id },
    data: {
      status,
      paidAmount,
      pendingAmount: Math.max(0, money(totalAmount - paidAmount)),
      paidAt: allPaid ? record.paidAt || new Date() : record.paidAt,
    },
  });

  await Promise.all(
    payouts.map((row) =>
      prisma.facultyPaymentRecord.updateMany({
        where: { weeklyPaymentRecordId: record.id, facultyId: row.facultyId },
        data: {
          status: row.status === "SUCCESS" ? "PAID" : row.status === "FAILED" ? "FAILED" : row.status,
          cashfreeTransferId: row.cashfreeTransferId,
          cashfreeReferenceId: row.cashfreeReferenceId,
          utr: row.utr,
          transactionId: row.transactionId,
          failureReason: row.failureReason,
          paidAt: row.paidAt,
        },
      })
    )
  );

  if (["PAID", "PROCESSING"].includes(status)) {
    await prisma.payrollCycle
      .update({ where: { id: cycle.id }, data: { ledgerLocked: true } })
      .catch(() => null);
  }

  logInfo("cashfree_payout.weekly_record_synced", { cycleId: cycle.id, status });
  return record;
};
