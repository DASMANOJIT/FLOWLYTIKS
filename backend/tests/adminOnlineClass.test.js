import test from "node:test";
import assert from "node:assert/strict";
import { currentOnlineClassWeek, directoryName, getOnlineClassSummary, resolveClassDirectory, saveDirectoryItem, listOnlineClassDirectory, deleteOnlineClassBatch } from "../services/adminOnlineClassService.js";
import { listOnlineClasses } from "../services/facultyOnlineClassService.js";

test("online summary uses Friday midnight through Thursday in IST and actual verified completion", async () => {
  assert.equal(currentOnlineClassWeek(new Date("2026-10-08T18:29:59.999Z")).start.toISOString(), "2026-10-01T18:30:00.000Z");
  const now = new Date("2026-10-08T18:30:00Z");
  const calls = [];
  const db = { facultyOnlineClass: { count: async query => { calls.push(query); return calls.length; } }, $transaction: queries => Promise.all(queries) };
  const summary = await getOnlineClassSummary(db, now);
  assert.equal(summary.weekStart.toISOString(), "2026-10-08T18:30:00.000Z");
  assert.equal(summary.weekEnd.toISOString(), "2026-10-15T18:29:59.999Z");
  assert.equal(calls[0].where.status, "LIVE"); assert.equal(calls[0].where.actualEndAt, null);
  assert.deepEqual(calls[0].where.conferenceName, { not: null });
  assert.equal(calls[2].where.verificationStatus, "VERIFIED");
  assert.deepEqual(calls[2].where.actualEndAt, { gte: summary.weekStart, lt: new Date("2026-10-15T18:30:00Z"), lte: now });
  assert.ok(calls.every(query => query.where.deletedAt === null));
  const failed = { ...db, facultyOnlineClass: { count: async () => { throw new Error("DB unavailable"); } } };
  await assert.rejects(getOnlineClassSummary(failed), /DB unavailable/);
});

test("directory names normalize duplicates and selection cannot spoof names or associations", async () => {
  assert.deepEqual(directoryName("  Batch   A  "), { name: "Batch A", normalizedName: "batch a" });
  assert.throws(() => directoryName(" "));
  const batch = { id: "batch", name: "Batch A", isActive: true };
  const tx = { $queryRaw: async () => [batch] };
  assert.deepEqual(await resolveClassDirectory({ batchIds: ["batch"], batchName: "spoofed" }, null, tx), { batchName: "Batch A", className: "", batches: { create: [{ batchId: "batch", nameSnapshot: "Batch A" }] } });
  for (const batchIds of [[], ["batch", "batch"], ["missing", "batch"], [42]]) await assert.rejects(resolveClassDirectory({ batchIds }, null, tx));
  batch.isActive = false;
  await assert.rejects(resolveClassDirectory({ batchIds: ["batch"] }, null, tx), /inactive/);
  batch.isActive = true;
  const old = { batchName: "Legacy", className: "8", batches: [{ batchId: "batch", nameSnapshot: "Previous name" }] };
  const updated = await resolveClassDirectory({ batchIds: ["batch"] }, old, tx);
  assert.equal(updated.batches.create[0].nameSnapshot, "Previous name");
  assert.equal(updated.className, undefined); assert.equal(updated.batchName, undefined);
  await assert.rejects(resolveClassDirectory({}, old, tx), /active batch/);
  const db = { $transaction: async work => work({ onlineClassBatch: { create: async () => { throw Object.assign(new Error(), { code: "P2002" }); } } }) };
  await assert.rejects(saveDirectoryItem("batch", null, { name: "Batch A" }, db), { status: 409 });
});

test("admin complete-history filters combine faculty, date, batch and saved status", async () => {
  const calls = [];
  const db = { onlineClassBatch: { findMany: async () => [] }, facultyOnlineClass: { findMany: async query => { calls.push(query); return []; }, count: async () => 0 } };
  await listOnlineClasses({ facultyId: "one", page: 2, historyFilters: true, search: "JAVA", date: "2026-10-12", batch: "Batch A", status: "LIVE" }, db);
  assert.equal(calls[0].where.facultyId, "one"); assert.equal(calls[0].where.status, "LIVE"); assert.equal(calls[0].skip, 20);
  await assert.rejects(listOnlineClasses({ status: "MANUAL_PAID" }, db), { status: 400 });
});

test("every new Admin endpoint rejects unauthenticated and non-admin accounts", async () => {
  const { default: router } = await import("../routes/facultyextraincentiveroute.js");
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const paths = ["/admin/online-class-summary", "/admin/online-classes", "/admin/online-class-directory/:kind", "/admin/online-class-directory/:kind/:id", "/admin/online-class-directory/batch/:id", "/admin/online-classes/:id", "/admin/online-classes/:id/:action"];
  for (const layer of router.stack.filter(layer => paths.includes(layer.route?.path))) {
    const route = layer.route;
    const res = response(); await route.stack[0].handle({ headers: {} }, res, () => assert.fail("Unauthenticated access")); assert.equal(res.statusCode, 401);
    for (const userRole of ["faculty", "staff", "student"]) {
      const denied = response(); route.stack[1].handle({ user: { id: "test" }, userRole }, denied, () => assert.fail("Role bypass")); assert.equal(denied.statusCode, 403);
    }
  }
  const directory = router.stack.find(layer => layer.route?.path === "/online-class-directory").route;
  for (const userRole of ["staff", "student"]) {
    const denied = response(); directory.stack[1].handle({ user: { id: "test" }, userRole }, denied, () => assert.fail()); assert.equal(denied.statusCode, 403);
  }
});

test("batch search queries the complete active directory; deletion changes availability only", async () => {
  let query, update;
  const db = { onlineClassBatch: {
    findMany: async args => { query = args; return [{ id: "batch", name: "ICSE CLASS 8", isActive: true }]; },
    update: async args => { update = args; return { id: "batch", name: "ICSE CLASS 8", isActive: false }; },
  } };
  assert.deepEqual(await listOnlineClassDirectory(false, db, "   "), []); assert.equal(query, undefined);
  await listOnlineClassDirectory(false, db, "  icse CLASS 8  ");
  assert.deepEqual(query.where, { isActive: true, name: { contains: "icse CLASS 8", mode: "insensitive" } });
  assert.equal(query.take, undefined); assert.equal(query.select.grades, undefined);
  const result = await deleteOnlineClassBatch("batch", db);
  assert.equal(result.name, "ICSE CLASS 8"); assert.deepEqual(update.data, { isActive: false });
  await assert.rejects(deleteOnlineClassBatch("../invalid", db), { status: 400 });
  await assert.rejects(deleteOnlineClassBatch("missing", { onlineClassBatch: { update: async () => { throw Object.assign(new Error(), { code: "P2025" }); } } }), { status: 404 });
});
