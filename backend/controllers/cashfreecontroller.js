import crypto from "crypto";
import { logError, logInfo, logWarn } from "../utils/appLogger.js";
import prisma from "../prisma/client.js";
import { getAcademicYear } from "../utils/academicYear.js";
import { isLatePaymentForPeriod } from "../utils/paymentPeriod.js";
import { autoPromoteIfEligible } from "./studentcontrollers.js";
import { sendFeePaidWhatsAppNotification } from "../services/whatsappservice.js";
import { reserveCashfreeCheckout, finishCashfreeCheckout } from "../services/cashfreeCheckoutService.js";
import {
  createCashfreeOrder,
  fetchCashfreeOrder,
  fetchCashfreePaymentsForOrder,
  getCashfreeEnvironment,
  normalizeCashfreeAttemptStatus,
  normalizeCashfreeOrderState,
  assertCashfreePaymentEvidence,
  verifyCashfreeWebhookSignature,
} from "../services/cashfreeService.js";
import {
  isPaymentSchemaCompatibilityError,
  logPaymentCompatibilityFallback,
  stripExtendedPaymentWriteData,
} from "../utils/paymentCompat.js";

const VALID_MONTHS = new Set([
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

const shouldDebugCashfree = process.env.DEBUG_CASHFREE === "1";

const logCashfreeDebug = (event, meta) => {
  if (shouldDebugCashfree) {
    logInfo(event, meta);
  }
};

const jsonError = (res, status, message, extra = {}) =>
  res.status(status).json({
    success: false,
    error: message,
    message,
    ...extra,
  });

const jsonSuccess = (res, payload = {}, status = 200) =>
  res.status(status).json({
    success: true,
    ...payload,
  });

const isUniqueConstraintError = (error) => error?.code === "P2002";

const CASHFREE_WEBHOOK_HEADER_KEYS = [
  "x-idempotency-key",
  "x-webhook-id",
  "x-event-id",
  "x-cf-event-id",
];

const CASHFREE_VOLATILE_WEBHOOK_FIELDS = new Set([
  "timestamp",
  "event_timestamp",
  "event_time",
  "webhook_timestamp",
  "received_at",
  "receivedat",
  "delivered_at",
  "deliveredat",
]);

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
};

const normalizeStableWebhookPayload = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeStableWebhookPayload);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((accumulator, key) => {
      const normalizedKey = String(key || "").trim();
      const loweredKey = normalizedKey.toLowerCase();
      if (CASHFREE_VOLATILE_WEBHOOK_FIELDS.has(loweredKey)) {
        return accumulator;
      }

      const normalizedValue = normalizeStableWebhookPayload(value[key]);
      if (typeof normalizedValue === "undefined") {
        return accumulator;
      }

      accumulator[normalizedKey] = normalizedValue;
      return accumulator;
    }, {});
};

const extractCashfreeWebhookEventId = (payload) =>
  firstNonEmptyString(
    payload?.event_id,
    payload?.eventId,
    payload?.data?.event_id,
    payload?.data?.eventId,
    payload?.data?.id,
    payload?.id
  );

const buildCashfreeWebhookDedupeKey = ({
  headers,
  payload,
  eventType,
  cashfreeOrderId,
  cfPaymentId,
}) => {
  for (const headerName of CASHFREE_WEBHOOK_HEADER_KEYS) {
    const headerValue = firstNonEmptyString(headers?.[headerName]);
    if (headerValue) {
      return `header:${headerValue}`;
    }
  }

  const eventId = extractCashfreeWebhookEventId(payload);
  if (eventId) {
    return `event:${eventId}`;
  }

  const paymentId = firstNonEmptyString(
    payload?.data?.payment?.payment_id,
    payload?.payment_id,
    payload?.data?.order?.order_tags?.paymentId,
    payload?.data?.order?.order_tags?.payment_id
  );
  const paymentStatus = firstNonEmptyString(
    payload?.data?.payment?.payment_status,
    payload?.payment_status
  );
  const orderStatus = firstNonEmptyString(
    payload?.data?.order?.order_status,
    payload?.order_status,
    payload?.data?.order?.status
  );

  if (cashfreeOrderId || cfPaymentId || paymentId) {
    // Do not include delivery timestamps here: the same gateway event can be
    // retried later with a different receive time, which would break dedupe.
    return [
      "stable",
      eventType || "payment",
      cashfreeOrderId || "no-order",
      cfPaymentId || paymentId || "no-payment",
      paymentStatus || "no-payment-status",
      orderStatus || "no-order-status",
    ].join(":");
  }

  const normalizedPayload = normalizeStableWebhookPayload(payload);
  const payloadHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(normalizedPayload))
    .digest("hex");
  return `payload:${eventType || "payment"}:${payloadHash}`;
};

