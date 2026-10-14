import test from "node:test";
import assert from "node:assert/strict";
import { readStudentTimeline } from "../services/staffTimelineService.js";
import { exportStaffStudents } from "../services/staffPortalService.js";

const at = value => new Date(`2026-09-${value}T10:00:00.000Z`);
function fixture() {
  const notes = [{ id: "note2", note: "Parent response\nFull note", createdAt: at("12"), staff: { name: "Staff One" } }, { id: "note1", note: "Earlier note", createdAt: at("10"), staff: { name: "Staff One" } }];
  const payment = { id: 134, status: "paid", month: "September", academicYear: 2026, amount: 650, paidAt: at("12"), createdAt: at("11"), paymentProvider: "CASH", gatewayOrders: [], teacherAdmin: null };
  function matches(row, where) {
    if (!where.OR) return true;
    return where.OR.some(branch => Object.entries(branch).every(([field, condition]) => field === "id" ? row.id < condition.lt : condition instanceof Date ? +row[field] === +condition : +row[field] < +condition.lt));
  }
  const tx = {
    student: { findUnique: async () => ({ id: 77 }) },
    staffStudentFollowUp: { findMany: async q => { assert.equal(q.where.studentId, 77); return notes.filter(n => matches(n, q.where)).slice(0, q.take); } },
    payment: { findMany: async q => {
      assert.equal(q.where.studentId, 77);
      if (q.select.status) return [payment];
      assert.equal(q.where.status, "paid");
      return q.where.paidAt === null ? [] : matches(payment, q.where) ? [payment] : [];
    } },
    auditLog: { findMany: async q => q.select.entityId ? [{ entityId: "134", actorName: "Staff One" }] : [] },
  };
  const db = { $transaction: async (work, options) => { assert.equal(options.isolationLevel, "RepeatableRead"); return work(tx); } };
  return { db, tx, payment };
}

test("Merged timeline uses actual dates, cash attribution and stable cross-source pagination", async () => {
  const { db } = fixture();
  const first = await readStudentTimeline("77", { limit: 1 }, db);
  assert.equal(first.events[0].type, "payment");
  assert.match(first.events[0].note, /September fees paid.*650.*CASH/);
  assert.match(first.events[0].note, /2026-2027/);
  assert.equal(first.events[0].staff.name, "Staff: Staff One");
  const second = await readStudentTimeline("77", { limit: 1, cursor: first.nextCursor }, db);
  assert.equal(second.events[0].id, "F:note2");
  assert.match(second.events[0].note, /\nFull note/);
  const third = await readStudentTimeline("77", { limit: 1, cursor: second.nextCursor }, db);
  assert.equal(third.events[0].id, "F:note1");
  assert.equal(third.nextCursor, null);
});

test("Timeline rejects malformed or other-student cursors", async () => {
  const { db } = fixture();
  const first = await readStudentTimeline("77", { limit: 1 }, db);
  await assert.rejects(readStudentTimeline("78", { cursor: first.nextCursor }, db), { status: 400 });
  await assert.rejects(readStudentTimeline("77", { cursor: "invalid" }, db), { status: 400 });
});

test("Historical cash audit is not represented as currently paid", async () => {
  const { db, tx } = fixture();
  tx.payment.findMany = async () => [];
  tx.auditLog.findMany = async q => q.select.entityId ? [] : [{ id: "audit", action: "STAFF_CASH_PAYMENT_RECORDED", actorType: "STAFF", actorName: "Staff One", createdAt: at("13"), metadataJson: { studentId: 77, month: "September", academicYear: 2026, amount: 650, method: "CASH" } }];
  const result = await readStudentTimeline("77", {}, db);
  assert.equal(result.events[0].type, "payment-history");
  assert.match(result.events[0].note, /no longer currently paid/);
});

test("Staff export uses list filters without pagination and exposes only permitted columns", async () => {
  const tx = { student: { findMany: async q => {
    assert.equal(q.skip, undefined); assert.equal(q.take, undefined);
    assert.equal(q.where.class, "8"); assert.equal(q.where.payments.none.month, "September");
    assert.equal(q.select.password, undefined); assert.equal(q.select.staffFollowUps, undefined);
    return Array.from({ length: 45 }, (_, id) => ({ id: id + 1, name: "Student", class: "8", phone: "contact", payments: [] }));
  } } };
  const db = { $transaction: work => work(tx) };
  const report = await exportStaffStudents({ class: "8", month: "September", academicYear: 2026, status: "unpaid", page: 3 }, db);
  assert.equal(report.count, 45); assert.equal(report.students.length, 45);
  assert.equal(report.students[0].paymentStatus, "Unpaid");
  await assert.rejects(exportStaffStudents({ batch: "unsupported" }, db), { status: 400 });
});

test("Timeline is Staff/Admin-only; export is Staff-only and unauthenticated reads fail", async () => {
  const { default: router } = await import("../routes/staffroute.js");
  const timeline = router.stack.find(layer => layer.route?.path === "/students/:studentId/timeline").route;
  const report = router.stack.find(layer => layer.route?.path === "/students/export").route;
  const response = () => ({ code: 0, status(code) { this.code = code; return this; }, json() { return this; } });
  for (const role of ["staff", "admin", "student", "faculty"]) {
    const res = response(); let allowed = false;
    timeline.stack[1].handle({ userRole: role }, res, () => { allowed = true; });
    assert.equal(allowed, ["staff", "admin"].includes(role));
    if (!allowed) assert.equal(res.code, 403);
    const exportRes = response(); let exportAllowed = false;
    report.stack[1].handle({ userRole: role }, exportRes, () => { exportAllowed = true; });
    assert.equal(exportAllowed, role === "staff");
  }
  for (const route of [timeline, report]) {
    const res = response();
    await route.stack[0].handle({ headers: {} }, res, () => assert.fail("Must require authentication"));
    assert.equal(res.code, 401);
  }
});
