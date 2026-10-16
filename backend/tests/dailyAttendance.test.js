import test from "node:test";
import assert from "node:assert/strict";
import { attendanceDateKey, attendanceWeek, dailyAttendanceRate, assertAttendanceDeadline, setDailyAttendance, assertAttendanceMutable } from "../services/dailyAttendanceService.js";
import { workLedgerAttendancePatchSchema, workLedgerBodySchema } from "../validation/workLedgerSchemas.js";

const actor = { updatedBy: "faculty:test", updatedByRole: "FACULTY", updatedByName: "Test Faculty" };
const input = { role: "faculty", actorId: "faculty-test", date: "2077-10-09", shift: "MORNING", present: true, actor };
function database(initial = []) {
  const entries = [...initial], audits = [], payrollUpdates = [];
  let chain = Promise.resolve();
  const tx = {
    $executeRaw: async () => {},
    faculty: { findUnique: async () => ({ id: "faculty-test" }) },
    payrollCycle: { findFirst: async () => null },
    facultyPayout: { findFirst: async () => null },
    weeklyFacultyPaymentRecord: { findFirst: async () => null },
    facultyEarningsPayroll: { updateMany: async query => { payrollUpdates.push(query); return { count: 0 }; } },
    workLedgerEntryAudit: { create: async query => { audits.push(query.data); } },
    workLedgerEntry: {
      findMany: async ({ where }) => entries.filter(entry => entry.facultyId === where.facultyId && (where.date instanceof Date ? entry.date.getTime() === where.date.getTime() : entry.date >= where.date.gte && entry.date <= where.date.lte)),
      create: async ({ data }) => { const entry = { ...data, id: "entry-" + entries.length }; entries.push(entry); return entry; },
      delete: async ({ where }) => { entries.splice(entries.findIndex(entry => entry.id === where.id), 1); },
    },
  };
  return { entries, audits, payrollUpdates, tx, $transaction: work => {
    const result = chain.then(() => work(tx));
    chain = result.catch(() => {});
    return result;
  } };
}

test("daily rate follows the attendance calendar date in Kolkata", () => {
  assert.equal(dailyAttendanceRate("2026-10-09"), 200);
  assert.equal(dailyAttendanceRate("2026-10-10"), 400);
  assert.equal(dailyAttendanceRate("2026-10-11"), 400);
  assert.equal(dailyAttendanceRate("2026-10-12"), 200);
  assert.equal(attendanceDateKey("2026-10-09T19:00:00Z"), "2026-10-10");
  assert.equal(dailyAttendanceRate("2026-10-09T19:00:00Z"), 400);
  assert.throws(() => attendanceDateKey("2026-02-31"), { status: 400 });
  assert.equal(workLedgerBodySchema.safeParse({ facultyId: "faculty-test", date: "2026-02-31" }).success, false);
});

test("Friday-Thursday deadline is exactly following Friday noon IST", () => {
  const week = attendanceWeek("2026-10-15");
  assert.equal(attendanceDateKey(week.start), "2026-10-09");
  assert.equal(attendanceDateKey(week.end), "2026-10-15");
  assert.equal(week.deadline.toISOString(), "2026-10-16T06:30:00.000Z");
  assert.doesNotThrow(() => assertAttendanceDeadline("faculty", "2026-10-15", new Date("2026-10-16T06:29:59.999Z")));
  assert.throws(() => assertAttendanceDeadline("faculty", "2026-10-15", new Date("2026-10-16T06:30:00Z")), { status: 403 });
  assert.throws(() => assertAttendanceDeadline("faculty", "2026-10-08", new Date("2026-10-16T00:00:00Z")), { status: 403 });
  assert.doesNotThrow(() => assertAttendanceDeadline("admin", "2026-10-15", new Date("2026-10-16T06:30:00Z")));
  assert.equal(attendanceDateKey(attendanceWeek("2026-10-08T18:30:00Z").start), "2026-10-09");
});

test("faculty ownership, amounts, required date and roles are enforced", async () => {
  const db = database();
  for (const change of [{ facultyId: "someone-else" }, { amount: 1 }, { date: undefined }, { role: "staff" }, { shift: "DAILY" }, { shift: "AFTERNOON" }, { shift: undefined }]) await assert.rejects(setDailyAttendance({ ...input, ...change }, db), error => [400, 403].includes(error.status));
  assert.equal(db.entries.length, 0);
});

