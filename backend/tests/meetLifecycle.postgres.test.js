import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("authenticated routes and restarted worker finish the bound conference, not a later call on its link", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true", timeout: 60000 }, async t => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { encryptGoogleSecret } = await import("../services/facultyGoogleService.js");
  const { checkOnlineMeeting, pollOnlineMeetings, startMeetPollingWorker } = await import("../services/meetVerificationService.js");
  const { addSession } = await import("../utils/sessionStore.js");
  const originalFetch = globalThis.fetch;
  const envNames = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "GOOGLE_TOKEN_ENCRYPTION_KEY", "FRONTEND_URL"];
  const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const key = randomBytes(32);
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "isolated-client", GOOGLE_CLIENT_SECRET: "isolated-secret", GOOGLE_REDIRECT_URI: "https://backend.example.invalid/api/faculty/google/callback", GOOGLE_TOKEN_ENCRYPTION_KEY: key.toString("base64"), FRONTEND_URL: "https://frontend.example.invalid" });
  let server, stopWorker;
  t.after(async () => {
    if (stopWorker) await stopWorker();
    if (server) await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await db.$disconnect();
  });
  const now = new Date(), createdAt = new Date(+now - 7200000);
  const start = new Date(Math.floor((+now - 3600000) / 60000) * 60000), end = new Date(+start + 1800000);
  const faculty = await db.faculty.create({ data: { facultyId: `LIFE_${randomUUID()}`, username: randomUUID(), passwordHash: "TEST_LOGIN_DISABLED", fullName: "Lifecycle Teacher", phone: randomUUID(), joiningDate: createdAt, salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
  const type = await db.extraIncentiveType.findFirst({ where: { name: "ONLINE DOUBT CLASS" } }) || await db.extraIncentiveType.create({ data: { name: "ONLINE DOUBT CLASS", rate: 237 } });
  const batch = await db.onlineClassBatch.create({ data: { name: `Lifecycle ${randomUUID()}`, normalizedName: randomUUID() } });
  await db.facultyGoogleConnection.create({ data: { facultyId: faculty.id, googleSubject: "teacher", identityVerifiedAt: createdAt, connectedAt: createdAt, status: "CONNECTED", scope: "openid https://www.googleapis.com/auth/meetings.space.readonly", expiresAt: new Date(+now + 3600000), accessTokenEncrypted: encryptGoogleSecret("isolated-access", key, `${faculty.id}:access`) } });
  const token = async (role, id) => {
    const jti = randomUUID(); await addSession(role, id, jti, Date.now() + 600000);
    return jwt.sign({ id, role, jti }, process.env.JWT_SECRET, { expiresIn: "10m" });
  };
  const owner = await token("faculty", faculty.id);
  const admin = await db.admin.create({ data: { email: `${randomUUID()}@example.invalid`, password: "TEST_LOGIN_DISABLED", name: "Lifecycle Admin" } });
  const adminToken = await token("admin", admin.id);
  const app = express(); app.use(express.json());
  app.use("/api/faculty-extra-incentives", (await import("../routes/facultyextraincentiveroute.js")).default);
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/faculty-extra-incentives`;
  const request = async (path, auth = owner, method = "GET", body) => {
    const response = await originalFetch(base + path, { method, headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const states = new Map(), paths = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.hostname !== "meet.googleapis.com") return originalFetch(input, options);
    const path = url.pathname.slice(4); paths.push(path);
    const state = [...states.values()].find(s => path === `spaces/${s.code}` || path.startsWith(s.name));
    let body;
    if (path === "conferenceRecords") {
      const space = /space.name = "([^"]+)"/.exec(url.searchParams.get("filter"))?.[1];
      const s = [...states.values()].find(s => s.space === space);
      assert.ok(s, "Only test-owned spaces may be requested");
      const extra = { name: `conferenceRecords/other-${s.id}`, space: s.space, startTime: new Date(+start + 1900000).toISOString(), endTime: new Date(+start + 2000000).toISOString() };
      // Once a link is reused, Google list discovery deliberately omits the original.
      body = { conferenceRecords: s.ambiguous ? [s.conference(), extra] : s.reused ? [extra] : [s.conference()] };
    } else {
      assert.ok(state, "Only the exact saved conference may be requested");
      if (path.startsWith("spaces/")) body = { name: state.space, meetingCode: state.code };
      else if (path === state.name) body = state.conference();
      else if (path === `${state.name}/participants`) body = url.searchParams.has("pageToken") ? { participants: [{ name: `${state.name}/participants/peer`, signedinUser: { user: "users/peer", displayName: "Lifecycle Peer" } }] } : { participants: [{ name: `${state.name}/participants/teacher`, signedinUser: { user: "users/teacher", displayName: "Lifecycle Teacher" } }], nextPageToken: "peer" };
      else if (path.endsWith("/participantSessions")) {
        const teacher = path.includes("/teacher/");
        const left = !state.pendingSessions && state.phase !== "live" && (teacher || state.phase !== "teacher-left");
        const second = url.searchParams.has("pageToken");
        const finish = teacher ? new Date(+start + 600000) : end;
        body = { participantSessions: [{ name: `${path}/${second ? "second" : "first"}`, startTime: second ? new Date(+start + 300000).toISOString() : start.toISOString(), endTime: left ? finish.toISOString() : null }], ...(!second ? { nextPageToken: "session" } : {}) };
      } else throw new Error("Unexpected Google request");
    }
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  };
  const format = value => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
  const time = value => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
  const create = async () => {
    const letters = randomUUID().replaceAll("-", "").slice(0, 10).replace(/[0-9]/g, digit => String.fromCharCode(97 + Number(digit)));
    const code = `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`;
    const { record } = await request("/my/online-classes", owner, "POST", { requestId: randomUUID(), incentiveTypeId: type.id, batchIds: [batch.id], topic: "Lifecycle fixture", date: format(start), startTime: time(start), endTime: time(end), meetUrl: `https://meet.google.com/${code}` });
    // Fixture creation predates the conference; no real scheduling clock is changed.
    await db.facultyOnlineClass.update({ where: { id: record.id }, data: { createdAt, nextCheckAt: null } });
    const s = { id: record.id, code, name: `conferenceRecords/lifecycle-${randomUUID()}`, space: `spaces/${randomUUID()}`, phase: "live", reused: false, ambiguous: false };
    s.conference = () => ({ name: s.name, space: s.space, startTime: start.toISOString(), endTime: s.phase === "ended" ? end.toISOString() : null });
    states.set(s.id, s); return s;
  };
  const due = s => db.facultyOnlineClass.update({ where: { id: s.id }, data: { nextCheckAt: null } });
  const check = async (s, auth = owner) => (await request(auth === adminToken ? `/admin/online-classes/${s.id}/check` : `/my/online-classes/${s.id}/check`, auth, "POST")).record;
  const runWorker = async () => {
    let finish; const done = new Promise(resolve => { finish = resolve; });
    stopWorker = startMeetPollingWorker({ env: { ENABLE_MEET_POLLING: "true" }, poll: async () => {
      try { await pollOnlineMeetings({ db, check: (id, facultyId, options) => states.has(id) ? checkOnlineMeeting(id, facultyId, options) : undefined }); } finally { finish(); }
    } });
    await done; await stopWorker(); stopWorker = null;
  };

  await t.test("route discovers Live atomically; teacher departure and even empty attendance do not prove conference end", async () => {
    const s = await create();
    assert.equal((await check(s)).status, "LIVE");
    const persisted = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(persisted.conferenceName, s.name);
    assert.equal(persisted.attendanceEvidence.conference.name, s.name);
    assert.equal(+persisted.actualStartAt, +start);
    assert.equal(persisted.attendanceEvidence.conference.space, persisted.conferenceSpace);
    s.reused = true;
    const discoveries = paths.filter(p => p === "conferenceRecords").length;
    for (const phase of ["teacher-left", "everyone-left"]) {
      s.phase = phase; await due(s); await runWorker();
      const current = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: s.id } });
      assert.equal(current.status, "LIVE"); assert.equal(current.actualEndAt, null); assert.equal(current.incentiveEntryId, null);
    }
    s.phase = "ended"; await due(s); await runWorker();
    const final = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(final.status, "COMPLETED"); assert.equal(final.verificationStatus, "VERIFIED");
    assert.equal(+final.actualEndAt, +end); assert.equal(+final.completedAt, +end);
    assert.ok(final.attendanceCompleteAt); assert.equal(final.attendanceEvidence.summary.teacherVerified, true);
    assert.equal(final.attendanceEvidence.summary.totalParticipants, 2);
    assert.equal(final.attendanceEvidence.summary.verifiedNonTeacher, 1);
    assert.deepEqual(final.attendanceEvidence.summary.participants.map(p => p.durationSeconds), [600, 1800]);
    assert.equal(paths.filter(p => p === "conferenceRecords").length, discoveries, "Bound checks never rediscover a reused link");
    const pdf = await originalFetch(`${base}/online-classes/${s.id}/attendance.pdf`, { headers: { Authorization: `Bearer ${owner}` } });
    assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
    const entry = await db.facultyExtraIncentiveEntry.findUniqueOrThrow({ where: { id: final.incentiveEntryId } });
    assert.equal(Number(entry.rateSnapshot), Number(type.rate)); assert.equal(entry.quantityChange, 1);
    assert.equal((await check(s, adminToken)).status, "COMPLETED");
  });

  await t.test("previous ambiguous bound records recover after worker restart and manual checks; simultaneous checks credit once", async () => {
    for (const mode of ["worker", "manual"]) {
      const s = await create(); await check(s);
      await db.facultyOnlineClass.update({ where: { id: s.id }, data: { verificationStatus: "AMBIGUOUS_REVIEW", verificationError: "Prior discovery found several conferences", nextCheckAt: null } });
      s.phase = "ended"; s.reused = true;
      const discoveries = paths.filter(p => p === "conferenceRecords").length;
      if (mode === "worker") await runWorker(); else await Promise.all([check(s), check(s), runWorker()]);
      const saved = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: s.id } });
      assert.equal(saved.status, "COMPLETED"); assert.equal(saved.verificationStatus, "VERIFIED");
      assert.equal(paths.filter(p => p === "conferenceRecords").length, discoveries);
      await Promise.all([check(s), check(s), runWorker()]);
      assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { onlineClass: { id: s.id } } }), 1);
    }
  });

  await t.test("unbound genuine ambiguity remains review-only through route and worker", async () => {
    const s = await create(); s.ambiguous = true; s.phase = "ended";
    const result = await check(s); assert.equal(result.verificationStatus, "AMBIGUOUS_REVIEW");
    await due(s); const count = paths.length; await runWorker(); assert.equal(paths.length, count);
    await check(s, adminToken);
    const saved = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(saved.conferenceName, null); assert.equal(saved.incentiveEntryId, null);
    assert.equal(saved.verificationStatus, "AMBIGUOUS_REVIEW");
    assert.equal(saved.attendanceEvidence.candidates.length, 2);
  });

  await t.test("ended conference waits for final session data before completion and PDF readiness", async () => {
    const s = await create(); await check(s); s.phase = "ended"; s.pendingSessions = true; s.reused = true; await due(s);
    const pending = await check(s);
    assert.equal(pending.status, "LIVE"); assert.equal(pending.liveConfirmed, false);
    assert.equal(pending.verificationStatus, "ATTENDANCE_PENDING");
    assert.equal(pending.canDownloadAttendance, false); assert.equal(pending.incentive, null);
    assert.equal(+new Date(pending.actualEndAt), +end);
    const waiting = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: s.id } });
    assert.ok(waiting.nextCheckAt <= new Date(Date.now() + 65000), "Pending final attendance must not enter the one-hour ended-conference cooldown");
    s.pendingSessions = false; await due(s); await runWorker();
    const saved = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: s.id } });
    assert.equal(saved.status, "COMPLETED"); assert.equal(saved.verificationStatus, "VERIFIED");
    assert.ok(saved.attendanceCompleteAt); assert.ok(saved.incentiveEntryId);
  });

  await t.test("failed credit rolls back completion/report readiness and retry finishes the same conference once", async () => {
    const s = await create(); await check(s); s.phase = "ended"; s.reused = true; await due(s);
    const name = `meet_failure_${randomUUID().replaceAll("-", "")}`;
    // Generated identifiers/resources contain no quotes; this fault exists only
    // in the guarded disposable database and is removed even on assertion failure.
    assert.match(s.name, /^conferenceRecords\/[a-zA-Z0-9_-]+$/);
    await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated credit failure'; END $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "FacultyExtraIncentiveEntry" FOR EACH ROW WHEN (NEW.note = 'Google Meet verified: ${s.name}') EXECUTE FUNCTION "${name}"()`);
      const failed = await check(s);
      assert.equal(failed.verificationStatus, "DATABASE_ERROR");
      const saved = await db.facultyOnlineClass.findUniqueOrThrow({ where: { id: s.id } });
      assert.equal(saved.status, "LIVE"); assert.equal(saved.attendanceCompleteAt, null); assert.equal(saved.incentiveEntryId, null);
      assert.equal(saved.conferenceName, s.name); assert.equal(saved.pollLeaseToken, null);
      assert.equal(failed.canDownloadAttendance, false);
      const pdf = await originalFetch(`${base}/online-classes/${s.id}/attendance.pdf`, { headers: { Authorization: `Bearer ${owner}` } });
      assert.equal(pdf.status, 409);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "FacultyExtraIncentiveEntry"`);
      await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
    }
    await due(s); assert.equal((await check(s)).verificationStatus, "VERIFIED");
    await Promise.all([check(s), check(s)]);
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { onlineClass: { id: s.id } } }), 1);
  });
});
