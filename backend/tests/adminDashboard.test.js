import test from "node:test";
import assert from "node:assert/strict";
import { dashboardPeriod, readAdminDashboard, readFacultyBilling } from "../services/adminDashboardService.js";
import { adminOnly } from "../middleware/authmiddleware.js";

test("Dashboard follows March-February sessions and the existing Friday UTC week", () => {
  const january = dashboardPeriod({}, new Date("2027-01-01T04:00:00Z"));
  assert.equal(january.month, "January");
  assert.equal(january.academicYear, 2026);
  assert.equal(january.weekStart.toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(january.weekEnd.toISOString(), "2027-01-07T00:00:00.000Z");
  assert.equal(dashboardPeriod({}, new Date("2027-02-28T20:00:00Z")).academicYear, 2027);
  for (const query of [{ month: "All Months" }, { academicYear: "2026oops" }, { academicYear: "" }]) assert.throws(() => dashboardPeriod(query), { status: 400 });
});

test("Complete monthly ledger aggregates exclude pending/reversed/other periods and keep actual amounts", async () => {
  const records = [
    { studentId: 1, month: "June", academicYear: 2026, status: "paid", amount: 600 },
    { studentId: 2, month: "June", academicYear: 2026, status: "paid", amount: 300 },
    { studentId: 3, month: "June", academicYear: 2026, status: "pending", amount: 600 },
    { studentId: 4, month: "June", academicYear: 2026, status: "reversed", amount: 600 },
    { studentId: 5, month: "July", academicYear: 2026, status: "paid", amount: 600 },
    { studentId: 6, month: "June", academicYear: 2025, status: "paid", amount: 600 },
  ];
  const matching = where => records.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  const tx = {
    student: { count: async query => query ? new Set(matching(query.where.payments.some).map(row => row.studentId)).size : 6 },
    faculty: { count: async query => { assert.deepEqual(query, { where: { status: "ACTIVE" } }); return 8; } }, staff: { count: async () => 3 },
    payment: { aggregate: async query => { assert.equal(query.take, undefined); assert.deepEqual(query.where, { month: "June", academicYear: 2026, status: "paid" }); return { _sum: { amount: matching(query.where).reduce((sum, row) => sum + row.amount, 0) } }; } },
  };
  const db = {
    $transaction: async (work, options) => { assert.equal(options.isolationLevel, "RepeatableRead"); return work(tx); },
    facultyExtraIncentiveEntry: { findMany: async query => {
      assert.equal(query.where.createdAt.gte.toISOString(), "2026-10-09T00:00:00.000Z");
      assert.equal(query.where.createdAt.lt.toISOString(), "2026-10-16T00:00:00.000Z");
      assert.equal(query.take, undefined);
      return [
        { facultyId: "one", incentiveTypeId: "a", quantityChange: 2, rateSnapshot: 100, amountSnapshot: 200 },
        { facultyId: "one", incentiveTypeId: "a", quantityChange: -1, rateSnapshot: 100, amountSnapshot: -100 },
        { facultyId: "two", incentiveTypeId: "a", quantityChange: 1, rateSnapshot: 150, amountSnapshot: 150 },
      ];
    } },
  };
  const summary = await readAdminDashboard({ month: "June", academicYear: "2026" }, { db, now: new Date("2026-10-09T10:00:00Z"), weeklyStatus: async (start, end) => { assert.equal(end.toISOString().slice(0, 10), "2026-10-15"); return { pendingAmount: 425 }; } });
  assert.equal(summary.totalStudents, 6); assert.equal(summary.totalFaculties, 8); assert.equal(summary.totalStaff, 3);
  assert.equal(summary.paidStudents, 2); assert.equal(summary.unpaidStudents, 4); assert.equal(summary.paymentReceived, 900);
  assert.equal(summary.week.outstanding, 425); assert.equal(summary.week.extraIncentives, 250);
});

test("Faculty billing includes the total week bill and all-time pending snapshots only", async () => {
  const db = { facultyExtraIncentiveEntry: { findMany: async query => {
    assert.deepEqual(query.where, { status: "PENDING" });
    assert.equal(query.take, undefined);
    return [
      { facultyId: "one", incentiveTypeId: "a", quantityChange: 2, rateSnapshot: 100, amountSnapshot: 200 },
      { facultyId: "one", incentiveTypeId: "a", quantityChange: -1, rateSnapshot: 100, amountSnapshot: -100 },
      { facultyId: "two", incentiveTypeId: "a", quantityChange: 1, rateSnapshot: 150, amountSnapshot: 150 },
    ];
  } } };
  const result = await readFacultyBilling({ db, now: new Date("2026-10-09T10:00:00Z"), weeklyStatus: async (start, end) => {
    assert.equal(start.toISOString().slice(0, 10), "2026-10-09");
    assert.equal(end.toISOString().slice(0, 10), "2026-10-15");
    return { totalAmount: 800, pendingAmount: 300 };
  } });
  assert.equal(result.totalWeeklyAmount, 800);
  assert.equal(result.unpaidExtraIncentives, 250);
});

test("Dashboard does not turn database failures into zero totals", async () => {
  await assert.rejects(readAdminDashboard({}, { db: { $transaction: async () => { throw new Error("Database unavailable"); }, facultyExtraIncentiveEntry: { findMany: async () => [] } }, weeklyStatus: async () => ({ pendingAmount: 0 }) }), /Database unavailable/);
});

test("Admin summary authorization rejects other roles", () => {
  for (const userRole of ["staff", "faculty", "student", undefined]) {
    let status; let continued = false;
    const res = { status: value => { status = value; return res; }, json: () => {} };
    adminOnly({ userRole, user: { id: "fixture" } }, res, () => { continued = true; });
    assert.equal(status, 403); assert.equal(continued, false);
  }
  let allowed = false; adminOnly({ userRole: "admin", user: { id: "fixture" } }, {}, () => { allowed = true; }); assert.equal(allowed, true);
});
