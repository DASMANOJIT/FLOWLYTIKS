import crypto from "node:crypto";
import { withPgTransactionLock } from "../utils/dbLocks.js";

// Persist reservations before provider access. Retries reuse the same provider
// order/idempotency key, including an uncertain response or a crashed process.
export async function reserveCashfreeCheckout(db, details) {
  const { studentId, academicYear, month, amount, teacherAdminId, environment, preferredMethod, notifyUrl } = details;
  const key = `cashfree:create:${studentId}:${academicYear}:${month}`;
  return withPgTransactionLock(db, key, async tx => {
    let payment = await tx.payment.findUnique({ where: { studentId_month_academicYear: { studentId, academicYear, month } } });
    if (payment?.status === "paid") return { alreadyPaid: true };
    if (!payment) payment = await tx.payment.create({ data: { studentId, academicYear, month, amount, teacherAdminId, currency: "INR", status: "created", paymentProvider: "CASHFREE" } });
    let order = await tx.paymentGatewayOrder.findFirst({ where: { paymentId: payment.id, provider: "CASHFREE", status: { in: ["PENDING", "INITIATED"] } }, orderBy: { createdAt: "desc" } });
    if (order?.metadata?.cashfreeEnvironment === environment && order.paymentSessionId && (!order.orderExpiryTime || order.orderExpiryTime > new Date())) return { reusableOrder: order };
    if (order?.metadata?.checkoutLease?.expiresAt > new Date().toISOString()) return { locked: true };
    // An existing order's stored amount is part of its provider identity.
    const recover = Boolean(order && order.metadata?.cashfreeEnvironment === environment);
    if (!recover) {
      const updated = await tx.payment.updateMany({ where: { id: payment.id, status: { not: "paid" } }, data: { amount, currency: "INR", teacherAdminId, paymentProvider: "CASHFREE" } });
      if (!updated.count) return { alreadyPaid: true };
      order = await tx.paymentGatewayOrder.create({ data: { provider: "CASHFREE", status: "PENDING", paymentId: payment.id, studentId, teacherAdminId, amount, currency: "INR", month, academicYear, cashfreeOrderId: `flowlytiks_${payment.id}_${month.slice(0, 3).toUpperCase()}_${crypto.randomUUID()}`, paymentMethodHint: preferredMethod, notifyUrl: typeof notifyUrl === "function" ? notifyUrl() : notifyUrl, metadata: { preferredMethod, cashfreeEnvironment: environment } } });
    }
    const leaseId = crypto.randomUUID();
    const gatewayOrder = await tx.paymentGatewayOrder.update({ where: { id: order.id }, data: { metadata: { ...(order.metadata || {}), checkoutLease: { id: leaseId, expiresAt: new Date(Date.now() + 120000).toISOString() } } } });
    return { gatewayOrder, payment, leaseId, recover, key };
  }, { onLocked: () => ({ locked: true }) });
}

export async function finishCashfreeCheckout(db, reservation, data) {
  return withPgTransactionLock(db, reservation.key, async tx => {
    // Share the existing verification/webhook fence before inspecting paid
    // state, so a delayed checkout response cannot downgrade confirmed success.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`cashfree:finalize:${reservation.gatewayOrder.cashfreeOrderId}`})::bigint)::text AS locked`;
    const order = await tx.paymentGatewayOrder.findUnique({ where: { id: reservation.gatewayOrder.id } });
    const payment = await tx.payment.findUnique({ where: { id: order.paymentId } });
    if (payment.status === "paid" || order.status === "PAID") return { alreadyPaid: true };
    if (order.metadata?.checkoutLease?.id !== reservation.leaseId) return { locked: true };
    const metadata = { ...(order.metadata || {}) }; delete metadata.checkoutLease;
    const saved = await tx.paymentGatewayOrder.update({ where: { id: order.id }, data: { ...data, metadata } });
    return { gatewayOrder: saved, expired: data.status === "EXPIRED" };
  }, { onLocked: () => ({ locked: true }) });
}
