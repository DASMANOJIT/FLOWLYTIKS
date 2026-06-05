import crypto from "node:crypto";
import prisma from "../prisma/client.js";
import { logInfo, logWarn } from "../utils/appLogger.js";

const DEFAULT_TIMEOUT_MS = 15000;
const SUCCESS_STATUSES = new Set(["SUCCESS", "COMPLETED", "PAID", "TRANSFER_SUCCESS", "TRANSFER_ACKNOWLEDGED"]);
const FAILED_STATUSES = new Set(["FAILED", "REJECTED", "CANCELLED", "REVERSED", "TRANSFER_FAILED", "TRANSFER_REJECTED", "TRANSFER_REVERSED"]);
const PROCESSING_STATUSES = new Set(["PENDING", "PROCESSING", "APPROVED", "INITIATED", "TRANSFER_APPROVED"]);

const text = (value) => String(value || "").trim();
const boolEnv = (value) => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());
const moneyNumber = (value) => Number(value || 0);

export const getCashfreePayoutConfig = () => {
  const environment = text(process.env.CASHFREE_PAYOUT_ENVIRONMENT || "sandbox").toLowerCase() === "production"
    ? "production"
    : "sandbox";
  const baseUrl =
    text(process.env.CASHFREE_PAYOUT_API_BASE_URL) ||
    (environment === "production"
      ? "https://api.cashfree.com/payout"
      : "https://sandbox.cashfree.com/payout");

  return {
    clientId: text(process.env.CASHFREE_PAYOUT_CLIENT_ID),
    clientSecret: text(process.env.CASHFREE_PAYOUT_CLIENT_SECRET),
    webhookSecret: text(process.env.CASHFREE_PAYOUT_WEBHOOK_SECRET || process.env.CASHFREE_PAYOUT_CLIENT_SECRET),
    environment,
    baseUrl: baseUrl.replace(/\/$/, ""),
    enableRealPayouts: boolEnv(process.env.ENABLE_REAL_CASHFREE_PAYOUTS),
    enableSandbox: process.env.ENABLE_CASHFREE_PAYOUT_SANDBOX === undefined || boolEnv(process.env.ENABLE_CASHFREE_PAYOUT_SANDBOX),
  };
};

const assertConfigured = () => {
  const config = getCashfreePayoutConfig();
  if (!config.clientId || !config.clientSecret) {
    const error = new Error("Cashfree payout credentials are not configured.");
    error.statusCode = 503;
    throw error;
  }
  if (config.environment === "production" && !config.enableRealPayouts) {
    const error = new Error("Real Cashfree payouts are disabled. Set ENABLE_REAL_CASHFREE_PAYOUTS=true to enable production transfers.");
    error.statusCode = 403;
    throw error;
  }
  if (config.environment === "sandbox" && !config.enableSandbox) {
    const error = new Error("Cashfree payout sandbox is disabled.");
    error.statusCode = 403;
    throw error;
  }
  return config;
};

const sanitizeGatewayPayload = (payload) => {
  if (!payload || typeof payload !== "object") return payload || null;
  const redactedKeys = /(account|ifsc|upi|secret|token|authorization|signature|beneficiary_phone|beneficiary_email)/i;
  return Object.fromEntries(
    Object.entries(payload)
      .slice(0, 40)
      .map(([key, value]) => [
        key,
        redactedKeys.test(key) ? "[redacted]" : (typeof value === "object" ? sanitizeGatewayPayload(value) : value),
      ])
  );
};

const toGatewayError = async (response, fallbackMessage) => {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const error = new Error(payload?.message || payload?.error || fallbackMessage || "Cashfree payout request failed.");
  error.statusCode = response.status >= 500 ? 502 : response.status;
  error.gatewayPayload = sanitizeGatewayPayload(payload);
  return error;
};

