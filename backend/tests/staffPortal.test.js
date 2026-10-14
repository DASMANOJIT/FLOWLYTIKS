import test from "node:test";
import assert from "node:assert/strict";
const { staffStudentCriteria, readStaffStudents, readStaffActivity } = await import("../services/staffPortalService.js");

test("Staff filters preserve March-February sessions and reject invalid values", () => {
  const january = staffStudentCriteria({ month: "January", academicYear: "2026", search: "77", page: "2", pageSize: "10" });
  assert.equal(january.paid.academicYear, 2026);
  assert.equal(january.paid.month, "January");
  assert.equal(january.where.OR.at(-1).id, 77);
  for (const query of [{ month: "Unknown" }, { page: "0" }, { pageSize: "101" }, { academicYear: "bad" }, { status: "processing" }]) assert.throws(() => staffStudentCriteria(query), { status: 400 });
});

test("Staff counts and paginated students share class/search/period filters", async () => {
  const calls = [];
  const tx = { student: {
    count: async ({ where }) => { calls.push(where); return where.payments ? 2 : 5; },
    findMany: async (query) => {
      if (query.distinct) return [{ class: "8" }];
      assert.equal(query.skip, 10); assert.equal(query.take, 10);
      assert.equal(query.where.payments.none.month, "June");
      assert.equal(query.select.password, undefined); assert.equal(query.select.email, undefined);
      return [{ id: 77, name: "Test", class: "8", phone: "contact", monthlyFee: 600, payments: [] }];
    },
  } };
  const db = { $transaction: async (work, options) => { assert.equal(options.isolationLevel, "RepeatableRead"); return work(tx); } };
  const result = await readStaffStudents({ month: "June", academicYear: "2026", class: "8", search: "Test", status: "unpaid", page: "2", pageSize: "10" }, db);
  assert.deepEqual(result.summary, { totalStudents: 5, paidStudents: 2, unpaidStudents: 3 });
  assert.equal(result.pagination.total, 3);
  assert.equal(result.students[0].paymentStatus, "Unpaid");
  assert.equal(result.students[0].payments, undefined);
  assert.equal(calls[0].class, calls[1].class);
  assert.deepEqual(calls[0].OR, calls[1].OR);
});

test("Staff database failures propagate instead of returning empty results", async () => {
  await assert.rejects(readStaffStudents({}, { $transaction: async () => { throw new Error("Unavailable"); } }), /Unavailable/);
});

test("Staff activity is limited to its own actor and safe fields", async () => {
  await readStaffActivity("staff-one", { auditLog: { findMany: async (query) => {
    assert.deepEqual(query.where, { actorType: "STAFF", actorId: "staff-one" });
    assert.deepEqual(Object.keys(query.select).sort(), ["action", "createdAt", "id"]);
    return [];
  } } });
});
