import "./setupDisposableDatabase.js";
import express from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

// Only provider boundaries are mocked. Browser /api requests reach real routes,
// sessions and PostgreSQL; this module never imports production worker startup.
const localFetch = globalThis.fetch;
const codes = new Map();
const orders = new Map();
Object.assign(process.env, { CASHFREE_CLIENT_ID: "isolated", CASHFREE_CLIENT_SECRET: "isolated", CASHFREE_ENVIRONMENT: "sandbox", CASHFREE_RETURN_URL: "http://localhost:59999/payment-success" });
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input));
  if (url.origin === "https://api.resend.com" && url.pathname === "/emails") {
    const payload = JSON.parse(options.body);
    codes.set(payload.to[0], payload.text.match(/\b\d{6}\b/)[0]);
    return Response.json({ id: randomUUID() });
  }
  if (url.origin === "https://sandbox.cashfree.com") {
    if (options.method === "POST") {
      const request = JSON.parse(options.body);
      const order = { order_id: request.order_id, order_amount: request.order_amount, order_currency: request.order_currency, order_status: "ACTIVE", payment_session_id: "isolated-session" };
      orders.set(request.order_id, order); return Response.json(order);
    }
    const id = decodeURIComponent(url.pathname.split("/")[3]);
    const order = orders.get(id);
    if (!order) return Response.json({ message: "Not found" }, { status: 404 });
    return Response.json(url.pathname.endsWith("/payments") ? order.order_status === "PAID" ? [{ cf_payment_id: `isolated-${id}`, payment_status: "SUCCESS", payment_amount: order.order_amount, payment_currency: "INR", payment_method: { upi: {} } }] : [] : order);
  }
  return localFetch(input, options);
};
const { default: db } = await import("../prisma/client.js");
const { attendanceWeek } = await import("../services/dailyAttendanceService.js");
const marker = randomUUID().slice(0, 8);
const password = "Isolated-Password1!";
const hash = await bcrypt.hash(password, 10);
const admin = await db.admin.create({ data: { name: "Browser Admin", email: `admin-${marker}@example.invalid`, password: hash } });
const faculty = await db.faculty.create({ data: { facultyId: `BROWSER_${marker}`, username: marker, email: `faculty-${marker}@example.invalid`, fullName: "Browser Teacher", phone: `9${Date.now().toString().slice(-9)}`, passwordHash: hash, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
const staff = await db.staff.create({ data: { name: "Browser Staff", email: `staff-${marker}@example.invalid`, passwordHash: hash, verifiedAt: new Date(), createdByAdminId: admin.id } });
const student = await db.student.create({ data: { name: `Browser ${marker} Student`, email: `student-${marker}@example.invalid`, phone: `8${Date.now().toString().slice(-9)}`, password: hash, school: "Test School", class: "8", adminId: admin.id, isVerified: true, joinDate: new Date("2026-03-01") } });
const excluded = await db.student.create({ data: { name: `Browser ${marker} Excluded`, phone: randomUUID(), password: hash, school: "Test School", class: "9", isVerified: true } });
await db.appSettings.upsert({ where: { id: 1 }, create: { id: 1, monthlyFee: 600 }, update: {} });
const week = attendanceWeek(new Date(Date.now() - 7 * 86400000));
await db.workLedgerEntry.createMany({ data: [
  { facultyId: faculty.id, date: week.start, shift: "DAILY", amount: 375, remarks: `Override-${marker}`, createdBy: "admin:test", updatedByName: "Browser Admin", updatedByRole: "ADMIN" },
  { facultyId: faculty.id, date: new Date(+week.start + 86400000), shift: "MORNING", amount: 123, remarks: `Legacy-${marker}`, createdBy: "legacy:test" },
  { facultyId: faculty.id, date: new Date(+week.start + 7 * 86400000), shift: "DAILY", amount: 999, remarks: `Outside-${marker}`, createdBy: "admin:test" },
] });
const app = express(); app.use(express.json());
for (const [prefix, file] of Object.entries({ auth: "authroute", "faculty-auth": "facultyauthroute", staff: "staffroute", students: "studentroute", payments: "paymentroute", admin: "adminroute", faculty: "facultyroute", "work-ledger": "workledgerroute", "faculty-weekly-payments": "facultyweeklypaymentroute", settings: "settingsroute", notifications: "notificationroute", "faculty-extra-incentives": "facultyextraincentiveroute" })) {
  app.use(`/api/${prefix}`, (await import(`../routes/${file}.js`)).default);
}
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: "Isolated API error", code: error.code }));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
process.env.BACKEND_URL = `http://127.0.0.1:${server.address().port}`;
process.send({ ready: true, base: `http://127.0.0.1:${server.address().port}`, marker, admin: { email: admin.email }, faculty: { email: faculty.email }, staff: { email: staff.email }, student: { email: student.email, id: student.id, name: student.name }, excluded: excluded.name, weekStart: week.start.toISOString().slice(0, 10) });
process.on("message", async message => {
  if (message.kind === "providerPaid") { orders.get(message.orderId).order_status = "PAID"; process.send({ request: message.request, success: true }); }
  if (message.kind === "code") process.send({ request: message.request, code: codes.get(message.email) });
  if (message.kind === "payment") {
    const payment = await db.payment.findUnique({ where: { studentId_month_academicYear: { studentId: student.id, month: "June", academicYear: 2026 } } });
    const audit = payment && await db.auditLog.findFirst({ where: { entityType: "Payment", entityId: String(payment.id), actorId: staff.id, action: "STAFF_CASH_PAYMENT_RECORDED" } });
    process.send({ request: message.request, status: payment?.status, method: payment?.paymentProvider, attributed: Boolean(audit) });
  }
  if (message.kind === "stop") {
    await new Promise(resolve => server.close(resolve)); await db.$disconnect(); process.exit(0);
  }
});