const createPendingWebhookEvent = async ({
  dedupeKey,
  eventType,
  cashfreeOrderId,
  cfPaymentId,
  signature,
  payload,
}) => {
  try {
    const event = await prisma.paymentWebhookEvent.create({
      data: {
        provider: "CASHFREE",
        dedupeKey,
        eventType,
        cashfreeOrderId: cashfreeOrderId ? String(cashfreeOrderId) : null,
        cfPaymentId: cfPaymentId ? String(cfPaymentId) : null,
        signature,
        payload,
      },
    });

    return { event, duplicate: false };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existingEvent = await prisma.paymentWebhookEvent.findUnique({
      where: { dedupeKey },
    });

    if (existingEvent?.processedAt) {
      return { event: existingEvent, duplicate: true };
    }

    return { event: existingEvent, duplicate: false };
  }
};

const markWebhookEventProcessed = async ({ eventId, gatewayOrderId = null }) =>
  prisma.paymentWebhookEvent.update({
    where: { id: eventId },
    data: {
      gatewayOrderId,
      processedAt: new Date(),
    },
  });

const normalizeMonth = (value) => {
  const month = String(value || "").trim();
  if (!month) return "";
  return month[0].toUpperCase() + month.slice(1).toLowerCase();
};

const resolveCashfreePaymentMethods = (preferredMethod) => {
  switch (String(preferredMethod || "").trim().toLowerCase()) {
    case "card":
      return "cc,dc";
    case "netbank":
    case "netbanking":
      return "nb";
    case "upi":
      return "upi";
    default:
      return "upi,cc,dc,nb";
  }
};

const getRequiredUrlFromEnv = (name) => {
  const rawValue = String(process.env[name] || "").trim();
  if (!rawValue) {
    throw new Error(`${name} is not set`);
  }

  return new URL(rawValue);
};

const getNotifyUrl = () => {
  const backendBaseUrl = getRequiredUrlFromEnv("BACKEND_URL");
  return `${backendBaseUrl.toString().replace(/\/$/, "")}/api/payments/cashfree/webhook`;
};

const getReturnUrl = ({ paymentId, gatewayOrderId, cashfreeOrderId }) => {
  const url = getRequiredUrlFromEnv("CASHFREE_RETURN_URL");
  url.pathname = url.pathname.replace(/\/$/, "");
  url.searchParams.set("gateway", "cashfree");
  url.searchParams.set("paymentId", String(paymentId));
  url.searchParams.set("gatewayOrderId", gatewayOrderId);
  url.searchParams.set("cashfreeOrderId", cashfreeOrderId);
  url.searchParams.set("order_id", "{order_id}");
  return url.toString();
};

const serializeDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const parseGatewayDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const unwrapCashfreeResponse = (response) => {
  if (
    response &&
    typeof response === "object" &&
    response.data &&
    typeof response.data === "object" &&
    !Array.isArray(response.data)
  ) {
    return response.data;
  }

  return response;
};

