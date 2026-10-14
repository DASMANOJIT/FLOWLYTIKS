import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("online incentive payout reserves entries before transfer and reconciles one payment after response loss", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  process.env.CASHFREE_PAYOUT_CLIENT_ID = "isolated"; process.env.CASHFREE_PAYOUT_CLIENT_SECRET = "isolated";
  const { default: db } = await import("../prisma/client.js");
  const { payFacultyIncentives } = await import("../controllers/facultyextraincentivecontrollers.js");
  const { syncPayoutStatus } = await import("../services/cashfreePayoutService.js");
  const { saveCopySet } = await import("../services/incentiveCopySetService.js");
  const id = randomUUID();
  const faculty = await db.faculty.create({ data: { facultyId: `EXTRA_${id}`, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Extra Fixture", phone: id, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED" } });
  await db.facultyBankAccount.create({ data: { facultyId: faculty.id, verificationStatus: "VERIFIED", payoutEligible: true, cashfreeBeneficiaryId: "isolated-beneficiary" } });
  const type = await db.extraIncentiveType.create({ data: { name: `Test ${id}`, rate: 75 } });
  const entry = await saveCopySet(faculty.id, type.id, { quantity: 3, remark: "Isolated", requestId: randomUUID() });
  const original = globalThis.fetch;
  let calls = 0, reservedBeforeTransfer = false, rejectTransfer = false;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^https:\/\/sandbox\.cashfree\.com\/payout\/transfers/);
    if (options.method === "POST") {
      calls++;
      if (rejectTransfer) return new Response(JSON.stringify({ message: "Controlled rejection" }), { status: 400 });
      reservedBeforeTransfer = await db.facultyExtraIncentivePayment.count({ where: { facultyId: faculty.id, status: "PROCESSING", facultyPayoutId: { not: null } } }) === 1;
      throw new TypeError("Controlled transfer response loss");
    }
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/payout/transfers", "Cashfree v2 status uses a query parameter, not a path ID");
    assert.ok(parsed.searchParams.get("transfer_id"));
    return new Response(JSON.stringify({ status: "SUCCESS" }));
  };
  const req = { userRole: "admin", user: await db.admin.findFirstOrThrow(), params: { facultyId: faculty.id }, body: { method: "CASHFREE" }, headers: {} };
  const run = async () => { const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await payFacultyIncentives(req, res); return res; };
  try {
    assert.equal((await run()).code, 200);
    assert.equal(reservedBeforeTransfer, true, "A crash after provider acceptance must leave the entries linked to their payout");
    assert.equal((await run()).code, 400);
    assert.equal(calls, 1);
    await assert.rejects(saveCopySet(faculty.id, type.id, { quantity: 4, expectedUpdatedAt: entry.entry.updatedAt.toISOString() }, entry.entry.id), { status: 409 });
    const payout = await db.facultyPayout.findFirstOrThrow({ where: { facultyId: faculty.id } });
    await syncPayoutStatus(payout.id); await syncPayoutStatus(payout.id);
    const payment = await db.facultyExtraIncentivePayment.findFirstOrThrow({ where: { facultyId: faculty.id } });
    assert.equal(payment.status, "PAID"); assert.equal(Number(payment.totalAmount), 225);
    assert.equal(await db.facultyExtraIncentivePayment.count({ where: { facultyId: faculty.id } }), 1);
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId: faculty.id, status: "PENDING" } }), 0);
    await saveCopySet(faculty.id, type.id, { quantity: 2, remark: "Rejected transfer", requestId: randomUUID() });
    rejectTransfer = true;
    assert.equal((await run()).code, 400);
    assert.equal(await db.facultyExtraIncentivePayment.count({ where: { facultyId: faculty.id, status: "FAILED" } }), 1);
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId: faculty.id, status: "PENDING", paymentRecordId: null } }), 1);
    req.body = { method: "CASH" };
    const cash = await Promise.all(Array.from({ length: 3 }, run));
    assert.equal(cash.filter(result => result.code === 200).length, 1);
    assert.ok(cash.filter(result => result.code !== 200).every(result => [400, 409].includes(result.code)));
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId: faculty.id, status: "PENDING" } }), 0);
    const totals = await db.facultyExtraIncentivePayment.aggregate({ where: { facultyId: faculty.id, status: "PAID" }, _sum: { totalAmount: true } });
    assert.equal(Number(totals._sum.totalAmount), 375);
    assert.equal(calls, 2, "Cash retry must not dispatch another online transfer");
  } finally { globalThis.fetch = original; await db.$disconnect(); }
});
