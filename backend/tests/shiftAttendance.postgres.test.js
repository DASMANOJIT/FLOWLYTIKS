import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("Morning/Evening routes share stored amounts, serialize writes and preserve historical days", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true", timeout: 30000 }, async t => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { attendanceWeek, attendanceDateKey } = await import("../services/dailyAttendanceService.js");
  const { addSession } = await import("../utils/sessionStore.js");
  let server;
  t.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await db.$disconnect(); });
  const id = randomUUID();
  const faculty = await db.faculty.create({ data: { id, facultyId: `SHIFTS_${id}`, username: id, phone: id, fullName: "Shift Test Faculty", passwordHash: "TEST_LOGIN_DISABLED", joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
  const admin = await db.admin.create({ data: { email: `${id}@example.invalid`, password: "TEST_LOGIN_DISABLED", name: "Shift Test Admin" } });
  const auth = async (role, userId) => { const jti = randomUUID(); await addSession(role, userId, jti, Date.now() + 600000); return jwt.sign({ id: userId, role, jti }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
  const owner = await auth("faculty", faculty.id), administrator = await auth("admin", admin.id);
  const app = express(); app.use(express.json());
  app.use("/api/faculty", (await import("../routes/facultyroute.js")).default);
  app.use("/api/work-ledger", (await import("../routes/workledgerroute.js")).default);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, token = owner, method = "GET", body) => {
    const response = await fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const week = attendanceWeek("2097-10-10");
  const dates = Array.from({ length: 7 }, (_, i) => { const day = new Date(week.start); day.setUTCDate(day.getUTCDate() + i); return attendanceDateKey(day); });
  const mark = (date, shift, present = true, extra = {}) => request("/api/faculty/attendance/week", owner, "POST", { date, shift, present, ...extra });
  assert.equal((await request("/api/faculty/attendance/week", null, "POST", { date: dates[0], shift: "MORNING", present: true })).status, 401);
  for (const shift of [undefined, "DAILY", "AFTERNOON"]) assert.equal((await mark(dates[0], shift)).status, 400);
  assert.equal((await mark(dates[0], "MORNING", true, { facultyId: "someone-else" })).status, 403);
  assert.equal((await mark(dates[0], "MORNING", true, { amount: 1 })).status, 400);
  for (let day = 0; day < 4; day++) {
    const rate = day === 1 || day === 2 ? 400 : 200;
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => mark(dates[day], i % 2 ? "MORNING" : "EVENING")));
    assert.ok(results.every(r => r.status === 200 && Number(r.body.entry.amount) === rate));
    assert.equal(await db.workLedgerEntry.count({ where: { facultyId: id, date: new Date(dates[day]) } }), 2);
  }
  const read = await request(`/api/faculty/attendance/week?weekStart=${dates[0]}`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.rows.map(row => row.date), dates);
  assert.deepEqual(read.body.rows.slice(0, 4).map(row => row.attendance.amount), [400, 800, 800, 400]);
  assert.equal(read.body.rows.filter(row => row.attendance.present).length, 4, "Two shifts are one present date");
  const morning = await db.workLedgerEntry.findFirstOrThrow({ where: { facultyId: id, date: new Date(dates[1]), shift: "MORNING" } });
  assert.equal((await request(`/api/work-ledger/attendance/${morning.id}`, administrator, "PATCH", { amount: 375, remarks: "Reviewed shift rate" })).status, 200);
  assert.equal(Number((await mark(dates[1], "MORNING")).body.entry.amount), 375);
  assert.equal((await mark(dates[1], "EVENING", false)).status, 200);
  assert.equal(await db.workLedgerEntry.count({ where: { facultyId: id, date: new Date(dates[1]) } }), 1);
  assert.equal(Number((await db.workLedgerEntry.findUniqueOrThrow({ where: { id: morning.id } })).amount), 375);
  for (const [offset, shift, amount] of [[4, "DAILY", 333], [5, "AFTERNOON", 123.45]]) {
    const legacy = await db.workLedgerEntry.create({ data: { facultyId: id, date: new Date(dates[offset]), shift, amount, createdBy: "legacy-test", updatedBy: "legacy-test" } });
    for (const target of ["MORNING", "EVENING"]) assert.equal((await mark(dates[offset], target)).status, 409);
    assert.equal(Number((await db.workLedgerEntry.findUniqueOrThrow({ where: { id: legacy.id } })).amount), amount);
    assert.equal(await db.workLedgerEntry.count({ where: { facultyId: id, date: new Date(dates[offset]) } }), 1);
  }
  const facultyView = (await request(`/api/faculty/attendance/week?weekStart=${dates[0]}`)).body;
  const adminView = (await request(`/api/faculty/attendance/week?weekStart=${dates[0]}`, administrator)).body;
  assert.equal(facultyView.rows[1].attendance.shifts.MORNING.amount, 375);
  assert.equal(facultyView.rows[1].attendance.shifts.EVENING.amount, 0);
  assert.equal(facultyView.rows[4].attendance.legacy, true);
  const actual = facultyView.rows.reduce((sum, row) => sum + row.attendance.amount, 0);
  assert.equal(actual, 2431.45);
  assert.equal(adminView.grid.find(row => row.id === id).weeklyTotal, actual);
  const report = await request(`/api/work-ledger/export.json?week=${dates[0]}`, administrator);
  assert.equal(report.status, 200);
  assert.equal(report.body.summary.totalAmount, actual);
  assert.equal(report.body.entries.length, 9);
  const csv = await fetch(`${base}/api/work-ledger/export.csv?week=${dates[0]}`, { headers: { Authorization: `Bearer ${administrator}` } });
  assert.equal(csv.status, 200); const text = await csv.text();
  for (const term of ["MORNING", "EVENING", "DAILY", "AFTERNOON", "2431.45"]) assert.ok(text.includes(term));
  assert.equal((await request(`/api/work-ledger/export.json?week=${dates[0]}`)).status, 403);
  await db.weeklyFacultyPaymentRecord.create({ data: { weekStart: week.start, weekEnd: week.end, totalAmount: actual, paidAmount: actual, pendingAmount: 0, status: "PAID" } });
  assert.equal((await mark(dates[0], "MORNING", false)).status, 403);
  assert.equal((await request("/api/faculty/attendance/week", administrator, "POST", { facultyId: id, date: dates[0], shift: "EVENING", present: false })).status, 403);
  assert.equal(await db.workLedgerEntry.count({ where: { facultyId: id } }), 9);
});
