import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import express from "express";
import jwt from "jsonwebtoken";
import pg from "pg";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("copy-set deletion: real routes, retained audit, rollback, pagination and both payout race orders", { skip: process.env.RUN_COPY_SET_POSTGRES_TESTS !== "true", timeout: 30000 }, async t => {
  const url = requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { saveCopySet, deleteCopySet } = await import("../services/incentiveCopySetService.js");
  const { addSession } = await import("../utils/sessionStore.js");
  const blocker = new pg.Client({ connectionString: url }); await blocker.connect();
  let server;
  t.after(async () => { await blocker.query("ROLLBACK"); await blocker.end(); if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect(); });
  const key = randomUUID();
  const makeFaculty = () => { const id = randomUUID(); return db.faculty.create({ data: { facultyId: `SET_${id}`, username: id, phone: id, fullName: "Copy Delete Fixture", passwordHash: "DISABLED", joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } }); };
  const faculty = await makeFaculty(), other = await makeFaculty();
  const type = await db.extraIncentiveType.create({ data: { name: `Copy Delete ${key}`, rate: 75 } });
  const online = await db.extraIncentiveType.create({ data: { name: "ONLINE DOUBT CLASS", rate: 200 } });
  const admin = await db.admin.create({ data: { name: "Delete Fixture Admin", email: `${key}@example.invalid`, password: "DISABLED" } });
  const token = async (role, id) => { const jti = randomUUID(); await addSession(role, id, jti, Date.now() + 600000); return jwt.sign({ role, id, jti }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
  const owner = await token("faculty", faculty.id), stranger = await token("faculty", other.id), administrator = await token("admin", admin.id);
  const app = express(); app.use(express.json()); app.use("/api/faculty-extra-incentives", (await import("../routes/facultyextraincentiveroute.js")).default);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/faculty-extra-incentives`;
  const request = async (path, auth = owner, method = "GET", body) => {
    const response = await fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const create = async (quantity = 1) => (await saveCopySet(faculty.id, type.id, { quantity, remark: "Preserved fixture remark", requestId: randomUUID() })).entry;
  const remove = (entry, auth = owner, typeId = type.id) => request(`/my/${typeId}/sets/${entry.id}`, auth, "DELETE", { expectedUpdatedAt: entry.updatedAt.toISOString() });
  const first = await create(2), second = await create(3);
  assert.equal((await remove(first, null)).status, 401);
  assert.equal((await remove(first, administrator)).status, 403);
  assert.equal((await remove(first, stranger)).status, 404);
  assert.equal((await remove(first)).status, 200);
  assert.equal((await remove(first)).body.alreadyDeleted, true);
  const retained = await db.facultyExtraIncentiveEntry.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(retained.status, "DELETED"); assert.equal(retained.quantityChange, 2); assert.equal(Number(retained.amountSnapshot), 150);
  assert.equal(retained.note, "Preserved fixture remark");
  const audits = await db.auditLog.findMany({ where: { entityId: first.id, action: "EXTRA_INCENTIVE_SET_DELETED" } });
  assert.equal(audits.length, 1); assert.equal(audits[0].metadataJson.amount, 150);
  const summary = (await request("/my")).body.pendingSummary.find(line => line.incentiveTypeId === type.id);
  assert.equal(summary.quantity, 3); assert.equal(summary.amount, 225);
  assert.equal((await request(`/my/${type.id}/sets`)).body.entries.length, 1);
  for (const status of ["PAID", "PROCESSING", "RESERVED", "LOCKED"]) {
    await db.facultyExtraIncentiveEntry.update({ where: { id: second.id }, data: { status } });
    assert.equal((await remove(second)).status, 409);
  }
  await db.facultyExtraIncentiveEntry.update({ where: { id: second.id }, data: { status: "PENDING" } });
  const onlineEntry = await db.facultyExtraIncentiveEntry.create({ data: { facultyId: faculty.id, incentiveTypeId: online.id, quantityChange: 1, rateSnapshot: 200, amountSnapshot: 200, createdByType: "FACULTY", createdById: faculty.id } });
  assert.equal((await remove(onlineEntry, owner, online.id)).status, 403);
  // Inject only an audit write failure, while running the real PostgreSQL transaction.
  const failureDb = { facultyExtraIncentiveOperationLock: db.facultyExtraIncentiveOperationLock, $transaction: work => db.$transaction(tx => work(new Proxy(tx, { get(target, property) { return property === "auditLog" ? { create: async () => { throw new Error("Controlled audit failure"); } } : target[property]; } }))) };
  const rollbackEntry = await create();
  await assert.rejects(deleteCopySet(faculty.id, type.id, rollbackEntry.id, { expectedUpdatedAt: rollbackEntry.updatedAt.toISOString() }, failureDb), /Controlled audit failure/);
  assert.equal((await db.facultyExtraIncentiveEntry.findUniqueOrThrow({ where: { id: rollbackEntry.id } })).status, "PENDING");
  assert.equal(await db.auditLog.count({ where: { entityId: rollbackEntry.id } }), 0);
  assert.ok((await db.facultyExtraIncentiveOperationLock.findUniqueOrThrow({ where: { facultyId: faculty.id } })).expiresAt <= new Date());
  // Exactly 21 visible sets: removing the last page's only item shrinks pagination to one page.
  for (let i = 0; i < 19; i++) await create();
  const lastPage = (await request(`/my/${type.id}/sets?page=2`)).body;
  assert.equal(lastPage.entries.length, 1);
  const last = lastPage.entries[0]; last.updatedAt = new Date(last.updatedAt);
  assert.equal((await remove(last)).status, 200);
  assert.equal((await request(`/my/${type.id}/sets?page=2`)).body.totalPages, 1);

  const waitForLease = async id => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const lease = await db.facultyExtraIncentiveOperationLock.findUnique({ where: { facultyId: id } });
      if (lease?.expiresAt > new Date()) return;
      await delay(10);
    }
    assert.fail("Operation did not acquire its lease");
  };
  for (const deleteFirst of [true, false]) {
    const racer = await makeFaculty(), racerToken = await token("faculty", racer.id);
    const selected = (await saveCopySet(racer.id, type.id, { quantity: 2, remark: "Race target", requestId: randomUUID() })).entry;
    await saveCopySet(racer.id, type.id, { quantity: 3, remark: "Untouched set", requestId: randomUUID() });
    const pay = () => request(`/admin/pay/${racer.id}`, administrator, "POST", { method: "CASH" });
    await blocker.query("BEGIN");
    await blocker.query('SELECT "id" FROM "FacultyExtraIncentiveEntry" WHERE "id" = $1 FOR UPDATE', [selected.id]);
    const running = deleteFirst ? remove(selected, racerToken) : pay();
    let competing;
    try {
      await waitForLease(racer.id);
      if (deleteFirst) assert.equal((await pay()).status, 409);
      else {
        competing = remove(selected, racerToken);
        // Payment's FK lock can queue the competing operation on Faculty rather than return immediately.
        let queued = false;
        for (let i = 0; i < 300 && !queued; i++) {
          const result = await db.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Faculty"%'`;
          queued = result[0].n > 0;
          if (!queued) await delay(10);
        }
        assert.ok(queued, "Competing deletion must reach the database lock before releasing the payment");
      }
    } finally { await blocker.query("ROLLBACK"); }
    assert.equal((await running).status, 200);
    if (deleteFirst) assert.equal((await pay()).status, 200);
    else assert.equal((await competing).status, 409);
    const payments = await db.facultyExtraIncentivePayment.findMany({ where: { facultyId: racer.id } });
    assert.equal(payments.length, 1); assert.equal(Number(payments[0].totalAmount), deleteFirst ? 225 : 375);
    assert.equal((await db.facultyExtraIncentiveEntry.findUniqueOrThrow({ where: { id: selected.id } })).status, deleteFirst ? "DELETED" : "PAID");
  }
});
