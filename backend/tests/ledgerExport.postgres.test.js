import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("real ledger exports include complete selected week and overrides, exclude other dates, reject other roles", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { addSession } = await import("../utils/sessionStore.js");
  const { attendanceWeek } = await import("../services/dailyAttendanceService.js");
  const marker = randomUUID();
  let week = attendanceWeek(new Date("2097-11-13T12:00:00Z"));
  // Repeated runs on this disposable cluster retain prior fixtures. Choose an
  // unused whole week rather than weakening complete-week export assertions.
  while (await db.workLedgerEntry.count({ where: { date: { gte: week.start, lt: new Date(+week.start + 8 * 86400000) } } })) {
    week = attendanceWeek(new Date(+week.start + 14 * 86400000));
  }
  const day = offset => new Date(+week.start + offset * 86400000);
  const faculty = await db.faculty.create({ data: { facultyId: `EXPORT_${marker}`, username: marker, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Export Teacher", phone: marker, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
  await db.workLedgerEntry.createMany({ data: [
    { facultyId: faculty.id, date: day(0), shift: "DAILY", amount: 375, remarks: `Override ${marker}`, createdBy: "admin:test", updatedByName: "Export Admin", updatedByRole: "ADMIN" },
    { facultyId: faculty.id, date: day(1), shift: "MORNING", amount: 123, remarks: `Legacy ${marker}`, createdBy: "legacy:test" },
    { facultyId: faculty.id, date: day(7), shift: "DAILY", amount: 999, remarks: `Outside ${marker}`, createdBy: "admin:test" },
  ] });
  const admin = await db.admin.findFirstOrThrow();
  const token = async (role, id) => {
    const jti = randomUUID(); await addSession(role, id, jti, Date.now() + 600000);
    return jwt.sign({ id, role, jti }, process.env.JWT_SECRET, { expiresIn: "10m" });
  };
  const adminToken = await token("admin", admin.id), facultyToken = await token("faculty", faculty.id);
  const staff = await db.staff.create({ data: { name: "Export Staff", email: `${marker}@example.invalid`, passwordHash: "TEST_LOGIN_DISABLED", verifiedAt: new Date(), createdByAdminId: admin.id } });
  const student = await db.student.create({ data: { name: "Export Student", phone: randomUUID(), password: "TEST_LOGIN_DISABLED", school: "Test", class: "8", isVerified: true } });
  const staffToken = await token("staff", staff.id), studentToken = await token("student", student.id);
  const app = express(); app.use("/api/work-ledger", (await import("../routes/workledgerroute.js")).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/work-ledger`;
  try {
    for (const format of ["csv", "json"]) {
      const url = `${base}/export.${format}?week=${week.start.toISOString().slice(0, 10)}&limit=1&search=nomatch&shift=EVENING`;
      assert.equal((await fetch(url)).status, 401);
      for (const auth of [facultyToken, staffToken, studentToken]) assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${auth}` } })).status, 403);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${adminToken}` } });
      assert.equal(response.status, 200);
      if (format === "csv") {
        const csv = await response.text();
        assert.ok(csv.includes(`Override ${marker}`)); assert.ok(csv.includes(`Legacy ${marker}`));
        assert.ok(!csv.includes(`Outside ${marker}`));
        assert.match(csv, /"TOTAL".*"498"/); assert.match(csv, /"ADMIN"/);
      } else {
        const report = await response.json();
        assert.equal(report.entries.length, 2);
        assert.deepEqual(report.entries.map(entry => Number(entry.amount)), [375, 123]);
        assert.equal(report.weekStart, week.start.toISOString().slice(0, 10));
        assert.equal(report.weekEnd, week.end.toISOString().slice(0, 10));
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)); await db.$disconnect(); }
});
