import "./setupDisposableDatabase.js";
import { PrismaClient } from "@prisma/client";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";

// Test-only shared client instrumentation; SQL, parameters and credentials never leave IPC.
const db = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
globalThis.__flowlytiksPrisma = db;
let queries = 0, providerCalls = 0, polls = 0, activePolls = 0;
db.$on("query", () => queries++);
const delay = monitorEventLoopDelay({ resolution: 20 }); delay.enable();
const { addSession } = await import("../utils/sessionStore.js");
const { attendanceWeek } = await import("../services/dailyAttendanceService.js");
const { checkOnlineMeeting, startMeetPollingWorker } = await import("../services/meetVerificationService.js");
const marker = process.env.PHASE4_REUSE_MARKER || `P4_${randomUUID().slice(0, 8)}`;
if (!/^P4_[a-f0-9]{8}$/.test(marker)) throw new Error("Invalid synthetic fixture marker");
const hash = await bcrypt.hash("Isolated-Password1!", 10);
const now = new Date(), week = attendanceWeek(now);
async function createDataset() {
const admin = await db.admin.create({ data: { name: "Synthetic Performance Admin", email: `${marker}@example.invalid`, password: hash } });
const faculties = [];
for (let i = 0; i < 24; i++) faculties.push(await db.faculty.create({ data: { facultyId: `${marker}_F${i}`, username: `${marker}_F${i}`, fullName: `Synthetic Teacher ${i}`, email: `${marker}_f${i}@example.invalid`, phone: `${marker}_f${i}`, passwordHash: hash, joiningDate: new Date("2026-03-01"), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } }));
const staffMembers = [];
for (let i = 0; i < 6; i++) staffMembers.push(await db.staff.create({ data: { name: `Synthetic Staff ${i}`, email: `${marker}_s${i}@example.invalid`, passwordHash: hash, verifiedAt: now, createdByAdminId: admin.id } }));
await db.student.createMany({ data: Array.from({ length: 1200 }, (_, i) => ({ name: `${marker} Student ${String(i).padStart(4, "0")}`, email: `${marker}_${i}@example.invalid`, phone: `${marker}_${i}`, password: hash, school: `Synthetic School ${i % 8}`, class: String(5 + i % 8), adminId: admin.id, isVerified: true, joinDate: new Date("2026-03-01") })) });
const students = await db.student.findMany({ where: { adminId: admin.id }, orderBy: { id: "asc" } });
const months = ["March", "April", "May", "June", "July", "August", "September", "October"];
await db.payment.createMany({ data: students.flatMap((student, i) => months.filter((_, m) => (i + m) % 4 !== 0).map(month => ({ studentId: student.id, month, academicYear: 2026, amount: 600, status: "paid", paymentProvider: "CASH", paidAt: now, teacherAdminId: admin.id }))) });
await db.staffStudentFollowUp.createMany({ data: students.slice(0, 300).flatMap((student, i) => Array.from({ length: 6 }, (_, j) => ({ studentId: student.id, staffId: staffMembers[i % 6].id, note: `Synthetic follow-up ${j}: parent requested a callback. No real contact was made.`, createdAt: new Date(+now - j * 86400000) }))) });
await db.workLedgerEntry.createMany({ data: faculties.flatMap(faculty => Array.from({ length: 84 }, (_, i) => ({ facultyId: faculty.id, date: new Date(+week.start - i * 86400000), shift: "DAILY", amount: [0, 6].includes(new Date(+week.start - i * 86400000 + 19800000).getUTCDay()) ? 400 : 200, createdBy: "phase4:synthetic" }))) });
const type = await db.extraIncentiveType.create({ data: { name: `${marker} Online Classes`, rate: 200 } });
await db.facultyExtraIncentiveEntry.createMany({ data: faculties.flatMap(faculty => Array.from({ length: 20 }, () => ({ facultyId: faculty.id, incentiveTypeId: type.id, quantityChange: 2, rateSnapshot: 200, amountSnapshot: 400, status: "PENDING", createdByType: "FACULTY", createdById: faculty.id }))) });
const batches = [];
for (let i = 0; i < 30; i++) batches.push(await db.onlineClassBatch.create({ data: { name: `${marker} Batch ${i}`, normalizedName: `${marker.toLowerCase()} batch ${i}` } }));
const classes = [];
for (let i = 0; i < 480; i++) {
  const startsAt = new Date(+now - (i - 24) * 3600000);
  classes.push({ id: randomUUID(), facultyId: faculties[i % 24].id, incentiveTypeId: type.id, requestId: randomUUID(), batchName: batches[i % 30].name, className: "", topic: `Synthetic Topic ${i}`, startsAt, endsAt: new Date(+startsAt + 1800000), meetUrl: "https://meet.google.com/abc-defg-hij", status: i < 24 ? "SCHEDULED" : i % 5 === 0 ? "CANCELLED" : "COMPLETED", createdAt: new Date(+startsAt - 86400000) });
}
await db.facultyOnlineClass.createMany({ data: classes });
await db.facultyOnlineClassBatch.createMany({ data: classes.flatMap((row, i) => [0, 1].map(offset => ({ classId: row.id, batchId: batches[(i + offset) % 30].id, nameSnapshot: batches[(i + offset) % 30].name }))) });
const pollRows = [];
for (let i = 0; i < 4; i++) {
  const faculty = faculties[i];
  await db.facultyGoogleConnection.create({ data: { facultyId: faculty.id, googleSubject: `synthetic${i}`, identityVerifiedAt: now, connectedAt: now, scope: "openid https://www.googleapis.com/auth/meetings.space.readonly" } });
  pollRows.push(await db.facultyOnlineClass.create({ data: { facultyId: faculty.id, incentiveTypeId: type.id, requestId: randomUUID(), topic: `Synthetic Live ${i}`, batchName: batches[i].name, className: "", startsAt: new Date(+now - 600000), endsAt: new Date(+now + 7200000), meetUrl: `https://meet.google.com/aaa-bbbb-aa${String.fromCharCode(97 + i)}`, trackingEnabled: true, verificationStatus: "PENDING", createdAt: new Date(+now - 3600000) } }));
}
return { admin, faculties, staffMembers, students, type, batches, pollRows };
}
async function reuseDataset() {
  const admin = await db.admin.findUniqueOrThrow({ where: { email: `${marker}@example.invalid` } });
  const faculties = await db.faculty.findMany({ where: { facultyId: { startsWith: `${marker}_F` } }, orderBy: { createdAt: "asc" } });
  const staffMembers = await db.staff.findMany({ where: { createdByAdminId: admin.id }, orderBy: { createdAt: "asc" } });
  const students = await db.student.findMany({ where: { adminId: admin.id }, orderBy: { id: "asc" } });
  const type = await db.extraIncentiveType.findFirstOrThrow({ where: { name: `${marker} Online Classes` } });
  const batches = await db.onlineClassBatch.findMany({ where: { normalizedName: { startsWith: marker.toLowerCase() } }, orderBy: { createdAt: "asc" } });
  const pollRows = await db.facultyOnlineClass.findMany({ where: { incentiveTypeId: type.id, topic: { startsWith: "Synthetic Live" } } });
  if (students.length !== 1200 || faculties.length !== 24 || staffMembers.length !== 6) throw new Error("Incomplete synthetic dataset");
  return { admin, faculties, staffMembers, students, type, batches, pollRows };
}
const { admin, faculties, staffMembers, students, type, batches, pollRows } = await (process.env.PHASE4_REUSE_MARKER ? reuseDataset() : createDataset());
const users = { admin, faculty: faculties[0], staff: staffMembers[0], student: students[0] };
if (process.env.PHASE4_BROWSER_ONLY === "true") {
  users.admin = await db.admin.create({ data: { name: "Synthetic Browser Admin", email: `p4-browser-${randomUUID()}@example.invalid`, password: hash } });
  users.faculty = faculties[1]; users.staff = staffMembers[1]; users.student = students[1];
}
const tokens = {};
for (const [role, user] of Object.entries(users)) {
  const jti = randomUUID(); await addSession(role, user.id, jti, Date.now() + 4 * 3600000);
  tokens[role] = jwt.sign({ role, id: user.id, jti }, process.env.JWT_SECRET, { expiresIn: "4h" });
}
const app = express(); app.use(express.json());
for (const [prefix, file] of Object.entries({ auth: "authroute", "faculty-auth": "facultyauthroute", staff: "staffroute", students: "studentroute", payments: "paymentroute", admin: "adminroute", faculty: "facultyroute", "work-ledger": "workledgerroute", "faculty-weekly-payments": "facultyweeklypaymentroute", settings: "settingsroute", notifications: "notificationroute", "faculty-extra-incentives": "facultyextraincentiveroute" })) app.use(`/api/${prefix}`, (await import(`../routes/${file}.js`)).default);
app.use("/api/faculty/google", (await import("../routes/facultygoogleroute.js")).default);
app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: "Isolated API failure", code: error.code }));
const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
let stopWorker = async () => {};
let closing;
const close = () => closing ||= (async () => {
  await stopWorker(); await new Promise(resolve => server.close(resolve)); await db.$disconnect(); delay.disable();
})();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void close().finally(() => process.exit(0)); });
process.once("disconnect", () => { void close().finally(() => process.exit(0)); });
const poll = async () => {
  activePolls++; polls++;
  try {
    for (const row of pollRows) {
      const conference = { name: `conferenceRecords/${row.id}`, space: `spaces/${row.id}`, startTime: row.startsAt.toISOString() };
      await checkOnlineMeeting(row.id, row.facultyId, { db, getToken: async () => "mock-only", fetcher: async input => {
        const url = new URL(input);
        if (url.origin !== "https://meet.googleapis.com" || !url.pathname.startsWith("/v2/")) throw new Error("Unexpected mock provider request");
        providerCalls++; await new Promise(resolve => setTimeout(resolve, 40));
        const path = url.pathname.slice(4);
        if (path.startsWith("spaces/")) return Response.json({ name: conference.space, meetingCode: row.meetUrl.split("/").at(-1) });
        if (path === "conferenceRecords") return Response.json({ conferenceRecords: [conference] });
        if (path === conference.name) return Response.json(conference);
        if (path.endsWith("/participants")) return Response.json({ participants: [] });
        throw new Error("Unexpected mock provider request");
      } });
    }
  } finally { activePolls--; }
};
let cpu = process.cpuUsage(), last = Date.now();
process.send({ ready: true, base: `http://127.0.0.1:${server.address().port}`, marker, tokens, users: Object.fromEntries(Object.entries(users).map(([role, u]) => [role, { id: u.id, email: u.email, name: u.name || u.fullName }])), week: week.start.toISOString().slice(0, 10), typeId: type.id, batchId: batches[0].id, dataset: { students: 1200, payments: 7200, faculty: 24, staff: 6, followUps: 1800, ledger: 2016, classes: 484, batches: 30 }, totals: { students: await db.student.count(), payments: await db.payment.count(), classes: await db.facultyOnlineClass.count() } });
process.on("message", async message => {
  try {
    let result = {};
    if (message.kind === "worker") { await stopWorker(); stopWorker = startMeetPollingWorker({ env: { ENABLE_MEET_POLLING: "true" }, poll }); }
    if (message.kind === "metrics") {
      const usage = process.cpuUsage(cpu), elapsed = Date.now() - last; cpu = process.cpuUsage(); last = Date.now();
      const connections = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()`;
      result = { queries, rssMB: process.memoryUsage().rss / 1048576, heapMB: process.memoryUsage().heapUsed / 1048576, cpuPercent: elapsed > 0 ? (usage.user + usage.system) / (elapsed * 1000) * 100 : null, loopP99Ms: delay.percentile(99) / 1e6, connections: connections[0].count, polls, activePolls, providerCalls };
      delay.reset();
    }
    if (message.kind === "stop") { await close(); process.send({ request: message.request, stopped: true }); process.exit(0); }
    process.send({ request: message.request, ...result });
  } catch (error) { process.send({ request: message.request, error: error.code || error.name }); }
});
