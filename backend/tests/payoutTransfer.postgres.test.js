import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("transfer claim is atomic and lost provider response remains processing without another transfer", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  process.env.CASHFREE_PAYOUT_CLIENT_ID = "isolated";
  process.env.CASHFREE_PAYOUT_CLIENT_SECRET = "isolated";
  const { default: db } = await import("../prisma/client.js");
  const { initiatePayoutTransfer, updatePayoutFromCashfreePayload } = await import("../services/cashfreePayoutService.js");
  const id = randomUUID();
  const faculty = await db.faculty.create({ data: { facultyId: `TRANSFER_${id}`, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Transfer Fixture", phone: id, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED" } });
  await db.facultyBankAccount.create({ data: { facultyId: faculty.id, verificationStatus: "VERIFIED", payoutEligible: true, cashfreeBeneficiaryId: "isolated-beneficiary" } });
  const original = globalThis.fetch;
  let calls = 0, loseResponse = false, webhookSuccessId = null, responseStatus = 200;
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).endsWith("/transfers"), "Unexpected external request");
    assert.ok(options.signal instanceof AbortSignal, "Provider calls must have a bounded timeout");
    calls++;
    await new Promise(resolve => setTimeout(resolve, 30));
    if (webhookSuccessId) await db.facultyPayout.update({ where: { id: webhookSuccessId }, data: { status: "SUCCESS", paidAt: new Date(), paidAmount: 400, unpaidAmount: 0 } });
    if (loseResponse) throw new TypeError("Controlled lost transfer response");
    return new Response(JSON.stringify({ status: "PENDING", message: "Controlled response" }), { status: responseStatus });
  };
  try {
    const payout = await db.facultyPayout.create({ data: { facultyId: faculty.id, amount: 400, status: "PENDING" } });
    await Promise.all([initiatePayoutTransfer(payout.id), initiatePayoutTransfer(payout.id), initiatePayoutTransfer(payout.id)]);
    assert.equal(calls, 1, "Only one worker may initiate a transfer");
    assert.equal((await db.facultyPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "PROCESSING");
    const uncertain = await db.facultyPayout.create({ data: { facultyId: faculty.id, amount: 400, status: "FAILED" } });
    loseResponse = true;
    await initiatePayoutTransfer(uncertain.id);
    const saved = await db.facultyPayout.findUniqueOrThrow({ where: { id: uncertain.id } });
    assert.equal(saved.status, "PROCESSING");
    assert.equal(saved.paidAt, null);
    assert.ok(saved.cashfreeTransferId);
    await initiatePayoutTransfer(uncertain.id);
    assert.equal(calls, 2, "Ambiguous acceptance must be reconciled, not submitted again");
    loseResponse = false;
    const raced = await db.facultyPayout.create({ data: { facultyId: faculty.id, amount: 400, status: "PENDING" } });
    webhookSuccessId = raced.id;
    await initiatePayoutTransfer(raced.id);
    assert.equal((await db.facultyPayout.findUniqueOrThrow({ where: { id: raced.id } })).status, "SUCCESS", "Late initiation response cannot downgrade webhook success");
    const completed = await db.facultyPayout.findUniqueOrThrow({ where: { id: raced.id } });
    await updatePayoutFromCashfreePayload({ data: { transfer_id: completed.cashfreeTransferId, status: "PENDING" } });
    await updatePayoutFromCashfreePayload({ data: { transfer_id: completed.cashfreeTransferId, status: "FAILED" } });
    assert.equal((await db.facultyPayout.findUniqueOrThrow({ where: { id: raced.id } })).status, "SUCCESS", "Stale callbacks cannot downgrade paid transfer");
    webhookSuccessId = null;
    for (const status of [400, 503]) {
      responseStatus = status;
      const attempt = await db.facultyPayout.create({ data: { facultyId: faculty.id, amount: 400, status: "PENDING" } });
      if (status === 400) await assert.rejects(initiatePayoutTransfer(attempt.id), { cashfreeStatus: 400 });
      else await initiatePayoutTransfer(attempt.id);
      assert.equal((await db.facultyPayout.findUniqueOrThrow({ where: { id: attempt.id } })).status, status === 400 ? "FAILED" : "PROCESSING");
    }
    delete process.env.CASHFREE_PAYOUT_CLIENT_SECRET;
    const unavailable = await db.facultyPayout.create({ data: { facultyId: faculty.id, amount: 400, status: "PENDING" } });
    await assert.rejects(initiatePayoutTransfer(unavailable.id), { statusCode: 503 });
    assert.equal((await db.facultyPayout.findUniqueOrThrow({ where: { id: unavailable.id } })).status, "PENDING");
  } finally { globalThis.fetch = original; await db.$disconnect(); }
});
