import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import express from "express";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("real HTTP/Prisma role sessions, Staff OTP/reset, follow-ups, cash concurrency and daily attendance", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const app = express(); app.use(express.json());
  for (const [prefix, name] of [["auth", "authroute"], ["staff", "staffroute"], ["faculty-auth", "facultyauthroute"], ["faculty", "facultyroute"], ["admin", "adminroute"], ["payments", "paymentroute"], ["work-ledger", "workledgerroute"], ["faculty-extra-incentives", "facultyextraincentiveroute"]]) {
    app.use(`/api/${prefix}`, (await import(`../routes/${name}.js`)).default);
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch, randomInt = crypto.randomInt;
  const delivered = new Map();
  globalThis.fetch = async (url, options) => {
    if (String(url) === "https://api.resend.com/emails") {
      const body = JSON.parse(options.body);
      delivered.set(body.to[0], body.text.match(/\b\d{6}\b/)[0]);
      return new Response(JSON.stringify({ id: "mock-delivery" }), { status: 200 });
    }
    return originalFetch(url, options);
  };
  const call = async (path, token, body, method = body === undefined ? "GET" : "POST") => {
    const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  };
  const password = "Isolated-Test-Password1!", newPassword = "Isolated-New-Password2!";
  const email = `staff-${crypto.randomUUID()}@example.invalid`;
  try {
    const adminEmail = `admin-${crypto.randomUUID()}@example.invalid`;
    await db.admin.create({ data: { name: "Isolated HTTP Admin", email: adminEmail, password: await bcrypt.hash(password, 10) } });
    assert.equal((await call("/api/staff/members")).status, 401);
    assert.equal((await call("/api/auth/login", null, { email: adminEmail, password: "wrong" })).status, 401);
    const adminLogin = await call("/api/auth/login", null, { email: adminEmail, password });
    assert.equal(adminLogin.status, 200); const admin = adminLogin.data.token;
    for (let repeat = 0; repeat < 2; repeat++) assert.equal((await call("/api/auth/heartbeat", admin)).status, 200);
    crypto.randomInt = () => 12345;
    const sent = await call("/api/staff/creation/send-code", admin, { name: "Isolated Staff", email, password, confirmPassword: password });
    crypto.randomInt = randomInt;
    assert.equal(sent.status, 200); assert.match(delivered.get(email), /^0\d{5}$/);
    const requestId = sent.data.requestId;
    assert.equal((await call("/api/staff/creation/verify", admin, { requestId, code: "999999" })).status, 400);
    const previousCode = delivered.get(email);
    await db.staffCreationRequest.update({ where: { id: requestId }, data: { expiresAt: new Date(0), lastSentAt: new Date(Date.now() - 16000) } });
    assert.equal((await call("/api/staff/creation/verify", admin, { requestId, code: previousCode })).status, 410);
    crypto.randomInt = () => 543210;
    assert.equal((await call("/api/staff/creation/resend-code", admin, { requestId })).status, 200);
    crypto.randomInt = randomInt;
    assert.equal((await call("/api/staff/creation/verify", admin, { requestId, code: previousCode })).status, 400);
    const created = await call("/api/staff/creation/verify", admin, { requestId, code: delivered.get(email) });
    assert.equal(created.status, 201); assert.ok(!("passwordHash" in created.data.staff));
    assert.equal(await db.staff.count({ where: { email } }), 1);
    assert.equal((await call("/api/staff/creation/verify", admin, { requestId, code: delivered.get(email) })).status, 400);
    assert.equal((await call("/api/auth/heartbeat", admin)).status, 200);
    const staffLogin = await call("/api/staff/login", null, { email, password });
    assert.equal(staffLogin.status, 200); const staff = staffLogin.data.token;
    assert.equal((await call("/api/staff/members", staff)).status, 403);
    assert.equal((await call("/api/admin/dashboard-summary", staff)).status, 403);
    assert.equal((await call("/api/faculty/dashboard-summary", staff)).status, 403);
    assert.equal((await call("/api/staff/creation/send-code", staff, {})).status, 403);
    const facultyTag = crypto.randomUUID();
    const facultyRecord = await db.faculty.create({ data: { facultyId: `FAC_HTTP_${facultyTag}`, username: `http-${facultyTag}`, email: `faculty-${facultyTag}@example.invalid`, passwordHash: await bcrypt.hash(password, 10), fullName: "HTTP Test Faculty", phone: `8${crypto.randomInt(0, 1000000000).toString().padStart(9, "0")}`, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
    const facultyLogin = await call("/api/faculty-auth/login", null, { email: facultyRecord.email, password });
    assert.equal(facultyLogin.status, 200); const faculty = facultyLogin.data.token;
    const student = await db.student.create({ data: { name: "Isolated Student", phone: `9${crypto.randomInt(0, 1000000000).toString().padStart(9, "0")}`, email: `student-${crypto.randomUUID()}@example.invalid`, password: await bcrypt.hash(password, 10), school: "Test School", class: "8", isVerified: true } });
    const studentLogin = await call("/api/auth/login", null, { email: student.email, password });
    assert.equal(studentLogin.status, 200); const studentToken = studentLogin.data.token;
    for (const token of [studentToken, faculty]) assert.equal((await call("/api/staff/members", token)).status, 403);
    const followPath = `/api/staff/students/${student.id}/follow-ups`;
    assert.equal((await call(followPath, staff, { note: "Parent requested a call next week." })).status, 201);
    assert.equal((await call(followPath, admin)).data.followUps.length, 1);
    assert.equal((await call(followPath, staff)).data.followUps.length, 1);
    for (const token of [studentToken, faculty]) assert.equal((await call(followPath, token)).status, 403);
    const period = { month: "June", academicYear: 2026, cashReceived: true, amount: 1 };
    const cash = await Promise.all(Array.from({ length: 3 }, () => call(`/api/staff/students/${student.id}/pay-cash`, staff, period)));
    assert.equal(cash.filter(result => result.status === 201).length, 1);
    assert.ok(cash.every(result => [201, 409].includes(result.status)));
    const payment = await db.payment.findUnique({ where: { studentId_month_academicYear: { studentId: student.id, month: period.month, academicYear: period.academicYear } } });
    assert.equal(payment.amount, 600); assert.equal(payment.status, "paid");
    assert.equal(await db.auditLog.count({ where: { actorType: "STAFF", actorId: created.data.staff.id, entityId: String(payment.id), action: "STAFF_CASH_PAYMENT_RECORDED" } }), 1);
    const listing = await call("/api/staff/students?month=June&academicYear=2026&status=paid", staff);
    assert.equal(listing.status, 200); assert.ok(listing.data.students.some(row => row.id === student.id && row.paymentStatus === "Paid"));
    const dashboard = await call("/api/admin/dashboard-summary?month=June&academicYear=2026", admin);
    assert.equal(dashboard.status, 200);
    assert.equal(dashboard.data.paidStudents, await db.student.count({ where: { payments: { some: { month: "June", academicYear: 2026, status: "paid" } } } }));
    assert.equal(dashboard.data.paymentReceived, (await db.payment.aggregate({ where: { month: "June", academicYear: 2026, status: "paid" }, _sum: { amount: true } }))._sum.amount);
    const reversal = { paymentId: payment.id, studentId: student.id, month: "June", academicYear: 2026 };
    assert.equal((await call("/api/payments/reverse", staff, reversal)).status, 403);
    assert.equal((await call("/api/payments/reverse", admin, reversal)).status, 200);
    assert.equal((await db.payment.findUnique({ where: { id: payment.id } })).status, "pending");
    const online = await db.payment.create({ data: { studentId: student.id, month: "July", academicYear: 2026, amount: 600, status: "paid", paymentProvider: "CASHFREE" } });
    assert.equal((await call("/api/payments/reverse", admin, { ...reversal, paymentId: online.id, month: "July" })).status, 409);
    for (const [month, academicYear] of [["February", 2025], ["March", 2026], ["February", 2026], ["March", 2025]]) {
      const result = await call(`/api/staff/students/${student.id}/pay-cash`, staff, { cashReceived: true, month, academicYear, amount: 1 });
      assert.equal(result.status, 201);
      const saved = await db.payment.findUniqueOrThrow({ where: { studentId_month_academicYear: { studentId: student.id, month, academicYear } } });
      assert.equal(saved.status, "paid"); assert.equal(saved.amount, 600); assert.equal(saved.paymentProvider, "CASH");
    }
    assert.equal(await db.payment.count({ where: { studentId: student.id, month: { in: ["February", "March"] }, academicYear: { in: [2025, 2026] }, status: "paid" } }), 4, "Fee months remain distinct across March-February sessions");
    assert.equal((await db.payment.findUnique({ where: { id: online.id } })).status, "paid");
    assert.equal((await call("/api/payments/cashfree/verify?paymentId=1", staff)).status, 403);
    assert.equal((await call("/api/payments/cashfree/verify?paymentId=1", faculty)).status, 403);
    assert.equal((await call("/api/payments/phonepe/callback", null, {})).status, 404);
    const { attendanceWeek } = await import("../services/dailyAttendanceService.js");
    const friday = attendanceWeek().start.toISOString().slice(0, 10);
    const saturdayDate = new Date(friday); saturdayDate.setUTCDate(saturdayDate.getUTCDate() + 1);
    const saturday = saturdayDate.toISOString().slice(0, 10);
    for (const [date, amount] of [[friday, 200], [saturday, 400]]) {
      const results = await Promise.all(Array.from({ length: 3 }, () => call("/api/faculty/attendance/week", faculty, { date, present: true })));
      assert.ok(results.every(result => result.status === 200));
      assert.ok(results.every(result => Number(result.data.entry.amount) === amount));
    }
    assert.equal((await call("/api/faculty/attendance/week", faculty, { date: friday, present: true, amount: 999 })).status, 400);
    assert.equal((await call(`/api/faculty/attendance/week?weekStart=${friday}`, faculty)).status, 200);
    const daily = await db.workLedgerEntry.findFirst({ where: { facultyId: facultyRecord.id, date: new Date(saturday), shift: "DAILY" } });
    assert.equal((await call(`/api/work-ledger/attendance/${daily.id}`, admin, { amount: 350, isPresent: true }, "PATCH")).status, 200);
    assert.equal(Number((await call("/api/faculty/attendance/week", faculty, { date: saturday, present: true })).data.entry.amount), 350);
    const csv = await fetch(`${base}/api/work-ledger/export.csv?week=${friday}`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(csv.status, 200); assert.match(csv.headers.get("content-type"), /text\/csv/);
    assert.match(await csv.text(), /350/);
    assert.equal((await call("/api/faculty/attendance/week", faculty, { date: friday, present: false })).status, 200);
    assert.equal((await call("/api/staff/password-reset/send-code", null, { email })).status, 200);
    const reset = await call("/api/staff/password-reset/verify", null, { email, code: delivered.get(email) });
    assert.equal(reset.status, 200);
    const resetBody = { email, resetToken: reset.data.resetToken, newPassword, confirmPassword: newPassword };
    assert.equal((await call("/api/staff/password-reset/save", null, resetBody)).status, 200);
    assert.equal((await call("/api/staff/password-reset/save", null, resetBody)).status, 400);
    assert.equal((await call("/api/staff/me", staff)).status, 401);
    assert.equal((await call("/api/staff/login", null, { email, password })).status, 401);
    assert.equal((await call("/api/staff/login", null, { email, password: newPassword })).status, 200);
    assert.equal((await call("/api/auth/logout", admin, {})).status, 200);
    assert.equal((await call("/api/auth/heartbeat", admin)).status, 401);
  } finally {
    crypto.randomInt = randomInt; globalThis.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
    await db.$disconnect();
  }
});
