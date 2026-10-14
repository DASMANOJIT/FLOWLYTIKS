import test from "node:test";
import assert from "node:assert/strict";
import { overviewFilters, readAdminStaffMembers, readAdminFollowUps, readAdminCashCollections, readAdminStaffActivity, readAdminEnquiries } from "../services/adminStaffOverviewService.js";

test("Admin overview validates pagination, IDs, dates and per-tab statuses", () => {
  const f = overviewFilters({ from: "2026-10-09", to: "2026-10-09", page: "2", pageSize: "10", staffId: "cmstaffmember123" });
  assert.equal(f.skip, 10); assert.equal(f.createdAt.gte.toISOString(), "2026-10-08T18:30:00.000Z");
  assert.equal(f.createdAt.lt.toISOString(), "2026-10-09T18:30:00.000Z");
  for (const query of [{ from: "2026-02-30" }, { from: "2026-10-10", to: "2026-10-09" }, { page: "NaN" }, { pageSize: "101" }, { staffId: "invalid" }, { status: "invented" }]) assert.throws(() => overviewFilters(query), { status: 400 });
});
test("Members and follow-ups use identical count/page criteria and safe related fields", async () => {
  let countWhere;
  const model = {
    count: async q => { countWhere = q.where; return 3; },
    findMany: async q => { assert.deepEqual(q.where, countWhere); assert.deepEqual(q.orderBy, [{ createdAt: "desc" }, { id: "desc" }]); assert.equal(q.skip, 2); assert.equal(q.take, 2); assert.equal(q.select.passwordHash, undefined); return []; },
  };
  const db = { $transaction: work => work({ staff: model, staffStudentFollowUp: model }) };
  const members = await readAdminStaffMembers({ search: "Staff", status: "active", page: "2", pageSize: "2" }, db);
  assert.equal(countWhere.isActive, true); assert.equal(members.pagination.total, 3);
  const notes = await readAdminFollowUps({ staffId: "cmstaffmember123", search: "77", page: "2", pageSize: "2" }, db);
  assert.equal(countWhere.staffId, "cmstaffmember123"); assert.ok(countWhere.OR.some(term => term.studentId === 77));
  assert.equal(notes.unavailableFields.length, 3);
});
test("Cash/activity joins filter and paginate on the server without exposing raw audit payloads", async () => {
  const calls = [];
  const db = { $transaction: work => work({ $queryRaw: async query => { calls.push(query); return query.text.includes("count(*)") ? [{ total: 4 }] : []; } }) };
  await readAdminCashCollections({ staffId: "cmstaffmember123", search: "A_%'", status: "reversed", page: "2" }, db);
  assert.ok(calls.every(q => q.values.includes("cmstaffmember123") && q.values.includes("reversed")));
  assert.ok(calls[1].text.includes('ORDER BY "createdAt" DESC, "id" DESC'));
  assert.ok(calls[1].text.includes("STAFF_CASH_PAYMENT_RECORDED"));
  assert.ok(calls[1].text.includes("PAYMENT_REVERSED"));
  assert.equal(calls[1].values.at(-1), 20);
  assert.ok(!calls[1].text.includes("passwordHash")); assert.ok(!calls[1].text.includes('a."metadataJson",'));
  calls.length = 0;
  await readAdminStaffActivity({ action: "FOLLOW_UP_ADDED" }, db);
  assert.ok(calls[1].text.includes("UNION ALL")); assert.ok(calls[1].text.includes('"StaffStudentFollowUp"'));
  assert.ok(calls[1].values.includes("FOLLOW_UP_ADDED"));
});
test("Database failures remain errors and enquiries explicitly report missing persistence", async () => {
  await assert.rejects(readAdminStaffMembers({}, { $transaction: async () => { throw new Error("DB unavailable"); } }), /DB unavailable/);
  assert.equal(readAdminEnquiries({}).available, false); assert.equal(readAdminEnquiries({}).rows, undefined);
});
test("Every Admin oversight endpoint requires authentication and rejects Staff, Student and Faculty", async () => {
  const { default: router } = await import("../routes/staffroute.js");
  const response = () => ({ code: 0, status(code) { this.code = code; return this; }, json() { return this; } });
  for (const path of ["options", "members", "follow-ups", "cash-collections", "activity", "enquiries"]) {
    const route = router.stack.find(layer => layer.route?.path === `/admin/${path}`).route;
    for (const role of ["admin", "staff", "student", "faculty"]) {
      let allowed = false; const res = response();
      route.stack[1].handle({ user: { id: "test-actor" }, userRole: role }, res, () => { allowed = true; });
      assert.equal(allowed, role === "admin"); if (!allowed) assert.equal(res.code, 403);
    }
    const res = response();
    await route.stack[0].handle({ headers: {} }, res, () => assert.fail("Must require authentication"));
    assert.equal(res.code, 401);
  }
});
