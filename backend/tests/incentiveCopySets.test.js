import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { saveCopySet, listCopySets, validateCopySet, withIncentiveOperationLock } from "../services/incentiveCopySetService.js";

function fixture() {
  const entries = [], leases = new Map();
  const type = { id: "copies", name: "Copies", rate: 100, isActive: true };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => value?.gt ? row[key] > value.gt : row[key] === value);
  let queue = Promise.resolve();
  const db = {
    entries, type, leases, $queryRaw: async () => [],
    faculty: { findUnique: async ({ where }) => ({ id: where.id }) },
    facultyOnlineClass: { findFirst: async () => null },
    extraIncentiveType: { findFirst: async ({ where }) => where.id === type.id ? type : null },
    facultyExtraIncentiveOperationLock: {
      findUnique: async ({ where }) => leases.get(where.facultyId),
      upsert: async ({ create }) => leases.set(create.facultyId, { ...create }),
      updateMany: async ({ where, data }) => { const lease = leases.get(where.facultyId); if (!lease || !matches(lease, where)) return { count: 0 }; Object.assign(lease, data); return { count: 1 }; },
    },
    facultyExtraIncentiveEntry: {
      findUnique: async ({ where }) => { const entry = entries.find(e => e.id === where.id); return entry ? { ...entry, incentiveType: type } : null; },
      findMany: async ({ where, skip = 0, take }) => entries.filter(e => matches(e, where)).slice(skip, skip + take).map(e => ({ ...e, incentiveType: type })),
      count: async ({ where }) => entries.filter(e => matches(e, where)).length,
      create: async ({ data }) => { const entry = { ...data, paymentRecordId: null, createdAt: new Date(), updatedAt: new Date(), incentiveType: { ...type } }; entries.push(entry); return entry; },
      update: async ({ where, data }) => { const row = entries.find(e => e.id === where.id); Object.assign(row, data, { updatedAt: new Date(+row.updatedAt + 1) }); return { ...row, incentiveType: type }; },
    },
    $transaction: work => { const result = queue.then(() => work(db)); queue = result.catch(() => {}); return result; },
  };
  return db;
}
const body = (quantity = 2, remark = "Parent discussion") => ({ quantity, remark, requestId: randomUUID() });

test("separate sets, idempotent retries, snapshot-preserving edits and paid history", async () => {
  const db = fixture(), first = body(), second = body(3, "Another set");
  const one = await saveCopySet("faculty", "copies", first, null, db);
  await saveCopySet("faculty", "copies", second, null, db);
  await saveCopySet("faculty", "copies", first, null, db);
  assert.equal(db.entries.length, 2);
  assert.equal(db.entries.reduce((sum, e) => sum + e.quantityChange, 0), 5);
  assert.equal(db.entries.reduce((sum, e) => sum + e.amountSnapshot, 0), 500);
  db.type.rate = 300;
  const edit = { quantity: 4, remark: "Updated remark", expectedUpdatedAt: one.entry.updatedAt.toISOString() };
  const changed = await saveCopySet("faculty", "copies", edit, one.entry.id, db);
  assert.equal(changed.entry.rate, 100); assert.equal(changed.entry.amount, 400);
  assert.equal(db.entries[1].quantityChange, 3); assert.equal(db.entries[1].note, second.remark);
  assert.equal(changed.entry.createdAt.getTime(), one.entry.createdAt.getTime());
  await assert.rejects(saveCopySet("faculty", "copies", { ...edit, quantity: 5 }, one.entry.id, db), { status: 409 });
  db.entries[0].status = "PAID"; db.entries[0].paymentRecordId = "payment";
  const paid = structuredClone(db.entries[0]);
  await assert.rejects(saveCopySet("faculty", "copies", edit, one.entry.id, db), { status: 409 });
  assert.deepEqual(db.entries[0], paid);
  const history = await listCopySets("faculty", "copies", 1, db);
  assert.equal(history.entries[0].editable, false); assert.equal(history.entries[0].note, "Updated remark");
});

test("positive integer validation, ownership, online-workflow exclusion and complete pagination", async () => {
  const db = fixture(), entry = await saveCopySet("faculty", "copies", body(), null, db);
  for (const quantity of [0, -1, 1.1, "2", Infinity, 2147483648]) assert.throws(() => validateCopySet({ quantity }), { status: 400 });
  assert.throws(() => validateCopySet({ quantity: 1, remark: "x".repeat(2001) }), { status: 400 });
  await assert.rejects(saveCopySet("another-faculty", "copies", { quantity: 1, expectedUpdatedAt: entry.entry.updatedAt.toISOString() }, entry.entry.id, db), { status: 404 });
  db.type.name = "ONLINE DOUBT CLASS";
  await assert.rejects(saveCopySet("faculty", "copies", body(), null, db), { status: 403 });
  db.type.name = "Copies";
  for (let i = 0; i < 21; i++) await saveCopySet("faculty", "copies", body(1), null, db);
  assert.equal((await listCopySets("faculty", "copies", 1, db)).entries.length, 20);
  assert.equal((await listCopySets("faculty", "copies", 2, db)).entries.length, 2);
  assert.equal((await listCopySets("another-faculty", "copies", 1, db)).entries.length, 0);
});

test("simultaneous retries create one set and a later replay is idempotent", async () => {
  const db = fixture(), request = body();
  const results = await Promise.allSettled([saveCopySet("faculty", "copies", request, null, db), saveCopySet("faculty", "copies", request, null, db)]);
  assert.equal(db.entries.length, 1);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409);
  await saveCopySet("faculty", "copies", request, null, db);
  assert.equal(db.entries.length, 1);
});

test("edit/payment race is serialized through the external phase; lease release cannot unlock another operation", async () => {
  const db = fixture();
  const entry = await saveCopySet("faculty", "copies", body(), null, db);
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const payment = withIncentiveOperationLock("faculty", async guard => {
    entered(); await new Promise(resolve => { release = resolve; });
    await db.$transaction(async tx => { await guard(tx); db.entries[0].status = "PAID"; db.entries[0].paymentRecordId = "payment"; });
  }, db);
  await ready;
  await assert.rejects(saveCopySet("faculty", "copies", { quantity: 3, expectedUpdatedAt: entry.entry.updatedAt.toISOString() }, entry.entry.id, db), { status: 409 });
  release(); await payment;
  await assert.rejects(saveCopySet("faculty", "copies", { quantity: 3, expectedUpdatedAt: entry.entry.updatedAt.toISOString() }, entry.entry.id, db), { status: 409 });
  await withIncentiveOperationLock("faculty", async () => { db.leases.set("faculty", { facultyId: "faculty", leaseId: "replacement", expiresAt: new Date(Date.now() + 60000) }); }, db);
  assert.ok(db.leases.get("faculty").expiresAt > new Date());
});

test("copy endpoints retain authentication and faculty/admin role restrictions", async () => {
  const { default: router } = await import("../routes/facultyextraincentiveroute.js");
  for (const layer of router.stack.filter(layer => layer.route?.path.includes("/sets"))) {
    assert.equal(layer.route.stack[0].handle.name, "protect");
    const allowed = layer.route.path.startsWith("/admin/") ? "admin" : "faculty";
    for (const role of ["faculty", "admin", "student", "staff"].filter(role => role !== allowed)) {
      const res = { status(code) { this.code = code; return this; }, json() { return this; } };
      layer.route.stack[1].handle({ user: { id: "test" }, userRole: role }, res, () => assert.fail("Wrong role allowed"));
      assert.equal(res.code, 403);
    }
  }
});
