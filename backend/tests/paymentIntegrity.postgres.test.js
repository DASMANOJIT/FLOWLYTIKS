import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("real payment routes reject mismatched provider evidence and preserve replay/ownership integrity", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  process.env.CASHFREE_CLIENT_ID = "isolated";
  process.env.CASHFREE_CLIENT_SECRET = "isolated";
  process.env.CASHFREE_WEBHOOK_SECRET = "isolated-webhook";
  process.env.CASHFREE_ENVIRONMENT = "sandbox";
  const { default: db } = await import("../prisma/client.js");
  const { addSession } = await import("../utils/sessionStore.js");
  const app = express();
  app.use(express.json({ verify: (req, res, buffer) => { req.rawBody = buffer.toString(); } }));
  app.use("/api/payments", (await import("../routes/paymentroute.js")).default);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  const orderId = `isolated-${crypto.randomUUID()}`;
  let order, attempts = [], providerCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://sandbox.cashfree.com/pg/orders/")) {
      providerCalls++;
      return new Response(JSON.stringify(String(url).endsWith("/payments") ? attempts : order));
    }
    return originalFetch(url, options);
  };
  const call = async (path, token, body, headers = {}) => {
    const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const student = await db.student.create({ data: { name: "Payment integrity fixture", password: "TEST_LOGIN_DISABLED", phone: crypto.randomUUID(), school: "Test", class: "8", isVerified: true } });
    const other = await db.student.create({ data: { name: "Other owner", password: "TEST_LOGIN_DISABLED", phone: crypto.randomUUID(), school: "Test", class: "8", isVerified: true } });
    const tokenFor = async id => {
      const jti = crypto.randomUUID(), expires = Date.now() + 600000;
      await addSession("student", id, jti, expires);
      return jwt.sign({ id, role: "student", jti }, process.env.JWT_SECRET, { expiresIn: "10m", algorithm: "HS256" });
    };
    const ownerToken = await tokenFor(student.id), otherToken = await tokenFor(other.id);
    const payment = await db.payment.create({ data: { studentId: student.id, month: "August", academicYear: 2026, amount: 600, status: "created", paymentProvider: "CASHFREE" } });
    const gateway = await db.paymentGatewayOrder.create({ data: { studentId: student.id, paymentId: payment.id, cashfreeOrderId: orderId, month: "August", academicYear: 2026, amount: 600 } });
    const path = `/api/payments/cashfree/verify?paymentId=${payment.id}`;
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path, otherToken)).status, 403);
    assert.equal(providerCalls, 0);
    order = { order_id: orderId, order_status: "PAID", order_amount: 600, order_currency: "INR" };
    attempts = [{ cf_payment_id: `cf-${crypto.randomUUID()}`, order_id: orderId, payment_status: "SUCCESS", payment_amount: 1, payment_currency: "INR", payment_method: { upi: {} } }];
    assert.equal((await call(path, ownerToken)).status, 502, "A successful status with the wrong amount must not mark paid");
    assert.equal((await db.payment.findUnique({ where: { id: payment.id } })).status, "created");
    attempts[0].payment_amount = 600;
    for (const mutation of [{ order_id: "wrong-order" }, { order_currency: "USD" }, { order_amount: 1 }]) {
      const valid = order; order = { ...valid, ...mutation };
      assert.equal((await call(path, ownerToken)).status, 502);
      order = valid;
    }
    order.order_status = "ACTIVE"; attempts = [];
    assert.equal((await call(path, ownerToken)).body.status, "INITIATED");
    const payload = { type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: orderId } } };
    const timestamp = String(Date.now());
    const signature = crypto.createHmac("sha256", process.env.CASHFREE_WEBHOOK_SECRET).update(timestamp + JSON.stringify(payload)).digest("base64");
    assert.equal((await call("/api/payments/cashfree/webhook", null, payload, { "x-webhook-signature": "wrong", "x-webhook-timestamp": timestamp })).status, 401);
    const headers = { "x-webhook-signature": signature, "x-webhook-timestamp": timestamp };
    const formattedBody = JSON.stringify(payload, null, 2);
    const rawWebhook = async (signatureValue, includeTimestamp = true) => {
      const response = await fetch(base + "/api/payments/cashfree/webhook", {
        method: "POST", body: formattedBody,
        headers: { "Content-Type": "application/json", "x-webhook-signature": signatureValue,
          ...(includeTimestamp ? { "x-webhook-timestamp": timestamp } : {}) },
      });
      return response.status;
    };
    assert.equal(await rawWebhook(signature), 401, "Signature of reserialized JSON must not validate different raw bytes");
    assert.equal(await rawWebhook(signature, false), 400);
    const formattedSignature = crypto.createHmac("sha256", process.env.CASHFREE_WEBHOOK_SECRET).update(timestamp + formattedBody).digest("base64");
    assert.equal(await rawWebhook(formattedSignature), 200, "Exact raw-body signature must validate, including whitespace");
    assert.equal((await call("/api/payments/cashfree/webhook", null, payload, headers)).status, 200);
    assert.notEqual((await db.payment.findUnique({ where: { id: payment.id } })).status, "paid");
    const calls = providerCalls;
    assert.equal((await call("/api/payments/cashfree/webhook", null, payload, headers)).body.duplicate, true);
    assert.equal(providerCalls, calls);
    order.order_status = "PAID";
    attempts = [{ cf_payment_id: `cf-${crypto.randomUUID()}`, order_id: orderId, payment_status: "SUCCESS", payment_amount: 600, payment_currency: "INR", payment_method: { upi: {} } }];
    const concurrent = await Promise.all(Array.from({ length: 3 }, () => call(path, ownerToken)));
    assert.ok(concurrent.every(result => result.status === 200 && result.body.status === "PAID"));
    const paid = await db.payment.findUnique({ where: { id: payment.id } });
    const successfulAttempt = { ...attempts[0] };
    assert.equal(paid.status, "paid"); assert.equal(paid.amount, 600);
    assert.equal((await call(path, ownerToken)).body.status, "PAID");
    assert.equal(await db.paymentAttempt.count({ where: { gatewayOrderId: gateway.id } }), 1);
    assert.equal((await db.payment.findUnique({ where: { id: payment.id } })).paidAt.getTime(), paid.paidAt.getTime());
    order.order_status = "ACTIVE"; attempts = [];
    const stale = await call(path, ownerToken);
    assert.equal(stale.body.status, "PAID", "A delayed pending provider snapshot must not downgrade a verified paid order");
    assert.equal((await db.paymentGatewayOrder.findUnique({ where: { id: gateway.id } })).status, "PAID");
    assert.equal((await db.payment.findUnique({ where: { id: payment.id } })).paidAt.getTime(), paid.paidAt.getTime());
    order.order_status = "PAID"; attempts = [successfulAttempt];
    const paidPayload = { ...payload, type: "VERIFIED_SUCCESS", data: { order: { order_id: orderId }, payment: { cf_payment_id: successfulAttempt.cf_payment_id } } };
    const paidSignature = crypto.createHmac("sha256", process.env.CASHFREE_WEBHOOK_SECRET).update(timestamp + JSON.stringify(paidPayload)).digest("base64");
    const replays = await Promise.all(Array.from({ length: 3 }, () => call("/api/payments/cashfree/webhook", null, paidPayload, { ...headers, "x-webhook-signature": paidSignature })));
    assert.ok(replays.every(result => result.status === 200));
    assert.equal(await db.paymentAttempt.count({ where: { gatewayOrderId: gateway.id } }), 1);
    assert.equal((await db.payment.findUnique({ where: { id: payment.id } })).paidAt.getTime(), paid.paidAt.getTime());
  } finally {
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => setImmediate(resolve));
    globalThis.fetch = originalFetch;
    await db.$disconnect();
  }
});
