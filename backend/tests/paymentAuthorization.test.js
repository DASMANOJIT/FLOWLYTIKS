import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";

// All persistence and provider access is controlled in-memory; no .env is loaded.
process.env.CASHFREE_CLIENT_ID = "controlled-client";
process.env.CASHFREE_CLIENT_SECRET = "controlled-secret";
process.env.CASHFREE_WEBHOOK_SECRET = "controlled-webhook-secret";
process.env.CASHFREE_ENVIRONMENT = "sandbox";
let reads = 0, providerCalls = 0, paidWrites = 0, duplicate = false;
let providerPayments = [];
const payment = { id: 7, studentId: 77, month: "March", academicYear: 2026, status: "created", amount: 200 };
const gateway = { id: "test-gateway", studentId: 77, paymentId: 7, cashfreeOrderId: "test-order", month: "March", academicYear: 2026, amount: 200, currency: "INR", paymentSessionId: "controlled-checkout-session", orderExpiryTime: new Date(Date.now() + 60000), metadata: { cashfreeEnvironment: "sandbox" } };
const db = {
  $queryRaw: async () => [{ acquired: true, released: true }],
  $transaction: async work => work(db),
  admin: { findMany: async () => [{ id: 1 }] },
  student: { findUnique: async () => ({ id: 77, name: "Test Student", email: "test@example.com", phone: "9999999999", monthlyFee: 200 }) },
  payment: {
    findUnique: async () => payment,
    update: async ({ data }) => ({ ...payment, ...data }),
    updateMany: async ({ data }) => { if (data.status === "paid") paidWrites++; return { count: 0 }; },
  },
  paymentGatewayOrder: {
    findUnique: async () => { reads++; return gateway; },
    findFirst: async () => { reads++; return gateway; },
    update: async ({ data }) => ({ ...gateway, ...data }),
  },
  paymentAttempt: { upsert: async () => ({}) },
  paymentWebhookEvent: {
    create: async ({ data }) => {
      if (duplicate) throw Object.assign(new Error("Duplicate"), { code: "P2002" });
      return { id: "event-one", ...data };
    },
    findUnique: async () => ({ id: "event-one", processedAt: new Date() }),
    update: async () => ({}),
  },
};
globalThis.__flowlytiksPrisma = db;
globalThis.fetch = async url => {
  providerCalls++;
  assert.match(String(url), /^https:\/\/sandbox\.cashfree\.com\/pg\/orders\//);
  return { ok: true, json: async () => String(url).endsWith("/payments") ? providerPayments : { order_id: "test-order", order_amount: 200, order_status: "ACTIVE", order_currency: "INR" } };
};
const { verifyCashfreePayment, createCashfreeHostedOrder, handleCashfreeWebhook } = await import("../controllers/cashfreecontroller.js");
const { protect } = await import("../middleware/authmiddleware.js");
const { verifyCashfreeWebhookSignature } = await import("../services/cashfreeService.js");
const { default: routes } = await import("../routes/paymentroute.js");
const response = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } });

