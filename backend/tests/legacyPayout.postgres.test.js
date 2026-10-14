import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("legacy payout creation and manual settlement are single-use and cannot downgrade paid history", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { createPayout, markPayoutPaid, markPayoutFailed } = await import("../services/facultyPayoutService.js");
  const id = randomUUID();
  const faculty = await db.faculty.create({ data: { facultyId: id, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Legacy payout fixture", phone: id, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED" } });
  const date = new Date(Date.now() + Math.floor(Math.random() * 1e12));
  const cycle = await db.payrollCycle.create({ data: { cycleNumber: id, startDate: date, endDate: new Date(+date + 86400000), status: "APPROVED" } });
  const payroll = await db.facultyEarningsPayroll.create({ data: { facultyId: faculty.id, payrollCycleId: cycle.id, totalEntries: 1, totalAmount: 321, status: "APPROVED" } });
  const original = db.$transaction.bind(db);
  try {
    const created = await Promise.all(Array.from({ length: 3 }, () => createPayout({ payrollId: payroll.id, facultyId: "spoofed", amount: 1 })));
    assert.equal(new Set(created.map(row => row.id)).size, 1, "One active payout per payroll");
    const payout = created[0]; assert.equal(payout.facultyId, faculty.id); assert.equal(Number(payout.amount), 321);
    await assert.rejects(markPayoutPaid(payout.id, {}), /required/);
    db.$transaction = (work, options) => original(typeof work === "function" ? tx => work(new Proxy(tx, { get(target, key) {
      if (key === "facultyEarningsPayroll") return new Proxy(target[key], { get(delegate, method) { return method === "update" ? async () => { throw new Error("Injected payroll write failure"); } : delegate[method]; } });
      return target[key];
    } })) : work, options);
    await assert.rejects(markPayoutPaid(payout.id, { transactionId: "fixture" }), /Injected/);
    db.$transaction = original;
    assert.equal((await db.facultyPayout.findUniqueOrThrow({ where: { id: payout.id } })).status, "PENDING");
    assert.equal((await db.facultyEarningsPayroll.findUniqueOrThrow({ where: { id: payroll.id } })).status, "APPROVED");
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => markPayoutPaid(payout.id, { transactionId: "fixture" })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const settled = await db.facultyPayout.findUniqueOrThrow({ where: { id: payout.id } });
    await assert.rejects(markPayoutFailed(payout.id, { failureReason: "stale" }));
    assert.deepEqual(await db.facultyPayout.findUniqueOrThrow({ where: { id: payout.id } }), settled);
    assert.equal(Number(settled.paidAmount), 321); assert.equal(Number(settled.unpaidAmount), 0);
    assert.equal(await db.notification.count({ where: { facultyId: faculty.id, type: "PAYOUT_SUCCESS" } }), 1);
    const uncertain = await db.facultyPayout.create({ data: { facultyId: faculty.id, amount: 25, status: "PROCESSING", cashfreeTransferId: randomUUID(), cashfreeStatus: "UNKNOWN_AFTER_REQUEST" } });
    await assert.rejects(markPayoutFailed(uncertain.id, { failureReason: "force retry" }), /reconcil/i);
    assert.equal((await db.facultyPayout.findUniqueOrThrow({ where: { id: uncertain.id } })).status, "PROCESSING");
  } finally { db.$transaction = original; await db.$disconnect(); }
});
