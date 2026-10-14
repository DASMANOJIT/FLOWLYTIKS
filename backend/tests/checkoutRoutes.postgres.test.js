import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("real checkout route: concurrent claim, no provider-held transaction, lost response recovery and paid fence", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true", timeout: 30000 }, async () => {
  requireDisposableDatabase();
  Object.assign(process.env, { CASHFREE_CLIENT_ID: "isolated", CASHFREE_CLIENT_SECRET: "isolated", CASHFREE_ENVIRONMENT: "sandbox", BACKEND_URL: "http://localhost:59999", CASHFREE_RETURN_URL: "http://localhost:59999/payment-success" });
  const { default: db } = await import("../prisma/client.js");
  const { addSession } = await import("../utils/sessionStore.js");
  const { getAcademicYear } = await import("../utils/academicYear.js");
  const student = await db.student.create({ data: { name: "Checkout route test", email: `${randomUUID()}@example.invalid`, phone: `9${Date.now().toString().slice(-9)}`, password: "TEST_LOGIN_DISABLED", school: "Test", class: "8", isVerified: true } });
  const jti = randomUUID(); await addSession("student", student.id, jti, Date.now() + 600000);
  const token = jwt.sign({ id: student.id, role: "student", jti }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const app = express(); app.use(express.json()); app.use("/api/payments", (await import("../routes/paymentroute.js")).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/payments/cashfree/create-order`;
  const localFetch = globalThis.fetch;
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let creates = 0, reads = 0, accepted, idempotency;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== "sandbox.cashfree.com") return localFetch(input, options);
    const activeTransactions = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'`;
    assert.equal(activeTransactions[0].count, 0, "Provider access must not retain a DB transaction");
    if (options.method === "POST") {
      creates++; const body = JSON.parse(options.body); idempotency = options.headers["x-idempotency-key"];
      accepted = { order_id: body.order_id, order_amount: body.order_amount, order_currency: "INR", order_status: "ACTIVE", payment_session_id: "mock-session" };
      entered(); await new Promise(resolve => { release = resolve; });
      throw new Error("Controlled lost provider response");
    }
    reads++; return Response.json(accepted);
  };
  const post = month => localFetch(base, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ studentId: student.id, month, amount: 600 }) });
  try {
    const first = post("August");
    await Promise.race([ready, first.then(response => assert.fail(`Checkout returned ${response.status} before mocked provider access`))]);
    assert.equal((await post("August")).status, 409);
    release(); assert.equal((await first).status, 500);
    const saved = await db.paymentGatewayOrder.findFirstOrThrow({ where: { studentId: student.id } });
    assert.equal(saved.id, idempotency); assert.equal(saved.cashfreeOrderId, accepted.order_id);
    assert.equal(saved.metadata.checkoutLease, undefined);
    assert.equal((await post("August")).status, 200);
    assert.equal(creates, 1); assert.equal(reads, 1);
    assert.equal((await post("August")).status, 200); assert.equal(reads, 1);
    assert.equal(await db.paymentGatewayOrder.count({ where: { studentId: student.id } }), 1);
    await db.payment.update({ where: { studentId_month_academicYear: { studentId: student.id, month: "August", academicYear: getAcademicYear() } }, data: { status: "paid" } });
    assert.equal((await post("August")).status, 400); assert.equal(creates, 1);
  } finally { release?.(); globalThis.fetch = localFetch; await new Promise(resolve => server.close(resolve)); await db.$disconnect(); }
});
