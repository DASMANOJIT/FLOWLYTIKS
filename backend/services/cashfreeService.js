import crypto from "crypto";

const CASHFREE_API_VERSION = "2025-01-01";

const normalizeEnv = (value) => String(value || "").trim().toLowerCase();

const getCashfreeClientId = () =>
  String(process.env.CASHFREE_CLIENT_ID || process.env.CASHFREE_APP_ID || "").trim();

const getCashfreeClientSecret = () =>
  String(process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY || "").trim();

export const getCashfreeEnvironment = () => {
  const environment = normalizeEnv(process.env.CASHFREE_ENVIRONMENT || "sandbox");
  return environment === "production" ? "production" : "sandbox";
};

export const getCashfreeBaseUrl = () =>
  getCashfreeEnvironment() === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";

export const getCashfreeWebhookSecret = () =>
  String(process.env.CASHFREE_WEBHOOK_SECRET || getCashfreeClientSecret()).trim();

const toGatewayError = async (response, fallbackMessage) => {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const error = new Error(
    payload?.message || payload?.error || fallbackMessage || "Cashfree request failed."
  );
  error.status = response.status;
  error.gatewayPayload = payload;
  return error;
};

const cashfreeRequest = async (path, { method = "GET", body, idempotencyKey } = {}) => {
  const clientId = getCashfreeClientId();
  const clientSecret = getCashfreeClientSecret();
  const response = await fetch(`${getCashfreeBaseUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-version": CASHFREE_API_VERSION,
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      "x-request-id": crypto.randomUUID(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    throw await toGatewayError(response, "Cashfree request failed.");
  }

  return response.json();
};

export const createCashfreeOrder = async ({
  orderId,
  amount,
  currency = "INR",
  customer,
  returnUrl,
  notifyUrl,
  paymentMethods,
  orderTags,
  orderNote,
  orderExpiryTime,
  idempotencyKey,
}) =>
  cashfreeRequest("/orders", {
    method: "POST",
    idempotencyKey,
    body: {
      order_id: orderId,
      order_amount: amount,
      order_currency: currency,
      customer_details: customer,
      order_meta: {
        return_url: returnUrl,
        notify_url: notifyUrl,
        ...(paymentMethods ? { payment_methods: paymentMethods } : {}),
      },
      ...(orderTags ? { order_tags: orderTags } : {}),
      ...(orderNote ? { order_note: orderNote } : {}),
      ...(orderExpiryTime ? { order_expiry_time: orderExpiryTime } : {}),
    },
  });

export const fetchCashfreeOrder = async (orderId) =>
  cashfreeRequest(`/orders/${encodeURIComponent(orderId)}`);

export const fetchCashfreePaymentsForOrder = async (orderId) =>
  cashfreeRequest(`/orders/${encodeURIComponent(orderId)}/payments`);

export const verifyCashfreeWebhookSignature = ({
  rawBody,
  signature,
  timestamp,
}) => {
  const secret = getCashfreeWebhookSecret();
  const payload = `${timestamp || ""}${rawBody || ""}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64");
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(String(signature || ""));

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const normalizeCashfreeAttemptStatus = (paymentStatus) => {
  switch (String(paymentStatus || "").toUpperCase()) {
    case "SUCCESS":
      return "PAID";
    case "FAILED":
    case "USER_DROPPED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return "PENDING";
  }
};

const normalizeOrderStatus = (orderStatus, attempts = []) => {
  const normalizedOrderStatus = String(orderStatus || "").toUpperCase();
  if (attempts.some((attempt) => normalizeCashfreeAttemptStatus(attempt?.payment_status) === "PAID")) {
    return "PAID";
  }
  if (normalizedOrderStatus === "EXPIRED") return "EXPIRED";
  if (normalizedOrderStatus === "TERMINATED" || normalizedOrderStatus === "CANCELLED") {
    return "CANCELLED";
  }
  if (
    attempts.length > 0 &&
    attempts.every((attempt) => normalizeCashfreeAttemptStatus(attempt?.payment_status) === "FAILED")
  ) {
    return "FAILED";
  }
  return "INITIATED";
};

const inferPaymentMethod = (payment) => {
  if (!payment?.payment_method || typeof payment.payment_method !== "object") {
    return payment?.payment_group || null;
  }

  const methodKeys = Object.keys(payment.payment_method);
  return methodKeys[0] || payment?.payment_group || null;
};

export const normalizeCashfreeOrderState = ({ order, payments }) => {
  const attempts = Array.isArray(payments) ? payments : [];
  const successfulAttempt =
    attempts.find((payment) => String(payment?.payment_status || "").toUpperCase() === "SUCCESS") ||
    null;
  const latestAttempt = attempts
    .slice()
    .sort((left, right) => {
      const leftTime = new Date(
        left?.payment_completion_time || left?.payment_time || left?.created_at || 0
      ).getTime();
      const rightTime = new Date(
        right?.payment_completion_time || right?.payment_time || right?.created_at || 0
      ).getTime();
      return rightTime - leftTime;
    })[0] || null;

  const referenceAttempt = successfulAttempt || latestAttempt;
  const status = normalizeOrderStatus(order?.order_status, attempts);

  return {
    status,
    successfulAttempt,
    latestAttempt,
    amount: Number(order?.order_amount || referenceAttempt?.order_amount || 0),
    currency: order?.order_currency || referenceAttempt?.order_currency || "INR",
    paymentMethod: inferPaymentMethod(referenceAttempt),
    paymentGroup: referenceAttempt?.payment_group || null,
    cfPaymentId: referenceAttempt?.cf_payment_id ? String(referenceAttempt.cf_payment_id) : null,
    paymentMessage: referenceAttempt?.payment_message || null,
    bankReference: referenceAttempt?.bank_reference || null,
    paidAt:
      referenceAttempt?.payment_completion_time || referenceAttempt?.payment_time || null,
    orderStatus: order?.order_status || null,
  };
};
