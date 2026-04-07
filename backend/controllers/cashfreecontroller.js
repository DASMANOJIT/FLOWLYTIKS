import crypto from "crypto";
import prisma from "../prisma/client.js";
import { getAcademicYear } from "../utils/academicYear.js";
import { autoPromoteIfEligible } from "./studentcontrollers.js";
import { sendFeePaidWhatsAppNotification } from "../services/whatsappservice.js";
import { withPgAdvisoryLock } from "../utils/dbLocks.js";
import {
  createCashfreeOrder,
  fetchCashfreeOrder,
  fetchCashfreePaymentsForOrder,
  getCashfreeEnvironment,
  normalizeCashfreeAttemptStatus,
  normalizeCashfreeOrderState,
  verifyCashfreeWebhookSignature,
} from "../services/cashfreeService.js";

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

const buildCashfreeOrderId = ({ paymentId, month }) => {
  const monthKey = normalizeMonth(month).slice(0, 3).toUpperCase();
  return `flowlytiks_${paymentId}_${monthKey}_${Date.now()}_${crypto
    .randomBytes(3)
    .toString("hex")}`;
};

const getNotifyUrl = () => {
  const backendBaseUrl = String(process.env.BACKEND_URL || "http://localhost:5000").trim();
  return `${backendBaseUrl.replace(/\/$/, "")}/api/payments/cashfree/webhook`;
};