const extractCashfreeOrderResponse = (response) => {
  const payload = unwrapCashfreeResponse(response) || {};

  return {
    raw: payload,
    paymentSessionId:
      String(payload?.payment_session_id || payload?.paymentSessionId || "").trim() || null,
    cfOrderId:
      String(payload?.cf_order_id || payload?.cfOrderId || "").trim() || null,
    orderStatus: String(payload?.order_status || payload?.orderStatus || "").trim() || null,
    orderExpiryTime: parseGatewayDate(
      payload?.order_expiry_time || payload?.orderExpiryTime || null
    ),
  };
};

const resolveTeacherAdminId = async () => {
  const admins = await prisma.admin.findMany({
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });

  return admins.length === 1 ? admins[0].id : null;
};

const syncPaymentAttempts = async (db, gatewayOrderId, cashfreeOrderId, payments = []) => {
  for (const payment of payments) {
    if (!payment?.cf_payment_id) continue;
    const attemptStatus = normalizeCashfreeAttemptStatus(payment.payment_status);

    await db.paymentAttempt.upsert({
      where: {
        cfPaymentId: String(payment.cf_payment_id),
      },
      update: {
        status: attemptStatus,
        cashfreeOrderId,
        paymentGroup: payment.payment_group || null,
        paymentMethod:
          Object.keys(payment.payment_method || {})[0] || payment.payment_group || null,
        paymentMessage: payment.payment_message || null,
        bankReference: payment.bank_reference || null,
        gatewayPaymentId: payment.payment_gateway_details?.gateway_payment_id || null,
        gatewayOrderReference:
          payment.payment_gateway_details?.gateway_order_reference_id || null,
        paymentAmount:
          typeof payment.payment_amount === "number"
            ? payment.payment_amount
            : Number(payment.payment_amount || payment.order_amount || 0),
        paymentTime: parseGatewayDate(
          payment.payment_completion_time || payment.payment_time || null
        ),
        rawPayload: payment,
      },
      create: {
        gatewayOrderId,
        provider: "CASHFREE",
        status: attemptStatus,
        cashfreeOrderId,
        cfPaymentId: String(payment.cf_payment_id),
        paymentGroup: payment.payment_group || null,
        paymentMethod:
          Object.keys(payment.payment_method || {})[0] || payment.payment_group || null,
        paymentMessage: payment.payment_message || null,
        bankReference: payment.bank_reference || null,
        gatewayPaymentId: payment.payment_gateway_details?.gateway_payment_id || null,
        gatewayOrderReference:
          payment.payment_gateway_details?.gateway_order_reference_id || null,
        paymentAmount:
          typeof payment.payment_amount === "number"
            ? payment.payment_amount
            : Number(payment.payment_amount || payment.order_amount || 0),
        paymentTime: parseGatewayDate(
          payment.payment_completion_time || payment.payment_time || null
        ),
        rawPayload: payment,
      },
    });
  }
};

const runPostPaymentSideEffects = async (payment) => {
  await autoPromoteIfEligible(Number(payment.studentId), payment.academicYear);

  const student = await prisma.student.findUnique({
    where: { id: Number(payment.studentId) },
    select: { id: true, name: true, phone: true },
  });

  if (student) {
    sendFeePaidWhatsAppNotification({
      student,
      payment,
      mode: "cashfree",
    }).catch((error) => {
      logError("cashfree.notification_failed", { error });
    });
  }
};

