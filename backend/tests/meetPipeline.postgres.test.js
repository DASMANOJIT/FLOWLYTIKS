import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { spawnSync } from "node:child_process";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("real Meet persistence deduplicates concurrent checks and exposes owner/Admin-only parseable attendance PDF", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { checkOnlineMeeting, pollOnlineMeetings } = await import("../services/meetVerificationService.js");
  const { addSession } = await import("../utils/sessionStore.js");
  const id = randomUUID(), conferenceName = `conferenceRecords/${randomUUID()}`;
  const letters = id.replaceAll("-", "").slice(0, 10).split("").map(c => String.fromCharCode(97 + parseInt(c, 16))).join("");
  const meetCode = `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`;
  const now = new Date(), start = new Date(+now - 3600000), end = new Date(+now - 1800000);
  const connectedAt = new Date(+now - 7200000);
  const faculty = await db.faculty.create({ data: { id, facultyId: `PIPE_${id}`, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Pipeline Teacher", phone: id, joiningDate: now, salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
  const type = await db.extraIncentiveType.create({ data: { name: `Pipeline ${id}`, rate: 237 } });
  await db.facultyGoogleConnection.create({ data: { facultyId: id, googleSubject: "teacher1", identityVerifiedAt: connectedAt, scope: "openid https://www.googleapis.com/auth/meetings.space.readonly", connectedAt } });
  const batches = await Promise.all(["Pipeline Batch A", "Pipeline Batch B"].map(name => db.onlineClassBatch.create({ data: { name, normalizedName: `${name.toLowerCase()}-${id}` } })));
  const row = await db.facultyOnlineClass.create({ data: { facultyId: id, incentiveTypeId: type.id, requestId: randomUUID(), batchName: "Legacy snapshot", className: "", topic: "Pipeline Topic", startsAt: start, endsAt: end, meetUrl: `https://meet.google.com/${meetCode}`, trackingEnabled: true, createdAt: connectedAt, batches: { create: batches.map(batch => ({ batchId: batch.id, nameSnapshot: batch.name })) } } });
  const conference = { name: conferenceName, space: "spaces/pipeline", startTime: start.toISOString(), endTime: end.toISOString() };
  let calls = 0;
  const fetcher = async input => {
    calls++;
    const url = new URL(input), resource = url.pathname.slice(4);
    let body;
    if (resource === `spaces/${meetCode}`) body = { name: "spaces/pipeline", meetingCode: meetCode };
    else if (resource === "conferenceRecords") body = { conferenceRecords: [conference] };
    else if (resource === conferenceName) body = conference;
    else if (resource === `${conferenceName}/participants`) body = url.searchParams.has("pageToken") ? { participants: [{ name: `${conferenceName}/participants/student`, signedinUser: { user: "users/student1", displayName: "Pipeline Participant" } }] } : { participants: [{ name: `${conferenceName}/participants/teacher`, signedinUser: { user: "users/teacher1", displayName: "Pipeline Teacher" } }], nextPageToken: "second" };
    else if (resource.endsWith("/participantSessions")) body = url.searchParams.has("pageToken") ? { participantSessions: [{ name: `${resource}/rejoin`, startTime: new Date(+start + 600000).toISOString(), endTime: end.toISOString() }] } : { participantSessions: [{ name: `${resource}/first`, startTime: start.toISOString(), endTime: new Date(+start + 900000).toISOString() }], nextPageToken: "reconnect" };
    else throw new Error("Unexpected mocked Google resource");
    return new Response(JSON.stringify(body));
  };
  let server;
  try {
    const check = () => checkOnlineMeeting(row.id, id, { db, fetcher, getToken: async () => "mock-google-token", now });
    await Promise.all([check(), check(), pollOnlineMeetings({ db, now, check: async classId => classId === row.id ? check() : undefined })]);
    const saved = await db.facultyOnlineClass.findUnique({ where: { id: row.id } });
    assert.equal(saved.status, "COMPLETED"); assert.equal(saved.verificationStatus, "VERIFIED");
    assert.equal(saved.pollLeaseToken, null); assert.equal(saved.pollLeaseUntil, null);
    assert.equal(saved.attendanceEvidence.summary.totalParticipants, 2);
    assert.equal(saved.attendanceEvidence.summary.excludingTeacher, 1);
    assert.ok(saved.attendanceEvidence.summary.participants.every(p => p.durationSeconds === 1800));
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId: id } }), 1);
    assert.equal(Number((await db.facultyExtraIncentiveEntry.findUnique({ where: { id: saved.incentiveEntryId } })).amountSnapshot), 237);
    const before = calls; await check();
    assert.equal(calls, before);
    await pollOnlineMeetings({ db, now: new Date(+now + 3600000), check: async classId => classId === row.id ? check() : undefined });
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId: id } }), 1);
    const token = async (role, accountId) => { const jti = randomUUID(); await addSession(role, accountId, jti, +now + 600000); return jwt.sign({ id: accountId, role, jti }, process.env.JWT_SECRET, { expiresIn: "10m" }); };
    const owner = await token("faculty", faculty.id);
    const admin = await db.admin.findFirst(); const adminToken = await token("admin", admin.id);
    const otherId = randomUUID();
    const other = await db.faculty.create({ data: { facultyId: `FOREIGN_${otherId}`, username: otherId, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Other Teacher", phone: otherId, joiningDate: now, salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
    const foreignToken = await token("faculty", other.id);
    const student = await db.student.create({ data: { name: "PDF Student", phone: randomUUID(), password: "TEST_LOGIN_DISABLED", school: "Test", class: "8", isVerified: true } });
    const studentToken = await token("student", student.id);
    const app = express(); app.use("/api/faculty-extra-incentives", (await import("../routes/facultyextraincentiveroute.js")).default);
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/faculty-extra-incentives`;
    const url = `${base}/online-classes/${row.id}/attendance.pdf`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${foreignToken}` } })).status, 404);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${studentToken}` } })).status, 403);
    const staff = await db.staff.create({ data: { name: "PDF Staff", email: `pdf-${randomUUID()}@example.invalid`, passwordHash: "TEST_LOGIN_DISABLED", verifiedAt: now, createdByAdminId: admin.id } });
    const staffToken = await token("staff", staff.id);
    assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${staffToken}` } })).status, 403);
    for (const batch of batches) {
      for (const [path, auth] of [[`/my/online-classes?historyFilters=true&batch=${encodeURIComponent(batch.name)}`, owner], [`/admin/online-classes?facultyId=${id}&batch=${encodeURIComponent(batch.name)}`, adminToken]]) {
        const response = await fetch(base + path, { headers: { Authorization: `Bearer ${auth}` } });
        assert.equal(response.status, 200); const history = await response.json();
        assert.equal(history.total, 1); assert.equal(history.records[0].id, row.id);
        assert.deepEqual(new Set(history.records[0].batchNames), new Set(batches.map(b => b.name)));
        assert.equal(history.records[0].status, "COMPLETED");
      }
    }
    for (const [path, auth] of [[`/my/online-classes/${row.id}`, owner], [`/admin/online-classes/${row.id}`, adminToken]]) {
      assert.equal((await fetch(base + path, { method: "DELETE", headers: { Authorization: `Bearer ${auth}` } })).status, 409);
    }
    for (const auth of [owner, adminToken]) {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${auth}` } });
      assert.equal(response.status, 200); assert.match(response.headers.get("content-type"), /application\/pdf/);
      assert.match(response.headers.get("content-disposition"), /attachment/); assert.equal(response.headers.get("cache-control"), "private, no-store");
      const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
      const parser = spawnSync(process.env.TEST_PDF_PYTHON || "python3", ["-c", "import sys,io;from pypdf import PdfReader;r=PdfReader(io.BytesIO(sys.stdin.buffer.read()));print('\\n'.join(p.extract_text() for p in r.pages))"], { input: bytes, encoding: "utf8" });
      assert.equal(parser.status, 0, "PDF text parsing needs pypdf in the configured TEST_PDF_PYTHON runtime");
      for (const text of ["Pipeline Teacher", "Pipeline Topic", "Pipeline Batch A", "Pipeline Batch B", "Pipeline Participant", "IST", "30m 0s"]) assert.ok(parser.stdout.includes(text), text);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.$disconnect();
  }
});