const getReturnUrl = ({ paymentId, gatewayOrderId, cashfreeOrderId }) => {
  const returnBase = String(process.env.CASHFREE_RETURN_URL || "").trim().replace(/\/$/, "");
  const url = new URL(returnBase);
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

const resolveTeacherAdminId = async () => {
  const admins = await prisma.admin.findMany({
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });

  return admins.length === 1 ? admins[0].id : null;
};

const getReusableGatewayOrder = async (paymentId) =>
  prisma.paymentGatewayOrder.findFirst({
    where: {
      paymentId,
      provider: "CASHFREE",
      status: {
        in: ["PENDING", "INITIATED"],
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

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
      console.error("Cashfree fee-paid notification failed:", error?.message || error);
    });
  }
};

const finalizeCashfreeState = async ({ gatewayOrder, order, payments, source }) =>
  withPgAdvisoryLock(prisma, `cashfree:finalize:${gatewayOrder.cashfreeOrderId}`, async () => {
    const normalized = normalizeCashfreeOrderState({ order, payments });

    await prisma.$transaction(async (tx) => {
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
        const paymentTransition = await tx.payment.updateMany({
          where: {
            id: gatewayOrder.paymentId,
            status: {
              not: "paid",
            },
          },
          data: {
            amount: gatewayOrder.amount,
            currency: normalized.currency || gatewayOrder.currency,
            status: "paid",
            paymentProvider: "CASHFREE",
            paidAt: parseGatewayDate(normalized.paidAt) || new Date(),
            teacherAdminId: gatewayOrder.teacherAdminId,
          },
        });

        if (paymentTransition.count > 0) {
          const payment = await tx.payment.findUnique({
            where: { id: gatewayOrder.paymentId },
          });

          if (payment) {
            setImmediate(() => {
              runPostPaymentSideEffects(payment).catch((error) => {
                console.error(
                  "Cashfree post-payment side effects failed:",
                  error?.message || error
                );
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
  });

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

    const result = await withPgAdvisoryLock(
      prisma,
      `cashfree:create:${studentId}:${academicYear}:${month}`,
      async () => {
        let payment = await prisma.payment.findUnique({
          where: {
            studentId_month_academicYear: {
              studentId,
              month,
              academicYear,
            },
          },
        });

        if (payment?.status === "paid") {
          return { alreadyPaid: true, payment };
        }

        if (!payment) {
          payment = await prisma.payment.create({
            data: {
              studentId,
              teacherAdminId,
              month,
              academicYear,
              amount: student.monthlyFee,
              currency: "INR",
              status: "created",
              paymentProvider: "CASHFREE",
            },
          });
        } else {
          payment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
              amount: student.monthlyFee,
              currency: "INR",
              teacherAdminId,
              paymentProvider: "CASHFREE",
            },
          });
        }

        const reusableOrder = await getReusableGatewayOrder(payment.id);
        if (reusableOrder?.paymentSessionId) {
          const expiry = reusableOrder.orderExpiryTime?.getTime?.() || 0;
          if (!expiry || expiry > Date.now()) {
            return { reusableOrder };
          }
        }

        if (reusableOrder?.cashfreeOrderId) {
          try {
            const existingCashfreeOrder = await fetchCashfreeOrder(reusableOrder.cashfreeOrderId);
            if (existingCashfreeOrder?.payment_session_id) {
              const updatedReusableOrder = await prisma.paymentGatewayOrder.update({
                where: { id: reusableOrder.id },
                data: {
                  status:
                    existingCashfreeOrder.order_status === "PAID" ? "PAID" : "INITIATED",
                  paymentSessionId: existingCashfreeOrder.payment_session_id,
                  cashfreeCfOrderId: existingCashfreeOrder.cf_order_id
                    ? String(existingCashfreeOrder.cf_order_id)
                    : reusableOrder.cashfreeCfOrderId,
                  orderStatus: existingCashfreeOrder.order_status || reusableOrder.orderStatus,
                  orderExpiryTime:
                    parseGatewayDate(existingCashfreeOrder.order_expiry_time) ||
                    reusableOrder.orderExpiryTime,
                  rawCreateResponse: existingCashfreeOrder,
                },
              });

              if (existingCashfreeOrder.order_status === "PAID") {
                const payments = await fetchCashfreePaymentsForOrder(reusableOrder.cashfreeOrderId);
                await finalizeCashfreeState({
                  gatewayOrder: updatedReusableOrder,
                  order: existingCashfreeOrder,
                  payments,
                  source: "create-order-recovery",
                });
                return { alreadyPaid: true, payment };
              }

              const expiry = updatedReusableOrder.orderExpiryTime?.getTime?.() || 0;
              if (!expiry || expiry > Date.now()) {
                return { reusableOrder: updatedReusableOrder };
              }
            }
          } catch (error) {
            console.warn("Cashfree reusable order recovery skipped:", error?.message || error);
          }
        }

        const cashfreeOrderId = buildCashfreeOrderId({ paymentId: payment.id, month });
        const gatewayOrder = await prisma.paymentGatewayOrder.create({
          data: {
            provider: "CASHFREE",
            status: "PENDING",
            paymentId: payment.id,
            studentId,
            teacherAdminId,
            amount: student.monthlyFee,
            currency: "INR",
            month,
            academicYear,
            cashfreeOrderId,
            paymentMethodHint: preferredMethod,
            notifyUrl: getNotifyUrl(),
            metadata: {
              preferredMethod,
            },
          },
        });

        const returnUrl = getReturnUrl({
          paymentId: payment.id,
          gatewayOrderId: gatewayOrder.id,
          cashfreeOrderId,
        });

        console.info("CASHFREE CREATE ORDER START", {
          paymentId: payment.id,
          gatewayOrderId: gatewayOrder.id,
          studentId,
          month,
          academicYear,
        });

        try {
          const orderResponse = await createCashfreeOrder({
            orderId: cashfreeOrderId,
            amount: student.monthlyFee,
            customer: {
              customer_id: `student_${student.id}`,
              customer_name: student.name,
              customer_email: student.email,
              customer_phone: student.phone,
            },
            returnUrl,
            notifyUrl: getNotifyUrl(),
            paymentMethods: resolveCashfreePaymentMethods(preferredMethod),
            orderNote: `Flowlytiks fee payment for ${month} ${academicYear}`,
            orderTags: {
              paymentId: String(payment.id),
              studentId: String(student.id),
              month,
              academicYear: String(academicYear),
            },
            idempotencyKey: gatewayOrder.id,
          });

          const updatedGatewayOrder = await prisma.paymentGatewayOrder.update({
            where: { id: gatewayOrder.id },
            data: {
              status: "INITIATED",
              cashfreeCfOrderId: orderResponse?.cf_order_id
                ? String(orderResponse.cf_order_id)
                : null,
              paymentSessionId: orderResponse?.payment_session_id || null,
              orderStatus: orderResponse?.order_status || "ACTIVE",
              orderExpiryTime: parseGatewayDate(orderResponse?.order_expiry_time),
              returnUrl,
              notifyUrl: getNotifyUrl(),
              rawCreateResponse: orderResponse,
            },
          });

          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: "created",
              paymentProvider: "CASHFREE",
            },
          });

          console.info("CASHFREE CREATE ORDER SUCCESS", {
            paymentId: payment.id,
            gatewayOrderId: updatedGatewayOrder.id,
            cashfreeOrderId,
          });

          return { gatewayOrder: updatedGatewayOrder };
        } catch (error) {
          await prisma.paymentGatewayOrder.update({
            where: { id: gatewayOrder.id },
            data: {
              status: "FAILED",
              orderStatus: "CREATE_FAILED",
              rawCreateResponse: error?.gatewayPayload || {
                message: error?.message || "Cashfree order creation failed",
              },
              returnUrl,
              notifyUrl: getNotifyUrl(),
            },
          });

          console.error("CASHFREE CREATE ORDER FAILURE", {
            paymentId: payment.id,
            gatewayOrderId: gatewayOrder.id,
            message: error?.message || error,
          });
          throw error;
        }
      },
      {
        onLocked: () => ({ locked: true }),
      }
    );

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

    return jsonSuccess(res, formatCreateOrderResponse(gatewayOrder));
  } catch (error) {
    console.error("CASHFREE CREATE ORDER ERROR:", error?.message || error);
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
    console.error("CASHFREE VERIFY ERROR:", error?.message || error);
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
    const dedupeKey =
      String(req.headers["x-idempotency-key"] || "").trim() ||
      `${eventType}:${cashfreeOrderId || "no-order"}:${cfPaymentId || "no-payment"}:${timestamp}`;

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
    console.error("CASHFREE WEBHOOK ERROR:", error?.message || error);
    return jsonError(res, 500, "Webhook processing failed.");
  }
};
