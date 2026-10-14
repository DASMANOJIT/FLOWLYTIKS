import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import express from "express";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("payout webhook fails closed without configuration/signature and preserves settled state on replay", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const app = express();
  app.use(express.json({ verify: (req, res, bytes) => { req.rawBody = bytes.toString(); } }));
  app.use("/api/faculty-payouts", (await import("../routes/facultypayoutroute.js")).default);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const faculty = await db.faculty.findFirstOrThrow();
  const payout = await db.facultyPayout.create({ data: { facultyId: faculty.id, amount: 123, status: "PROCESSING", cashfreeTransferId: `isolated-${randomUUID()}` } });
  const payload = { data: { transfer_id: payout.cashfreeTransferId, status: "SUCCESS" } };
  const rawBody = JSON.stringify(payload);
  const call = async (body = rawBody, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/faculty-payouts/cashfree/webhook`, { method: "POST", body, headers: { "Content-Type": "application/json", ...headers } });
    return response.status;
  };
  try {
    delete process.env.CASHFREE_PAYOUT_WEBHOOK_SECRET;
    delete process.env.CASHFREE_PAYOUT_CLIENT_SECRET;
    assert.equal(await call(), 503);
    assert.equal((await db.facultyPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "PROCESSING");
    process.env.CASHFREE_PAYOUT_WEBHOOK_SECRET = "isolated-signing-secret";
    assert.equal(await call(), 401);
    assert.equal(await call(rawBody, { "x-webhook-signature": "invalid" }), 401);
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", process.env.CASHFREE_PAYOUT_WEBHOOK_SECRET).update(timestamp + rawBody).digest("base64");
    const headers = { "x-webhook-signature": signature, "x-webhook-timestamp": timestamp };
    assert.equal(await call(rawBody, { "x-webhook-signature": signature }), 401);
    assert.equal(await call(rawBody + " ", headers), 401);
    assert.equal(await call(rawBody, headers), 200);
    const paid = await db.facultyPayout.findUniqueOrThrow({ where: { id: payout.id } });
    assert.equal(paid.status, "SUCCESS");
    assert.equal(await call(rawBody, headers), 200);
    assert.equal((await db.facultyPayout.findUniqueOrThrow({ where: { id: payout.id } })).paidAt.getTime(), paid.paidAt.getTime());
    assert.equal(await db.facultyPayoutEvent.count({ where: { payoutId: payout.id } }), 1);
  } finally { await new Promise(resolve => server.close(resolve)); await db.$disconnect(); }
});