test("concurrent and repeated marking creates one shift entry and retains admin amount", async () => {
  const db = database();
  await Promise.all([setDailyAttendance(input, db), setDailyAttendance(input, db)]);
  assert.equal(db.entries.length, 1);
  assert.equal(db.entries[0].shift, "MORNING");
  assert.equal(db.entries[0].amount, dailyAttendanceRate(input.date));
  db.entries[0].amount = 375;
  db.entries[0].updatedByRole = "ADMIN";
  await setDailyAttendance(input, db);
  assert.equal(db.entries[0].amount, 375);
  assert.equal(db.entries[0].updatedByRole, "ADMIN");
  assert.equal(db.audits.filter(audit => audit.action === "CREATE").length, 1);
});

test("legacy Morning amount is retained while Evening can be marked independently", async () => {
  const db = database([{ id: "legacy", facultyId: input.actorId, date: new Date(input.date + "T00:00:00Z"), shift: "MORNING", amount: 123.45 }]);
  const result = await setDailyAttendance(input, db);
  assert.equal(result.entry.amount, 123.45);
  assert.equal(db.entries.length, 1);
  assert.equal(db.entries[0].amount, 123.45);
  await setDailyAttendance({ ...input, shift: "EVENING" }, db);
  assert.equal(db.entries.length, 2);
  await setDailyAttendance({ ...input, present: false }, db);
  assert.equal(db.entries.length, 1);
  assert.equal(db.entries[0].shift, "EVENING");
  assert.equal(db.audits.find(audit => audit.action === "DELETE").previousData.amount, 123.45);
});

test("historical daily and Afternoon records are never allocated, repriced or doubled", async () => {
  for (const shift of ["DAILY", "AFTERNOON"]) {
    const db = database([{ id: "history", facultyId: input.actorId, date: new Date(input.date + "T00:00:00Z"), shift, amount: 123.45 }]);
    for (const target of ["MORNING", "EVENING"]) for (const present of [true, false]) await assert.rejects(setDailyAttendance({ ...input, shift: target, present }, db), { status: 409 });
    assert.equal(db.entries.length, 1); assert.equal(db.entries[0].amount, 123.45); assert.equal(db.audits.length, 0);
  }
});

test("both shifts sum actual weekday, Friday and weekend amounts and unmark only the requested shift", async () => {
  for (const [date, total] of [["2077-10-08", 400], ["2077-10-09", 800], ["2077-10-10", 800], ["2077-10-11", 400]]) {
    const db = database();
    await Promise.all(["MORNING", "EVENING", "MORNING", "EVENING"].map(shift => setDailyAttendance({ ...input, date, shift }, db)));
    assert.equal(db.entries.length, 2); assert.equal(db.entries.reduce((sum, row) => sum + row.amount, 0), total);
    await setDailyAttendance({ ...input, date, shift: "EVENING", present: false }, db);
    assert.equal(db.entries.length, 1); assert.equal(db.entries[0].shift, "MORNING");
  }
});

test("settled or processing payroll blocks admins too and lock query errors fail closed", async () => {
  for (const model of ["payrollCycle", "facultyPayout", "weeklyFacultyPaymentRecord"]) {
    const db = database();
    db.tx[model].findFirst = async () => ({ id: "settled" });
    await assert.rejects(setDailyAttendance({ ...input, role: "admin", facultyId: input.actorId }, db), { status: 403 });
    assert.equal(db.entries.length, 0);
  }
  const db = database();
  db.tx.payrollCycle.findFirst = async () => { throw new Error("Database unavailable"); };
  await assert.rejects(assertAttendanceMutable(db.tx, "admin", input.actorId, input.date), /Database unavailable/);
});

test("mutation rechecks server time and draft refresh uses actual sums only", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-16T06:29:59Z").getTime() });
  const db = database();
  const recent = { ...input, date: "2026-10-10" };
  await setDailyAttendance(recent, db);
  assert.equal(db.entries[0].amount, 400);
  assert.equal(db.payrollUpdates[0].data.totalAmount, 400);
  assert.deepEqual(db.payrollUpdates[0].where.status.in, ["DRAFT", "PENDING_APPROVAL"]);
  t.mock.timers.setTime(new Date("2026-10-16T06:30:00Z").getTime());
  await assert.rejects(setDailyAttendance({ ...recent, present: false }, db), { status: 403 });
  assert.equal(db.entries.length, 1);
});

test("remarks-only admin patch does not default amount to zero", () => {
  assert.equal(workLedgerAttendancePatchSchema.parse({ remarks: "Reviewed" }).amount, undefined);
});
