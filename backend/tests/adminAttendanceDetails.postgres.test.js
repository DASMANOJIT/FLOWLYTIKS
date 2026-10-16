import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("Admin attendance details: authorized additions/deletions, concurrency, audit and financial locks", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true", timeout: 30000 }, async t => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { addSession } = await import("../utils/sessionStore.js");
  const { attendanceWeek } = await import("../services/dailyAttendanceService.js");
  let server;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect(); });
  const key = randomUUID();
  const faculty = await db.faculty.create({ data: { facultyId: `DETAIL_${key}`, username: key, phone: key, fullName: "Attendance Details Fixture", passwordHash: "DISABLED", joiningDate: new Date("2020-01-01"), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
  const admin = await db.admin.create({ data: { name: "Attendance Fixture Admin", email: `${key}@example.invalid`, password: "DISABLED" } });
  const token = async (role, id) => { const jti = randomUUID(); await addSession(role, id, jti, Date.now() + 600000); return jwt.sign({ role, id, jti }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
  const administrator = await token("admin", admin.id), owner = await token("faculty", faculty.id);
  const app = express(); app.use(express.json()); app.use("/api/work-ledger", (await import("../routes/workledgerroute.js")).default);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/work-ledger`;
  const request = async (path, auth = administrator, method = "GET", body) => {
    const response = await fetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const week = attendanceWeek(new Date(Date.UTC(2098, 0, 1 + admin.id * 7))), date = week.start.toISOString().slice(0, 10);
  const input = { facultyId: faculty.id, date, shift: "MORNING" };
  for (const auth of [null, owner, jwt.sign({ role: "staff", id: "not-needed" }, process.env.JWT_SECRET), jwt.sign({ role: "student", id: 999999, jti: randomUUID() }, process.env.JWT_SECRET)]) {
    assert.ok([401, 403].includes((await request("/admin/attendance", auth, "POST", input)).status));
    assert.ok([401, 403].includes((await request(`/admin/attendance/eligible?date=${date}&shift=MORNING`, auth)).status));
    assert.ok([401, 403].includes((await request(`/admin/attendance/${randomUUID()}`, auth, "DELETE")).status));
  }
  assert.equal(await db.workLedgerEntry.count({ where: { facultyId: faculty.id } }), 0);
  assert.equal((await request("/admin/attendance", administrator, "POST", { ...input, amount: 1 })).status, 400);
  assert.equal((await request("/admin/attendance", administrator, "POST", { ...input, shift: "AFTERNOON" })).status, 400);
  const matches = await request(`/admin/attendance/eligible?date=${date}&shift=MORNING&search=Details`);
  assert.equal(matches.status, 200); assert.ok(matches.body.faculty.some(person => person.id === faculty.id));
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => request("/admin/attendance", administrator, "POST", input)));
  assert.equal(concurrent.filter(result => result.status === 201).length, 1);
  assert.equal(concurrent.filter(result => result.status === 409).length, 7);
  const morning = await db.workLedgerEntry.findFirstOrThrow({ where: { facultyId: faculty.id } });
  assert.equal(Number(morning.amount), 200);
  assert.equal((await request(`/admin/attendance/eligible?date=${date}&shift=MORNING`)).body.faculty.some(person => person.id === faculty.id), false);
  assert.equal((await request(`/admin/attendance/eligible?date=${date}&shift=EVENING`)).body.faculty.some(person => person.id === faculty.id), true);
  assert.equal((await request("/admin/attendance", administrator, "POST", { ...input, shift: "EVENING" })).status, 201);
  assert.equal((await request(`/admin/attendance/${morning.id}`, administrator, "DELETE")).status, 200);
  assert.equal(await db.workLedgerEntry.count({ where: { facultyId: faculty.id, date: week.start } }), 1);
  const audit = await db.workLedgerEntryAudit.findFirstOrThrow({ where: { action: "DELETE", changedBy: `admin:${admin.id}` } });
  assert.equal(audit.entryId, null); assert.equal(audit.previousData.id, morning.id);
  assert.equal((await request(`/admin/attendance/${morning.id}`, administrator, "DELETE")).status, 404);
  const report = await request(`/export.json?week=${date}`);
  assert.equal(report.body.summary.totalAmount, 200);
  const weekend = new Date(week.start); weekend.setUTCDate(weekend.getUTCDate() + 1);
  assert.equal((await request("/admin/attendance", administrator, "POST", { ...input, date: weekend.toISOString().slice(0, 10) })).status, 201);
  assert.equal(Number((await db.workLedgerEntry.findFirstOrThrow({ where: { facultyId: faculty.id, date: weekend } })).amount), 400);
  const legacyDate = new Date(week.start); legacyDate.setUTCDate(legacyDate.getUTCDate() + 2);
  const legacy = await db.workLedgerEntry.create({ data: { facultyId: faculty.id, date: legacyDate, shift: "DAILY", amount: 333.25, createdBy: "legacy-fixture" } });
  assert.equal((await request(`/admin/attendance/${legacy.id}`, administrator, "DELETE")).status, 409);
  assert.equal((await request("/admin/attendance", administrator, "POST", { ...input, date: legacyDate.toISOString().slice(0, 10) })).status, 409);
  const evening = await db.workLedgerEntry.findFirstOrThrow({ where: { facultyId: faculty.id, date: week.start } });
  const payment = await db.weeklyFacultyPaymentRecord.create({ data: { weekStart: week.start, weekEnd: week.end, totalAmount: 933.25, paidAmount: 0, pendingAmount: 933.25, status: "PROCESSING" } });
  for (const status of ["PROCESSING", "PAID"]) {
    await db.weeklyFacultyPaymentRecord.update({ where: { id: payment.id }, data: { status } });
    assert.equal((await request(`/admin/attendance/${evening.id}`, administrator, "DELETE")).status, 403);
    assert.equal((await request("/admin/attendance", administrator, "POST", input)).status, 403);
  }
  assert.equal(await db.workLedgerEntry.count({ where: { facultyId: faculty.id } }), 3);
  assert.equal(Number((await db.workLedgerEntry.findUniqueOrThrow({ where: { id: legacy.id } })).amount), 333.25);
});
