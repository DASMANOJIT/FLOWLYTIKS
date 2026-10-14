import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("weekly online reservation excludes cash while provider is unresolved and recovers accepted transfer", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  process.env.CASHFREE_PAYOUT_CLIENT_ID = "isolated";
  process.env.CASHFREE_PAYOUT_CLIENT_SECRET = "isolated";
  const { default: db } = await import("../prisma/client.js");
  const { payWeeklyCash, payWeeklyOnline } = await import("../controllers/facultyweeklypaymentcontrollers.js");
  const { syncPayoutStatus } = await import("../services/cashfreePayoutService.js");
  const { attendanceWeek } = await import("../services/dailyAttendanceService.js");
  let week = attendanceWeek(new Date("2193-01-01"));
  while (await db.payrollCycle.count({ where: { startDate: week.start } })) week = attendanceWeek(new Date(+week.start + 14 * 86400000));
  const id = randomUUID();
  const faculty = await db.faculty.create({ data: { facultyId: `ONLINE_${id}`, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Online Fixture", phone: id, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED" } });
  await db.facultyBankAccount.create({ data: { facultyId: faculty.id, verificationStatus: "VERIFIED", payoutEligible: true, cashfreeBeneficiaryId: "isolated-beneficiary" } });
  await db.workLedgerEntry.create({ data: { facultyId: faculty.id, date: week.start, shift: "DAILY", amount: 375, createdBy: "admin:test" } });
  const req = { userRole: "admin", user: await db.admin.findFirstOrThrow(), query: {}, body: { weekStart: week.start.toISOString().slice(0, 10), weekEnd: week.end.toISOString().slice(0, 10) } };
  const run = async handler => { const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await handler(req, res); return res; };
  const original = globalThis.fetch;
  const originalTransaction = db.$transaction.bind(db);
  let release, entered, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /^https:\/\/sandbox\.cashfree\.com\/payout\/transfers/);
    if (options.method === "POST") { calls++; entered(); await gate; throw new TypeError("Controlled accepted transfer response loss"); }
    return new Response(JSON.stringify({ status: "SUCCESS", transfer_id: String(url).split("/").at(-1), utr: "isolated-reference" }));
  };
  let online;
  try {
    online = run(payWeeklyOnline);
    await Promise.race([started, online.then(result => { throw new Error(`Online request ended before provider: ${result.code}`); })]);
    assert.equal((await run(payWeeklyCash)).code, 409, "Cash cannot pay a week with an in-flight online transfer");
    assert.equal((await run(payWeeklyOnline)).code, 409);
    release();
    assert.equal((await online).code, 200);
    const rows = await db.facultyPayout.findMany({ where: { facultyId: faculty.id } });
    assert.equal(rows.length, 1); assert.equal(rows[0].status, "PROCESSING"); assert.equal(calls, 1);
    await db.facultyPayout.create({ data: { facultyId: faculty.id, payrollId: rows[0].payrollId, amount: 375, status: "FAILED", createdAt: new Date(rows[0].createdAt.getTime() - 1000) } });
    let failedOnce = false;
    db.$transaction = (...args) => {
      if (!failedOnce) { failedOnce = true; throw new Error("Controlled weekly reconciliation failure"); }
      return originalTransaction(...args);
    };
    await syncPayoutStatus(rows[0].id);
    db.$transaction = originalTransaction;
    await syncPayoutStatus(rows[0].id);
    const record = await db.weeklyFacultyPaymentRecord.findUniqueOrThrow({ where: { weekStart_weekEnd: { weekStart: week.start, weekEnd: week.end } }, include: { facultyRecords: true } });
    assert.equal(record.status, "PAID"); assert.equal(Number(record.paidAmount), 375); assert.equal(Number(record.pendingAmount), 0);
    assert.equal(record.facultyRecords.length, 1); assert.equal(record.facultyRecords[0].status, "PAID");
    assert.equal(calls, 1);
  } finally { release(); if (online) await online; db.$transaction = originalTransaction; globalThis.fetch = original; await db.$disconnect(); }
});