const finalizeCashfreeState = async ({ gatewayOrder, order, payments, source }) => {
    let normalized = normalizeCashfreeOrderState({ order, payments });
    assertCashfreePaymentEvidence({ gatewayOrder, order, normalized });

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`cashfree:finalize:${gatewayOrder.cashfreeOrderId}`})::bigint)::text AS locked`;
      const confirmed = await tx.paymentGatewayOrder.findUnique({
        where: { id: gatewayOrder.id },
        include: { attempts: { where: { status: "PAID" }, orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (confirmed?.status === "PAID" && normalized.status !== "PAID") {
        // A provider snapshot fetched before another request completed must not undo success.
        normalized = { ...normalized, status: "PAID", orderStatus: confirmed.orderStatus || "PAID",
          paymentMethod: confirmed.paymentMethod, paidAt: confirmed.paidAt?.toISOString() || null,
          cfPaymentId: confirmed.attempts?.[0]?.cfPaymentId || null };
        return;
      }
      await syncPaymentAttempts(tx, gatewayOrder.id, gatewayOrder.cashfreeOrderId, payments);

      await tx.paymentGatewayOrder.update({
        where: { id: gatewayOrder.id },
        data: {
          status: normalized.status,
          orderStatus: normalized.orderStatus,
          paymentMethod: normalized.paymentMethod,
          paidAt: parseGatewayDate(normalized.paidAt),
          verifiedAt: new Date(),
          gatewayReference: normalized.bankReference || gatewayOrder.gatewayReference,
        },
      });

      if (normalized.status === "PAID") {
        const paidAt = parseGatewayDate(normalized.paidAt) || new Date();
        const paymentUpdateData = {
          amount: gatewayOrder.amount,
          currency: normalized.currency || gatewayOrder.currency,
          status: "paid",
          paymentProvider: "CASHFREE",
          paidAt,
          isLatePayment: isLatePaymentForPeriod({
            month: gatewayOrder.month,
            academicYear: gatewayOrder.academicYear,
            paidAt,
          }),
          teacherAdminId: gatewayOrder.teacherAdminId,
        };
        let paymentTransition;
        try {
          paymentTransition = await tx.payment.updateMany({
            where: {
              id: gatewayOrder.paymentId,
              status: {
                not: "paid",
              },
            },
            data: paymentUpdateData,
          });
        } catch (error) {
          if (!isPaymentSchemaCompatibilityError(error)) throw error;
          logPaymentCompatibilityFallback("finalizeCashfreeState:paid", error);
          paymentTransition = await tx.payment.updateMany({
            where: {
              id: gatewayOrder.paymentId,
              status: {
                not: "paid",
              },
            },
            data: stripExtendedPaymentWriteData(paymentUpdateData),
          });
        }

        if (paymentTransition.count > 0) {
          const payment = await tx.payment.findUnique({
            where: { id: gatewayOrder.paymentId },
          });

          if (payment) {
            setImmediate(() => {
              runPostPaymentSideEffects(payment).catch((error) => {
                logError("cashfree.post_payment_failed", { error });
              });
            });
          }
        }
      } else if (normalized.status === "FAILED" || normalized.status === "EXPIRED") {
        await tx.payment.updateMany({
          where: {
            id: gatewayOrder.paymentId,
            status: {
              not: "paid",
            },
          },
          data: {
            status: normalized.status === "EXPIRED" ? "expired" : "failed",
            paymentProvider: "CASHFREE",
          },
        });
      }
    });

    console.info("CASHFREE VERIFY RESULT", {
      source,
      gatewayOrderId: gatewayOrder.id,
      cashfreeOrderId: gatewayOrder.cashfreeOrderId,
      status: normalized.status,
      cfPaymentId: normalized.cfPaymentId,
    });

    return normalized;
};

const findGatewayOrderForVerification = async ({ paymentId, gatewayOrderId, cashfreeOrderId }) => {
  if (gatewayOrderId) {
    return prisma.paymentGatewayOrder.findUnique({
      where: { id: String(gatewayOrderId) },
      include: { payment: true },
    });
  }

  if (cashfreeOrderId) {
    return prisma.paymentGatewayOrder.findUnique({
      where: { cashfreeOrderId: String(cashfreeOrderId) },
      include: { payment: true },
    });
  }

  if (paymentId) {
    return prisma.paymentGatewayOrder.findFirst({
      where: {
        paymentId: Number(paymentId),
        provider: "CASHFREE",
      },
      include: { payment: true },
      orderBy: { createdAt: "desc" },
    });
  }

  return null;
};

const formatCreateOrderResponse = (gatewayOrder) => ({
  paymentId: gatewayOrder.paymentId,
  gatewayOrderId: gatewayOrder.id,
  cashfreeOrderId: gatewayOrder.cashfreeOrderId,
  cf_order_id: gatewayOrder.cashfreeCfOrderId || null,
  cfOrderId: gatewayOrder.cashfreeCfOrderId || null,
  payment_session_id: gatewayOrder.paymentSessionId,
  paymentSessionId: gatewayOrder.paymentSessionId,
  amount: gatewayOrder.amount,
  currency: gatewayOrder.currency,
  environment: getCashfreeEnvironment(),
  orderExpiryTime: serializeDate(gatewayOrder.orderExpiryTime),
});

export const createCashfreeHostedOrder = async (req, res) => {
  try {
    if (req.userRole !== "student") {
      return jsonError(res, 403, "Only students can initiate payment.");
    }

    const requestedStudentId = Number(req.body?.studentId);
    const studentId = Number(req.user?.id);
    const month = normalizeMonth(req.body?.month);
    const preferredMethod = String(req.body?.preferredMethod || "upi").trim().toLowerCase();

    if (!requestedStudentId || requestedStudentId !== studentId) {
      return jsonError(res, 403, "You can only pay your own fees.");
    }

    if (!VALID_MONTHS.has(month)) {
      return jsonError(res, 400, "Please select a valid month.");
    }

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        monthlyFee: true,
      },
    });

    if (!student) {
      return jsonError(res, 404, "Student not found.");
    }

    if (!student.email || !student.phone) {
      return jsonError(res, 400, "Your profile must include a valid email and phone number.");
    }

    const academicYear = getAcademicYear();
    const teacherAdminId = await resolveTeacherAdminId();

    let result;
    // Reserve/finalize on one transaction connection; provider calls never
    // occupy it. An uncertain create response retains the same idempotency key.
    for (let attempt = 0; attempt < 2; attempt++) {
      const reservation = await reserveCashfreeCheckout(prisma, {
        studentId, academicYear, month, amount: student.monthlyFee,
        teacherAdminId, environment: getCashfreeEnvironment(), preferredMethod,
        notifyUrl: getNotifyUrl,
      });
      if (!reservation?.gatewayOrder) { result = reservation; break; }
      const { gatewayOrder, payment } = reservation;
      const cashfreeOrderId = gatewayOrder.cashfreeOrderId;
      let returnUrl;
      const networkOptions = () => ({ signal: AbortSignal.timeout(30000) });
      try {
        returnUrl = getReturnUrl({ paymentId: payment.id, gatewayOrderId: gatewayOrder.id, cashfreeOrderId });
        let providerOrder;
        if (reservation.recover) {
          try { providerOrder = await fetchCashfreeOrder(cashfreeOrderId, networkOptions()); }
          catch (error) { if (error.status !== 404) throw error; }
        }
        if (!providerOrder) {
          providerOrder = await createCashfreeOrder({
            orderId: cashfreeOrderId, amount: gatewayOrder.amount, currency: gatewayOrder.currency,
            customer: { customer_id: `student_${student.id}`, customer_name: student.name, customer_email: student.email, customer_phone: student.phone },
            returnUrl, notifyUrl: getNotifyUrl(),
            paymentMethods: resolveCashfreePaymentMethods(gatewayOrder.paymentMethodHint || preferredMethod),
            orderNote: `Flowlytiks fee payment for ${month} ${academicYear}`,
            orderTags: { paymentId: String(payment.id), studentId: String(student.id), month, academicYear: String(academicYear) },
            idempotencyKey: gatewayOrder.id, ...networkOptions(),
          });
        }
        const normalized = extractCashfreeOrderResponse(providerOrder);
        if (normalized.orderStatus === "PAID") {
          const payments = await fetchCashfreePaymentsForOrder(cashfreeOrderId, networkOptions());
          await finalizeCashfreeState({ gatewayOrder, order: providerOrder, payments, source: "create-order-recovery" });
          result = await finishCashfreeCheckout(prisma, reservation, {});
          break;
        }
        const expired = normalized.orderStatus === "EXPIRED" ||
          (normalized.orderExpiryTime && normalized.orderExpiryTime <= new Date());
        if (!expired && !normalized.paymentSessionId) {
          const error = new Error("Cashfree did not return payment_session_id");
          error.status = 502; throw error;
        }
        result = await finishCashfreeCheckout(prisma, reservation, {
          status: expired ? "EXPIRED" : "INITIATED",
          paymentSessionId: normalized.paymentSessionId,
          cashfreeCfOrderId: normalized.cfOrderId || gatewayOrder.cashfreeCfOrderId,
          orderStatus: normalized.orderStatus || "ACTIVE",
          orderExpiryTime: normalized.orderExpiryTime, returnUrl, notifyUrl: getNotifyUrl(),
          rawCreateResponse: normalized.raw,
        });
        if (!result?.expired) break;
      } catch (error) {
        // The provider may have accepted an order whose response was lost.
        // Never mint another order merely because this request failed.
        await finishCashfreeCheckout(prisma, reservation, {
          status: "PENDING", orderStatus: "CREATE_UNKNOWN",
        }).catch(persistError => logError("cashfree.checkout_reservation_release_failed", { error: persistError }));
        throw error;
      }
    }

    if (result?.locked) {
      return jsonError(
        res,
        409,
        "A payment request for this fee is already in progress. Please wait a moment."
      );
    }

    if (result?.alreadyPaid) {
      return jsonError(res, 400, "This month is already paid.");
    }

    const gatewayOrder = result?.reusableOrder || result?.gatewayOrder;
    if (!gatewayOrder?.paymentSessionId) {
      return jsonError(res, 502, "Unable to initialize Cashfree checkout right now.");
    }

    const responsePayload = formatCreateOrderResponse(gatewayOrder);
    logCashfreeDebug("cashfree.checkout_ready", { gatewayOrderId: gatewayOrder.id });
    return jsonSuccess(res, responsePayload);
  } catch (error) {
    logError("cashfree.checkout_failed", { error });
    const status = Number(error?.status || error?.statusCode || 500);
    return jsonError(
      res,
      status >= 400 && status < 600 ? status : 500,
      status === 500
        ? "Failed to initialize payment."
        : error?.message || "Failed to initialize payment."
    );
  }
};

export const verifyCashfreePayment = async (req, res) => {
  if (!["admin", "student"].includes(req.userRole)) {
    return jsonError(res, req.userRole ? 403 : 401, "Forbidden.");
  }
  try {
    const source = req.method === "GET" ? req.query : req.body;
    const paymentId = source?.paymentId ? Number(source.paymentId) : null;
    const gatewayOrderId = source?.gatewayOrderId ? String(source.gatewayOrderId) : null;
    const cashfreeOrderId = source?.cashfreeOrderId || source?.orderId || source?.order_id;

    const gatewayOrder = await findGatewayOrderForVerification({
      paymentId,
      gatewayOrderId,
      cashfreeOrderId,
    });

    if (!gatewayOrder) {
      return jsonError(res, 404, "Payment order not found.");
    }

    if (
      req.userRole === "student" &&
      Number(req.user?.id) !== Number(gatewayOrder.studentId)
    ) {
      return jsonError(res, 403, "Forbidden.");
    }

    const [order, payments] = await Promise.all([
      fetchCashfreeOrder(gatewayOrder.cashfreeOrderId),
      fetchCashfreePaymentsForOrder(gatewayOrder.cashfreeOrderId),
    ]);

    const normalized = await finalizeCashfreeState({
      gatewayOrder,
      order,
      payments,
      source: "verify-endpoint",
    });

    return jsonSuccess(res, {
      paymentId: gatewayOrder.paymentId,
      gatewayOrderId: gatewayOrder.id,
      cashfreeOrderId: gatewayOrder.cashfreeOrderId,
      status: normalized.status,
      amount: gatewayOrder.amount,
      currency: gatewayOrder.currency,
      paymentMethod: normalized.paymentMethod,
      cfPaymentId: normalized.cfPaymentId,
      paymentMessage: normalized.paymentMessage,
      paidAt: normalized.paidAt,
    });
  } catch (error) {
    logError("cashfree.verify_failed", { error });
    const status = Number(error?.status || error?.statusCode || 500);
    return jsonError(
      res,
      status >= 400 && status < 600 ? status : 500,
      status === 500 ? "Unable to verify payment right now." : error?.message
    );
  }
};

export const handleCashfreeWebhook = async (req, res) => {
  const rawBody = req.rawBody || "";
  const signature = String(
    req.headers["x-webhook-signature"] || req.headers["x-cashfree-signature"] || ""
  );
  const timestamp = String(
    req.headers["x-webhook-timestamp"] || req.headers["x-cashfree-timestamp"] || ""
  );

  try {
    if (!rawBody || !signature || !timestamp) {
      return jsonError(res, 400, "Invalid webhook signature headers.");
    }

    if (
      !verifyCashfreeWebhookSignature({
        rawBody,
        signature,
        timestamp,
      })
    ) {
      return jsonError(res, 401, "Invalid webhook signature.");
    }

    const payload = req.body && typeof req.body === "object" ? req.body : JSON.parse(rawBody);
    const eventType = String(
      payload?.event_type ||
        payload?.type ||
        payload?.event ||
        payload?.data?.payment?.payment_status ||
        "payment"
    );
    const cashfreeOrderId =
      payload?.data?.order?.order_id ||
      payload?.data?.payment?.order_id ||
      payload?.order_id ||
      null;
    const cfPaymentId =
      payload?.data?.payment?.cf_payment_id || payload?.cf_payment_id || null;
    const dedupeKey = buildCashfreeWebhookDedupeKey({
      headers: req.headers,
      payload,
      eventType,
      cashfreeOrderId,
      cfPaymentId,
    });

    const { event: webhookEvent, duplicate } = await createPendingWebhookEvent({
      dedupeKey,
      eventType,
      cashfreeOrderId,
      cfPaymentId,
      signature,
      payload,
    });

    if (duplicate) {
      return res.status(200).json({ success: true, duplicate: true });
    }

    const gatewayOrder = cashfreeOrderId
      ? await prisma.paymentGatewayOrder.findUnique({
          where: { cashfreeOrderId: String(cashfreeOrderId) },
          include: { payment: true },
        })
      : null;

    if (!gatewayOrder || !gatewayOrder.cashfreeOrderId) {
      console.warn("CASHFREE WEBHOOK ORDER NOT FOUND", {
        cashfreeOrderId,
        eventType,
      });
      if (webhookEvent?.id) {
        await markWebhookEventProcessed({
          eventId: webhookEvent.id,
          gatewayOrderId: gatewayOrder?.id || null,
        });
      }
      return res.status(200).json({ success: true, ignored: true });
    }

    const [order, payments] = await Promise.all([
      fetchCashfreeOrder(gatewayOrder.cashfreeOrderId),
      fetchCashfreePaymentsForOrder(gatewayOrder.cashfreeOrderId),
    ]);

    await finalizeCashfreeState({
      gatewayOrder,
      order,
      payments,
      source: "webhook",
    });

    if (webhookEvent?.id) {
      await markWebhookEventProcessed({
        eventId: webhookEvent.id,
        gatewayOrderId: gatewayOrder.id,
      });
    }

    console.info("CASHFREE WEBHOOK PROCESSED", {
      gatewayOrderId: gatewayOrder.id,
      cashfreeOrderId: gatewayOrder.cashfreeOrderId,
      eventType,
      cfPaymentId,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    logError("cashfree.webhook_failed", { error });
    return jsonError(res, 500, "Webhook processing failed.");
  }
};
