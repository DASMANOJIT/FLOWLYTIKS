import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("weekly cash payout rolls back record failure, pays once concurrently and reconciles immutable history", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { payWeeklyCash } = await import("../controllers/facultyweeklypaymentcontrollers.js");
  const { attendanceWeek } = await import("../services/dailyAttendanceService.js");
  let week = attendanceWeek(new Date("2191-01-01"));
  while (await db.payrollCycle.count({ where: { startDate: week.start } })) week = attendanceWeek(new Date(+week.start + 14 * 86400000));
  const id = randomUUID();
  const faculty = await db.faculty.create({ data: { facultyId: `FIN_${id}`, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Financial Fixture", phone: id, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
  await db.workLedgerEntry.create({ data: { facultyId: faculty.id, date: week.start, shift: "DAILY", amount: 375, createdBy: "admin:test" } });
  const admin = await db.admin.findFirstOrThrow();
  const req = { userRole: "admin", user: admin, query: {}, body: { weekStart: week.start.toISOString().slice(0, 10), weekEnd: week.end.toISOString().slice(0, 10) } };
  const run = async () => { const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await payWeeklyCash(req, res); return res; };
  const original = db.weeklyFacultyPaymentRecord.upsert;
  const transaction = db.$transaction.bind(db);
  try {
    db.weeklyFacultyPaymentRecord.upsert = async () => { throw new Error("Controlled payment-record failure"); };
    db.$transaction = (work, options) => transaction(tx => work(new Proxy(tx, {
      get(target, key) {
        if (key === "weeklyFacultyPaymentRecord") return new Proxy(target[key], {
          get(delegate, method) {
            if (method === "upsert") return async () => { throw new Error("Controlled payment-record failure"); };
            return delegate[method];
          },
        });
        return target[key];
      },
    })), options);
    assert.equal((await run()).code, 500);
    assert.equal(await db.payrollCycle.count({ where: { startDate: week.start, status: "PAID" } }), 0, "No paid cycle may survive a failed record write");
    assert.equal(await db.facultyEarningsPayroll.count({ where: { facultyId: faculty.id, status: "PAID" } }), 0);
    db.weeklyFacultyPaymentRecord.upsert = original;
    db.$transaction = transaction;
    const results = await Promise.all([run(), run(), run()]);
    assert.equal(results.filter(result => result.code === 200).length, 1);
    assert.ok(results.filter(result => result.code !== 200).every(result => result.code === 409));
    const record = await db.weeklyFacultyPaymentRecord.findUniqueOrThrow({ where: { weekStart_weekEnd: { weekStart: week.start, weekEnd: week.end } }, include: { facultyRecords: true } });
    assert.equal(Number(record.totalAmount), 375); assert.equal(Number(record.paidAmount), 375); assert.equal(Number(record.pendingAmount), 0);
    assert.equal(record.facultyRecords.length, 1); assert.equal(Number(record.facultyRecords[0].amount), 375);
    assert.equal((await run()).code, 409);
    assert.equal((await db.weeklyFacultyPaymentRecord.findUniqueOrThrow({ where: { id: record.id } })).paidAt.getTime(), record.paidAt.getTime());
  } finally { db.weeklyFacultyPaymentRecord.upsert = original; db.$transaction = transaction; await db.$disconnect(); }
});