const cashfreeRequest = async (path, { method = "GET", body, token, headers = {} } = {}) => {
  const config = assertConfigured();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2024-01-01",
        "x-client-id": config.clientId,
        "x-client-secret": config.clientSecret,
        "x-request-id": crypto.randomUUID(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw await toGatewayError(response, "Cashfree payout request failed.");
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Cashfree payout request timed out.");
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const normalizeCashfreePayoutStatus = (cashfreeStatus, acknowledged) => {
  const status = text(cashfreeStatus).toUpperCase();
  if ((status === "SUCCESS" || status === "TRANSFER_SUCCESS") && Number(acknowledged) === 1) return "SUCCESS";
  if (SUCCESS_STATUSES.has(status)) return "SUCCESS";
  if (FAILED_STATUSES.has(status)) return status === "REVERSED" || status === "TRANSFER_REVERSED" ? "REVERSED" : "FAILED";
  if (PROCESSING_STATUSES.has(status)) return "PROCESSING";
  return "PROCESSING";
};

const getLatestBankAccount = async (facultyId) =>
  prisma.facultyBankAccount.findFirst({
    where: { facultyId },
    orderBy: { updatedAt: "desc" },
  });

const assertBankAccountReady = (account) => {
  if (!account) throw new Error("Faculty payout details are missing.");
  if (account.verificationStatus !== "VERIFIED") throw new Error("Faculty payout details are not verified.");
  if (!account.payoutEligible) throw new Error("Faculty is not payout eligible.");
  if (["UPI", "BOTH"].includes(account.payoutMode) && !account.upiId && account.payoutMode === "UPI") {
    throw new Error("Verified UPI ID is missing.");
  }
  if (["BANK", "BOTH"].includes(account.payoutMode) && (!account.accountHolderName || !account.accountNumber || !account.ifscCode || !account.bankName)) {
    throw new Error("Verified bank details are incomplete.");
  }
};

const beneficiaryIdForFaculty = (faculty) => `FLOW_FAC_${String(faculty.facultyId || faculty.id).replace(/[^A-Za-z0-9_-]/g, "")}`;

const buildBeneficiaryPayload = (faculty, account) => {
  const beneficiaryId = account.cashfreeBeneficiaryId || beneficiaryIdForFaculty(faculty);
  const payload = {
    beneficiary_id: beneficiaryId,
    beneficiary_name: account.accountHolderName || faculty.fullName,
    beneficiary_instrument_details: {},
    beneficiary_contact_details: {
      beneficiary_email: account.payoutContactEmail || faculty.email || undefined,
      beneficiary_phone: account.payoutContactPhone || faculty.phone || undefined,
      beneficiary_country_code: "+91",
      beneficiary_address: faculty.address || "Flowlytiks faculty payout beneficiary",
    },
  };
  if (["BANK", "BOTH"].includes(account.payoutMode)) {
    payload.beneficiary_instrument_details.bank_account_number = account.accountNumber;
    payload.beneficiary_instrument_details.bank_ifsc = account.ifscCode;
  }
  if (["UPI", "BOTH"].includes(account.payoutMode) && account.upiId) {
    payload.beneficiary_instrument_details.vpa = account.upiId;
  }
  return payload;
};

export const createBeneficiaryForFaculty = async (facultyId) => {
  const faculty = await prisma.faculty.findUnique({ where: { id: facultyId } });
  if (!faculty) throw new Error("Faculty member not found.");
  const account = await getLatestBankAccount(facultyId);
  assertBankAccountReady(account);
  if (account.cashfreeBeneficiaryId && ["ACTIVE", "VERIFIED", "SUCCESS"].includes(text(account.cashfreeBeneficiaryStatus).toUpperCase())) {
    return { beneficiaryId: account.cashfreeBeneficiaryId, status: account.cashfreeBeneficiaryStatus, reused: true };
  }

  const beneficiaryPayload = buildBeneficiaryPayload(faculty, account);
  const response = await cashfreeRequest("/beneficiary", {
    method: "POST",
    body: beneficiaryPayload,
  });
  const beneficiaryId = text(response?.beneficiary_id || beneficiaryPayload.beneficiary_id);
  const status = text(response?.beneficiary_status || "VERIFIED").toUpperCase();
  await prisma.facultyBankAccount.update({
    where: { id: account.id },
    data: {
      cashfreeBeneficiaryId: beneficiaryId,
      cashfreeBeneficiaryStatus: status,
      cashfreeBeneficiaryCreatedAt: account.cashfreeBeneficiaryCreatedAt || new Date(),
      cashfreeBeneficiaryUpdatedAt: new Date(),
    },
  });
  logInfo("faculty_payout.beneficiary_created", { facultyId, beneficiaryId, status });
  return { beneficiaryId, status, rawStatus: status };
};

export const getBeneficiaryStatus = async (beneficiaryId) => {
  const response = await cashfreeRequest(`/beneficiary?beneficiary_id=${encodeURIComponent(beneficiaryId)}`);
  return {
    beneficiaryId,
    status: text(response?.beneficiary_status || "UNKNOWN").toUpperCase(),
    response: sanitizeGatewayPayload(response),
  };
};

const makeTransferId = (payout, retryCount = 0) =>
  `FP_${String(payout.id).replace(/-/g, "").slice(0, 22)}_${retryCount}`;

const makeIdempotencyKey = (payout, retryCount = 0) =>
  crypto.createHash("sha256").update(`faculty-payout:${payout.id}:${retryCount}`).digest("hex");

const buildTransferPayload = (payout, account, transferId) => {
  const amount = moneyNumber(payout.unpaidAmount || payout.payoutAmount || payout.amount);
  const mode = account.payoutMode === "UPI" ? "UPI" : "BANK";
  return {
    transfer_id: transferId,
    transfer_amount: amount,
    transfer_currency: "INR",
    transfer_mode: mode,
    beneficiary_details: {
      beneficiary_id: account.cashfreeBeneficiaryId,
    },
    remarks: `Flowlytiks faculty payout ${payout.referenceId || payout.id}`,
  };
};

const logPayoutEvent = async ({ payoutId, eventType, oldStatus, newStatus, payload, message, dedupeKey }) => {
  try {
    await prisma.facultyPayoutEvent.create({
      data: {
        payoutId,
        eventType,
        oldStatus,
        newStatus,
        cashfreeReferenceId: text(payload?.cf_transfer_id || payload?.referenceId || payload?.data?.transfer?.cf_transfer_id || payload?.data?.transfer?.referenceId) || null,
        cashfreeTransferId: text(payload?.transfer_id || payload?.transferId || payload?.data?.transfer?.transfer_id || payload?.data?.transfer?.transferId) || null,
        utr: text(payload?.transfer_utr || payload?.utr || payload?.data?.transfer?.transfer_utr || payload?.data?.transfer?.utr) || null,
        message: message || text(payload?.message || payload?.reason) || null,
        rawPayloadJson: sanitizeGatewayPayload(payload),
        dedupeKey: dedupeKey || null,
      },
    });
  } catch (error) {
    if (error?.code !== "P2002") {
      logWarn("faculty_payout.event_log_failed", { payoutId, eventType, error: error?.message || error });
    }
  }
};

const applyGatewayStatus = async ({ payout, gatewayPayload, source, dedupeKey }) => {
  const transfer = gatewayPayload?.data?.transfer || gatewayPayload?.transfer || gatewayPayload?.data || gatewayPayload || {};
  const cashfreeStatus = text(transfer.status || gatewayPayload?.status || source).toUpperCase();
  const nextStatus = normalizeCashfreePayoutStatus(cashfreeStatus, transfer.acknowledged);
  const now = new Date();
  const paid = nextStatus === "SUCCESS";
  const failed = ["FAILED", "REVERSED", "CANCELLED"].includes(nextStatus);
  const amount = moneyNumber(payout.amount);
  const updated = await prisma.facultyPayout.update({
    where: { id: payout.id },
    data: {
      status: nextStatus,
      cashfreeStatus,
      cashfreeReferenceId: text(transfer.cf_transfer_id || gatewayPayload?.cf_transfer_id || transfer.referenceId || gatewayPayload?.referenceId) || payout.cashfreeReferenceId,
      gatewayReference: text(transfer.cf_transfer_id || gatewayPayload?.cf_transfer_id || transfer.referenceId || gatewayPayload?.referenceId) || payout.gatewayReference,
      cashfreeTransferId: text(transfer.transfer_id || gatewayPayload?.transfer_id || transfer.transferId || gatewayPayload?.transferId) || payout.cashfreeTransferId,
      transactionId: text(transfer.transfer_utr || gatewayPayload?.transfer_utr || transfer.utr || gatewayPayload?.utr || transfer.cf_transfer_id) || payout.transactionId,
      utr: text(transfer.transfer_utr || gatewayPayload?.transfer_utr || transfer.utr || gatewayPayload?.utr) || payout.utr,
      paidAmount: paid ? amount : payout.paidAmount,
      unpaidAmount: paid ? 0 : amount,
      paidAt: paid ? now : payout.paidAt,
      payoutDate: paid ? now : payout.payoutDate,
      payoutProcessedAt: ["PROCESSING", "SUCCESS"].includes(nextStatus) ? now : payout.payoutProcessedAt,
      payoutCompletedAt: paid ? now : payout.payoutCompletedAt,
      payoutFailedAt: failed ? now : payout.payoutFailedAt,
      failureReason: failed ? text(transfer.reason || gatewayPayload?.reason || gatewayPayload?.message || "Cashfree payout failed.") : null,
    },
  });
  await logPayoutEvent({
    payoutId: payout.id,
    eventType: source,
    oldStatus: payout.status,
    newStatus: updated.status,
    payload: gatewayPayload,
    dedupeKey,
  });
  return updated;
};

export const initiatePayoutTransfer = async (payoutId, { adminId } = {}) => {
  assertConfigured();
  const payout = await prisma.facultyPayout.findUnique({
    where: { id: payoutId },
    include: { faculty: true, payroll: true },
  });
  if (!payout) throw new Error("Payout not found.");
  if (payout.status === "SUCCESS") throw new Error("Paid payout cannot be initiated again.");
  if (payout.status === "PROCESSING") throw new Error("Payout is already processing. Sync status instead.");
  if (!["PENDING", "FAILED", "CANCELLED", "REVERSED"].includes(payout.status)) {
    throw new Error("Only pending or failed payouts can be initiated.");
  }
  if (payout.payroll && payout.payroll.status !== "APPROVED") throw new Error("Only approved payrolls are payable.");
  const amount = moneyNumber(payout.unpaidAmount || payout.payoutAmount || payout.amount);
  if (amount <= 0) throw new Error("Payout amount must be greater than zero.");

  const account = await getLatestBankAccount(payout.facultyId);
  assertBankAccountReady(account);
  if (!account.cashfreeBeneficiaryId) throw new Error("Cashfree beneficiary is missing. Create beneficiary first.");

  const retryCount = Number(payout.retryCount || 0);
  const transferId = makeTransferId(payout, retryCount);
  const idempotencyKey = makeIdempotencyKey(payout, retryCount);
  const startedAt = new Date();
  const prepared = await prisma.facultyPayout.update({
    where: { id: payout.id },
    data: {
      status: "PROCESSING",
      idempotencyKey,
      cashfreeTransferId: transferId,
      payoutRequestedAt: startedAt,
      failureReason: null,
      paidBy: adminId ? String(adminId) : payout.paidBy,
    },
  });

  try {
    const payload = buildTransferPayload(prepared, account, transferId);
    const response = await cashfreeRequest("/transfers", {
      method: "POST",
      body: payload,
    });
    return applyGatewayStatus({ payout: prepared, gatewayPayload: response, source: "CASHFREE_INITIATE" });
  } catch (error) {
    const failed = await prisma.facultyPayout.update({
      where: { id: payout.id },
      data: {
        status: "FAILED",
        cashfreeStatus: "REQUEST_FAILED",
        payoutFailedAt: new Date(),
        failureReason: error?.message || "Cashfree payout request failed.",
      },
    });
    await logPayoutEvent({
      payoutId: payout.id,
      eventType: "CASHFREE_INITIATE_FAILED",
      oldStatus: payout.status,
      newStatus: failed.status,
      payload: error?.gatewayPayload || {},
      message: error?.message || "Cashfree payout request failed.",
    });
    throw error;
  }
};

export const getTransferStatus = async ({ transferId, referenceId }) => {
  const params = new URLSearchParams();
  if (referenceId) params.set("cf_transfer_id", referenceId);
  if (transferId) params.set("transfer_id", transferId);
  return cashfreeRequest(`/transfers?${params.toString()}`);
};

export const syncPayoutStatus = async (payoutId) => {
  const payout = await prisma.facultyPayout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new Error("Payout not found.");
  if (!payout.cashfreeTransferId && !payout.cashfreeReferenceId) throw new Error("No Cashfree transfer/reference id is available for this payout.");
  const response = await getTransferStatus({
    transferId: payout.cashfreeTransferId,
    referenceId: payout.cashfreeReferenceId,
  });
  return applyGatewayStatus({ payout, gatewayPayload: response, source: "CASHFREE_SYNC" });
};

export const retryFailedPayout = async (payoutId, { adminId } = {}) => {
  const payout = await prisma.facultyPayout.findUnique({ where: { id: payoutId } });
  if (!payout) throw new Error("Payout not found.");
  if (payout.status === "SUCCESS") throw new Error("Paid payout cannot be retried.");
  if (payout.status !== "FAILED") throw new Error("Only failed payouts can be retried.");
  await prisma.facultyPayout.update({
    where: { id: payout.id },
    data: {
      status: "PENDING",
      retryCount: Number(payout.retryCount || 0) + 1,
      lastRetryAt: new Date(),
      cashfreeTransferId: null,
      cashfreeReferenceId: null,
      idempotencyKey: null,
      failureReason: null,
    },
  });
  return initiatePayoutTransfer(payoutId, { adminId });
};

export const verifyCashfreePayoutWebhookSignature = (req) => {
  const config = getCashfreePayoutConfig();
  if (!config.webhookSecret) return false;
  const rawBody = req.rawBody || "";
  const signature = text(req.headers["x-cashfree-signature"] || req.headers["x-webhook-signature"] || req.body?.signature);
  const timestamp = text(req.headers["x-cashfree-timestamp"] || req.headers["x-webhook-timestamp"]);
  if (!signature) return false;

  if (rawBody && timestamp) {
    const expected = crypto.createHmac("sha256", config.webhookSecret).update(`${timestamp}${rawBody}`).digest("base64");
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(signature);
    return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  const body = req.body && typeof req.body === "object" ? { ...req.body } : {};
  delete body.signature;
  const postData = Object.keys(body)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const value = body[key];
      if (value === null || value === undefined) return "";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    })
    .filter((value) => value.length > 0)
    .join("");
  const expected = crypto.createHash("sha256").update(postData + config.webhookSecret).digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(signature);
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

const findPayoutForWebhook = async (payload) => {
  const transferId = text(payload.transfer_id || payload.transferId || payload.data?.transfer_id || payload.data?.transferId || payload.data?.transfer?.transfer_id || payload.data?.transfer?.transferId);
  const referenceId = text(payload.cf_transfer_id || payload.referenceId || payload.data?.cf_transfer_id || payload.data?.referenceId || payload.data?.transfer?.cf_transfer_id || payload.data?.transfer?.referenceId);
  if (transferId) {
    const payout = await prisma.facultyPayout.findFirst({ where: { cashfreeTransferId: transferId } });
    if (payout) return payout;
  }
  if (referenceId) {
    return prisma.facultyPayout.findFirst({ where: { cashfreeReferenceId: referenceId } });
  }
  return null;
};

export const handleCashfreePayoutWebhookPayload = async (payload) => {
  const payout = await findPayoutForWebhook(payload);
  if (!payout) {
    logWarn("faculty_payout.webhook_unmatched", {
      event: payload?.event,
      transferId: payload?.transferId || payload?.data?.transfer?.transferId || null,
      referenceId: payload?.referenceId || payload?.data?.transfer?.referenceId || null,
    });
    return { matched: false };
  }
  const dedupeKey = [
    payload?.event || "payout",
    payload?.transfer_id || payload?.transferId || payload?.data?.transfer?.transfer_id || payload?.data?.transfer?.transferId || payout.cashfreeTransferId || "",
    payload?.cf_transfer_id || payload?.referenceId || payload?.data?.transfer?.cf_transfer_id || payload?.data?.transfer?.referenceId || payout.cashfreeReferenceId || "",
    payload?.eventTime || payload?.event_time || "",
  ].join(":");
  const existing = await prisma.facultyPayoutEvent.findUnique({ where: { dedupeKey } }).catch(() => null);
  if (existing) return { matched: true, duplicate: true, payout };
  const updated = await applyGatewayStatus({ payout, gatewayPayload: payload, source: payload?.event || "CASHFREE_WEBHOOK", dedupeKey });
  return { matched: true, duplicate: false, payout: updated };
};

export const warnIfPayoutConfigMissing = () => {
  const config = getCashfreePayoutConfig();
  if (!config.clientId || !config.clientSecret) {
    logWarn("cashfree_payout.config_missing", {
      message: "Cashfree payout credentials are not configured. Existing app routes will continue; payout routes will return JSON config errors.",
    });
  }
};
