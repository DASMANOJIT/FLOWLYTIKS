import test from "node:test";
import assert from "node:assert/strict";

const types = [{ id: "type-one", name: "Regular Incentive", rate: 100, isActive: true }, { id: "type-two", name: "Mock Test Bonus", rate: 200, isActive: true }];
let entries = [];
let sequence = Promise.resolve();
let lease;
const db = {
  $queryRaw: async () => [],
  faculty: { findUnique: async ({ where }) => ({ id: where.id }) },
  facultyExtraIncentiveOperationLock: {
    findUnique: async () => lease ? { ...lease } : null,
    upsert: async ({ create }) => { lease = { ...create }; },
    updateMany: async ({ where, data }) => { if (lease?.leaseId !== where.leaseId) return { count: 0 }; Object.assign(lease, data); return { count: 1 }; },
  },
  facultyOnlineClass: { findFirst: async () => null },
  extraIncentiveType: { findFirst: async ({ where }) => types.find(type => type.id === where.id && type.isActive) || null, findMany: async () => types },
  facultyExtraIncentiveEntry: {
    findMany: async ({ where, take }) => entries.filter(entry => Object.entries(where).every(([key, value]) => entry[key] === value)).slice(0, take),
    create: async ({ data }) => { const entry = { ...data, id: `entry-${entries.length}`, incentiveType: types.find(type => type.id === data.incentiveTypeId), createdAt: new Date() }; entries.push(entry); return entry; },
  },
  facultyExtraIncentivePayment: { findMany: async () => [] },
  auditLog: { create: async ({ data }) => data },
  $transaction: (work, options) => {
    if (options) assert.equal(options.isolationLevel, "Serializable");
    const next = sequence.then(() => work(db)); sequence = next.catch(() => {}); return next;
  },
};
globalThis.__flowlytiksPrisma = db;
const { adjustMyIncentive, getMyIncentives } = await import("../controllers/facultyextraincentivecontrollers.js");
const { default: routes } = await import("../routes/facultyextraincentiveroute.js");
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = (count, expected, typeId = "type-one") => ({ method: "PATCH", userRole: "faculty", user: { id: "faculty-one", fullName: "Test Faculty" }, params: { incentiveTypeId: typeId }, body: { pendingCount: count, expectedPendingCount: expected, facultyId: "other-faculty" } });
const seed = (quantityChange, rateSnapshot, status = "PENDING", facultyId = "faculty-one", incentiveTypeId = "type-one") => ({ id: `seed-${entries.length}`, facultyId, incentiveTypeId, quantityChange, rateSnapshot, amountSnapshot: quantityChange * rateSnapshot, status, incentiveType: types.find(type => type.id === incentiveTypeId), createdAt: new Date() });

test("count edits append differences, preserve paid history and reject stale edits", async () => {
  entries = [seed(2, 100), seed(5, 100, "PAID"), seed(7, 100, "PENDING", "other-faculty")];
  const history = structuredClone(entries);
  for (const type of types) {
    const res = response();
    await adjustMyIncentive(request(type.id === "type-one" ? 4 : 2, type.id === "type-one" ? 2 : 0, type.id), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.entry.quantityChange, 2);
    assert.equal(res.body.entry.facultyId, "faculty-one");
    assert.equal(res.body.entry.amountSnapshot, type.rate * 2);
  }
  const size = entries.length;
  const duplicate = response(); await adjustMyIncentive(request(4, 2), duplicate);
  assert.equal(duplicate.statusCode, 200); assert.equal(duplicate.body.entry, null); assert.equal(entries.length, size);
  const stale = response(); await adjustMyIncentive(request(3, 2), stale); assert.equal(stale.statusCode, 409);
  const zero = response(); await adjustMyIncentive(request(0, 4), zero);
  assert.equal(zero.body.entry.quantityChange, -4); assert.equal(zero.body.entry.amountSnapshot, -400);
  assert.deepEqual(entries.slice(0, 3), history);
});

test("reductions retain historical snapshot value after a configured rate change", async () => {
  entries = [seed(2, 100)]; types[0].rate = 300;
  const increase = response(); await adjustMyIncentive(request(3, 2), increase);
  assert.equal(increase.body.entry.amountSnapshot, 300);
  const decrease = response(); await adjustMyIncentive(request(1, 3), decrease);
  assert.equal(decrease.body.entry.amountSnapshot, -333.33);
  assert.equal(entries[0].rateSnapshot, 100); types[0].rate = 100;
});

test("whole-number validation, authorization, missing types and transaction conflicts", async () => {
  for (const invalid of [-1, 1.5, "2", null, undefined, Infinity, 2147483648]) {
    const res = response(); await adjustMyIncentive(request(invalid, 0), res); assert.equal(res.statusCode, 400);
  }
  for (const userRole of ["admin", "staff", "student", undefined]) {
    const res = response(); await adjustMyIncentive({ ...request(1, 0), userRole }, res); assert.equal(res.statusCode, 403);
  }
  const missing = response(); await adjustMyIncentive(request(1, 0, "missing"), missing); assert.equal(missing.statusCode, 404);
  const original = db.$transaction; db.$transaction = async () => { throw Object.assign(new Error("Conflict"), { code: "P2034" }); };
  try { const res = response(); await adjustMyIncentive(request(1, 0), res); assert.equal(res.statusCode, 409); }
  finally { db.$transaction = original; }
  const route = routes.stack.find(layer => layer.route?.path === "/my/:incentiveTypeId/pending-count").route;
  assert.equal(route.methods.patch, true); assert.equal(route.stack[0].handle.name, "protect");
});

test("pending totals include entries beyond the recent history limit", async () => {
  entries = Array.from({ length: 205 }, () => seed(1, 100));
  const res = response(); await getMyIncentives({ user: { id: "faculty-one" } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.entries.length, 200);
  assert.equal(res.body.pendingSummary[0].quantity, 205); assert.equal(res.body.pendingSummary[0].amount, 20500);
});

test("online doubt class manual count, increment and decrement are blocked", async () => {
  types[0].name = "ONLINE DOUBT CLASS";
  const before = structuredClone(entries);
  try {
    for (const method of ["PATCH", "POST"]) {
      const res = response(); await adjustMyIncentive({ ...request(1, 0), method }, res);
      assert.equal(res.statusCode, 403);
    }
    assert.deepEqual(entries, before);
  } finally { types[0].name = "Regular Incentive"; }
});

test("online-class routes retain authentication and role isolation", async () => {
  for (const layer of routes.stack.filter(layer => layer.route?.path.includes("online-classes"))) {
    const { route } = layer;
    assert.equal(route.stack[0].handle.name, "protect");
    const unauthenticated = response();
    await route.stack[0].handle({ headers: {}, originalUrl: `/api/faculty-extra-incentives${route.path}` }, unauthenticated, () => assert.fail("Unauthenticated access"));
    assert.equal(unauthenticated.statusCode, 401);
    const allowed = route.path.endsWith("attendance.pdf") ? ["admin", "faculty"] : [route.path.startsWith("/admin/") ? "admin" : "faculty"];
    for (const role of ["admin", "faculty", "staff", "student"].filter(role => !allowed.includes(role))) {
      const res = response(); route.stack[1].handle({ user: { id: "role-test" }, userRole: role }, res, () => assert.fail("Wrong role allowed"));
      assert.equal(res.statusCode, 403);
    }
  }
});
