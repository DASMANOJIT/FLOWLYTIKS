import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("real attendance transactions enforce Friday noon and settled locks without changing amounts", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async t => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { setDailyAttendance, attendanceWeek } = await import("../services/dailyAttendanceService.js");
  const id = randomUUID();
  const actor = { updatedBy: "faculty:test", updatedByRole: "FACULTY", updatedByName: "Test" };
  let weeklyId;
  try {
    await db.faculty.create({ data: { id, facultyId: `BOUNDARY_${id}`, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Boundary Test", phone: id, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
    t.mock.timers.enable({ apis: ["Date"], now: new Date("2087-10-10T06:29:59.999Z").getTime() });
    // Derive the fixture's preceding Friday-Thursday week rather than assuming a weekday.
    const now = new Date();
    const current = attendanceWeek(now);
    const previous = new Date(current.start); previous.setUTCDate(previous.getUTCDate() - 1);
    const week = attendanceWeek(previous);
    t.mock.timers.setTime(+week.deadline - 1);
    const saturday = new Date(week.start); saturday.setUTCDate(saturday.getUTCDate() + 1);
    const input = { role: "faculty", actorId: id, date: saturday.toISOString().slice(0, 10), present: true, actor };
    const marked = await setDailyAttendance(input, db);
    assert.equal(Number(marked.entry.amount), 400);
    t.mock.timers.setTime(+week.deadline);
    await assert.rejects(setDailyAttendance({ ...input, present: false }, db), { status: 403 });
    assert.equal(Number((await db.workLedgerEntry.findUnique({ where: { id: marked.entry.id } })).amount), 400);
    await setDailyAttendance({ ...input, role: "admin", facultyId: id, present: false }, db);
    assert.equal(await db.workLedgerEntry.count({ where: { facultyId: id } }), 0);
    const override = await setDailyAttendance({ ...input, role: "admin", facultyId: id, amount: 375 }, db);
    assert.equal(Number(override.entry.amount), 375);
    const paid = await db.weeklyFacultyPaymentRecord.create({ data: { weekStart: week.start, weekEnd: week.end, totalAmount: 375, paidAmount: 375, pendingAmount: 0, status: "PAID" } });
    weeklyId = paid.id;
    await assert.rejects(setDailyAttendance({ ...input, role: "admin", facultyId: id, present: false }, db), { status: 403 });
    assert.equal(Number((await db.workLedgerEntry.findUnique({ where: { id: override.entry.id } })).amount), 375);
    const newFriday = week.deadline.toISOString().slice(0, 10);
    assert.equal(Number((await setDailyAttendance({ ...input, date: newFriday }, db)).entry.amount), 200);
  } finally {
    t.mock.timers.reset();
    if (weeklyId) await db.weeklyFacultyPaymentRecord.delete({ where: { id: weeklyId } });
    await db.workLedgerEntryAudit.deleteMany({ where: { entry: { facultyId: id } } });
    await db.workLedgerEntry.deleteMany({ where: { facultyId: id } });
    await db.faculty.deleteMany({ where: { id } });
    await db.$disconnect();
  }
});