test("retired PhonePe endpoints are absent; schema/history/receipts remain", async () => {
  assert.equal(routes.stack.some(layer => layer.route?.path.includes("phonepe")), false);
  for (const path of ["/phonepe/initiate", "/phonepe/callback", "/phonepe/status/old-reference"]) {
    const before = [reads, providerCalls, paidWrites];
    await new Promise((resolve, reject) => routes.handle({ method: "POST", url: path, headers: {}, body: { code: "PAYMENT_SUCCESS" } }, response(), error => error ? reject(error) : resolve()));
    assert.deepEqual([reads, providerCalls, paidWrites], before);
  }
  assert.match(await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"), /phonepeTransactionId/);
  assert.match(await readFile(new URL("../../frontend/lib/paymentReceiptPdf.js", import.meta.url), "utf8"), /phonepeTransactionId/);
  const res = response();
  await protect({ headers: {}, originalUrl: "/api/payments/cashfree/verify" }, res, () => assert.fail("Unauthorized"));
  assert.equal(res.statusCode, 401);
});

test("verification blocks unrelated roles before lookup/provider access", async () => {
  for (const role of ["faculty", "staff", "guardian", undefined]) {
    const before = [reads, providerCalls];
    const res = response();
    await verifyCashfreePayment({ userRole: role, method: "GET", query: { paymentId: "7" } }, res);
    assert.equal(res.statusCode, role ? 403 : 401);
    assert.deepEqual([reads, providerCalls], before);
    assert.equal(res.body.amount, undefined);
  }
});

test("student ownership is retained and Admin/owning Student verification works", async () => {
  const foreign = response(), before = providerCalls;
  await verifyCashfreePayment({ userRole: "student", user: { id: 78 }, method: "GET", query: { paymentId: "7" } }, foreign);
  assert.equal(foreign.statusCode, 403);
  assert.equal(providerCalls, before);
  for (const [role, method] of [["admin", "GET"], ["student", "POST"]]) {
    const res = response();
    await verifyCashfreePayment({ userRole: role, user: { id: 77 }, method, query: { paymentId: "7" }, body: { paymentId: 7 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "INITIATED");
    assert.equal(res.body.paymentId, 7);
    assert.equal(res.body.amount, 200);
  }
  assert.equal(paidWrites, 0);
});

test("checkout still returns a reusable Cashfree session only to its owner", async () => {
  for (const req of [{ userRole: "faculty", user: { id: 77 } }, { userRole: "student", user: { id: 78 } }]) {
    const res = response();
    await createCashfreeHostedOrder({ ...req, body: { studentId: 77, month: "March" } }, res);
    assert.equal(res.statusCode, 403);
  }
  const res = response();
  await createCashfreeHostedOrder({ userRole: "student", user: { id: 77 }, body: { studentId: 77, month: "March" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.payment_session_id, gateway.paymentSessionId);
});

test("webhook signature and deduplication remain independent of caller roles", async () => {
  const body = { type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "test-order" } } };
  const rawBody = JSON.stringify(body), timestamp = String(Date.now());
  const signature = crypto.createHmac("sha256", process.env.CASHFREE_WEBHOOK_SECRET).update(timestamp + rawBody).digest("base64");
  assert.equal(verifyCashfreeWebhookSignature({ rawBody, signature, timestamp }), true);
  assert.equal(verifyCashfreeWebhookSignature({ rawBody: rawBody + " ", signature, timestamp }), false);
  const invalid = response(), before = providerCalls;
  await handleCashfreeWebhook({ rawBody, body, headers: { "x-webhook-signature": "invalid", "x-webhook-timestamp": timestamp } }, invalid);
  assert.equal(invalid.statusCode, 401);
  assert.equal(providerCalls, before);
  const req = { rawBody, body, headers: { "x-webhook-signature": signature, "x-webhook-timestamp": timestamp } };
  const valid = response();
  await handleCashfreeWebhook(req, valid);
  assert.equal(valid.statusCode, 200);
  duplicate = true;
  const after = providerCalls, replay = response();
  await handleCashfreeWebhook(req, replay);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(providerCalls, after);
  assert.equal(paidWrites, 0, "Success in a webhook body alone must not mark payment paid");
});

test("authoritative successful Cashfree evidence still reconciles a payment", async () => {
  providerPayments = [{ cf_payment_id: "controlled-payment", payment_status: "SUCCESS", payment_amount: 200, payment_currency: "INR", payment_method: { upi: {} } }];
  try {
    const res = response();
    await verifyCashfreePayment({ userRole: "student", user: { id: 77 }, method: "POST", body: { paymentId: 7 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, "PAID");
    assert.equal(res.body.cfPaymentId, "controlled-payment");
    assert.equal(paidWrites, 1);
  } finally { providerPayments = []; }
});
