import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import jwt from "jsonwebtoken";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("HTTP class creation without scheduled end: schema readiness, roles, batches, historical edits and rollback", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true", timeout: 30000 }, async t => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { addSession } = await import("../utils/sessionStore.js");
  let server;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect(); });
  const key = randomUUID();
  const makeFaculty = () => { const id = randomUUID(); return db.faculty.create({ data: { facultyId: `CREATE_${id}`, username: id, phone: id, fullName: "Creation Fixture", passwordHash: "DISABLED", joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } }); };
  const faculty = await makeFaculty(), other = await makeFaculty();
  const scope = { facultyId: { in: [faculty.id, other.id] } };
  const admin = await db.admin.create({ data: { name: "Creation Admin", email: `${key}@example.invalid`, password: "DISABLED" } });
  const type = await db.extraIncentiveType.findFirst({ where: { name: "ONLINE DOUBT CLASS" } }) || await db.extraIncentiveType.create({ data: { name: "ONLINE DOUBT CLASS", rate: 200 } });
  const batches = await Promise.all([0, 1].map(i => db.onlineClassBatch.create({ data: { name: `Creation ${key} ${i}`, normalizedName: `${key}-${i}` } })));
  const auth = async (role, id) => { const jti = randomUUID(); await addSession(role, id, jti, Date.now() + 600000); return jwt.sign({ role, id, jti }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
  const owner = await auth("faculty", faculty.id), stranger = await auth("faculty", other.id), administrator = await auth("admin", admin.id);
  const app = express(); app.use(express.json()); app.use("/api/faculty-extra-incentives", (await import("../routes/facultyextraincentiveroute.js")).default);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/faculty-extra-incentives`;
  const request = async (path, token, method, body) => {
    const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const input = () => ({ requestId: randomUUID(), incentiveTypeId: type.id, batchIds: batches.map(batch => batch.id), topic: "No scheduled end", message: "Optional fixture announcement", date: "2099-10-09", startTime: "11:05", meetUrl: "https://meet.google.com/abc-defg-hij" });
  if (process.env.TEST_OPTIONAL_END_LEGACY_SCHEMA === "true") {
    await t.test("unapplied migration reproduces null-end failure with no partial class or batches", async () => {
      const columns = await db.$queryRaw`SELECT is_nullable FROM information_schema.columns WHERE table_name='FacultyOnlineClass' AND column_name='endsAt'`;
      assert.equal(columns[0].is_nullable, "NO");
      const body = input(), result = await request("/my/online-classes", owner, "POST", body);
      assert.equal(result.status, 503);
      assert.equal(result.body.code, "ONLINE_CLASS_SCHEMA_NOT_READY");
      assert.equal(await db.facultyOnlineClass.count({ where: { facultyId: faculty.id, requestId: body.requestId } }), 0);
      assert.equal(await db.facultyOnlineClassBatch.count({ where: { batchId: { in: body.batchIds } } }), 0);
    });
    // Only the explicitly guarded disposable database receives the existing committed forward SQL.
    await db.$executeRawUnsafe(await readFile(new URL("../prisma/migrations/20261016110000_online_class_optional_scheduled_end/migration.sql", import.meta.url), "utf8"));
  }
  await t.test("Faculty/Admin create and edit persist null end, real ownership and both batches", async () => {
    for (const [path, token, target] of [["/my/online-classes", owner, faculty.id], ["/admin/online-classes", administrator, other.id]]) {
      const body = { ...input(), facultyId: target === faculty.id ? other.id : target };
      const response = await request(path, token, "POST", body);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const record = response.body.record;
      const saved = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: record.id }, include: { batches: true } });
      assert.equal(saved.facultyId, target); assert.equal(saved.endsAt, null);
      assert.equal(saved.actualEndAt, null); assert.equal(record.actualDurationSeconds, null);
      assert.equal(saved.startsAt.toISOString(), "2099-10-09T05:35:00.000Z");
      assert.deepEqual(new Set(saved.batches.map(batch => batch.batchId)), new Set(body.batchIds));
      const edited = await request(`${path}/${record.id}`, token, "PATCH", { ...body, topic: "Updated without end", expectedUpdatedAt: record.updatedAt });
      assert.equal(edited.status, 200); assert.equal(edited.body.record.endsAt, null);
      assert.equal((await request(`${path}/${record.id}`, stranger, "PATCH", { ...body, expectedUpdatedAt: edited.body.record.updatedAt })).status, path.startsWith("/admin") ? 403 : 404);
    }
  });
  await t.test("authorization and invalid payloads cannot insert classes", async () => {
    const before = await db.facultyOnlineClass.count({ where: scope });
    assert.equal((await request("/my/online-classes", null, "POST", input())).status, 401);
    assert.equal((await request("/my/online-classes", administrator, "POST", input())).status, 403);
    assert.equal((await request("/admin/online-classes", owner, "POST", { ...input(), facultyId: faculty.id })).status, 403);
    assert.equal((await request("/admin/online-classes", administrator, "POST", input())).status, 400);
    assert.equal((await request("/admin/online-classes", administrator, "POST", { ...input(), facultyId: randomUUID() })).status, 404);
    for (const change of [{ topic: "" }, { date: "2099-02-30" }, { startTime: "25:00" }, { batchIds: [] }, { batchIds: [randomUUID()] }, { meetUrl: "http://meet.google.com/abc-defg-hij" }]) {
      assert.equal((await request("/my/online-classes", owner, "POST", { ...input(), ...change })).status, 400);
    }
    assert.equal(await db.facultyOnlineClass.count({ where: scope }), before);
  });
  await t.test("historical scheduled end survives edits without end-time placeholders", async () => {
    const body = { ...input(), endTime: "12:00" };
    const historical = await request("/my/online-classes", owner, "POST", body);
    assert.equal(historical.status, 200);
    const update = { ...input(), date: "2099-10-10", expectedUpdatedAt: historical.body.record.updatedAt };
    const edited = await request(`/admin/online-classes/${historical.body.record.id}`, administrator, "PATCH", update);
    assert.equal(edited.status, 200);
    assert.equal(edited.body.record.endsAt, historical.body.record.endsAt);
  });
  await t.test("failure after nested class/batch writes rolls back the complete transaction", async () => {
    const original = db.$transaction;
    const body = { ...input(), topic: `Rollback ${key}` };
    const batchScope = { batchId: { in: body.batchIds } };
    const before = await db.facultyOnlineClassBatch.count({ where: batchScope });
    db.$transaction = (work, ...options) => typeof work !== "function" ? original.call(db, work, ...options) : original.call(db, async tx => {
      const result = await work(tx);
      if (result?.topic === body.topic) throw new Error("Isolated commit failure");
      return result;
    }, ...options);
    try {
      assert.equal((await request("/my/online-classes", owner, "POST", body)).status, 500);
    } finally { db.$transaction = original; }
    assert.equal(await db.facultyOnlineClass.count({ where: { facultyId: faculty.id, requestId: body.requestId } }), 0);
    assert.equal(await db.facultyOnlineClassBatch.count({ where: batchScope }), before);
    const retry = await request("/my/online-classes", owner, "POST", body);
    assert.equal(retry.status, 200);
    assert.equal((await request("/my/online-classes", owner, "POST", body)).body.record.id, retry.body.record.id);
  });
});
