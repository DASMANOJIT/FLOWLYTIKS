import test from "node:test";
import assert from "node:assert/strict";
import { meetingFailure, matchConferences, conferenceFilter, MEET_START_TOLERANCE_MS, attendanceSummary, googleTeacherIdentity, meetClient, checkOnlineMeeting, pollOnlineMeetings, startMeetPollingWorker } from "../services/meetVerificationService.js";
import { getMeetingAttendance, buildMeetAttendancePdf } from "../services/meetAttendancePdfService.js";
import { transitionOnlineClass } from "../services/facultyOnlineClassService.js";
import { GOOGLE_MEET_SCOPE } from "../services/facultyGoogleService.js";

const now = new Date("2026-10-11T13:00:00Z");
const conference = { name: "conferenceRecords/current", space: "spaces/space-one", startTime: "2026-10-11T12:00:00Z", endTime: "2026-10-11T12:45:00Z", expireTime: "2026-11-10T12:45:00Z" };
const oldConference = { ...conference, name: "conferenceRecords/old", startTime: "2026-10-10T12:00:00Z", endTime: "2026-10-10T12:45:00Z" };
const row = () => ({ id: "class-one", facultyId: "faculty-one", incentiveTypeId: "type-one", trackingEnabled: true, startsAt: new Date("2026-10-11T11:30:00Z"), endsAt: new Date("2026-10-11T12:30:00Z"), createdAt: new Date("2026-10-11T11:00:00Z"), updatedAt: now, meetUrl: "https://meet.google.com/abc-defg-hij", topic: "Doubt class", batchName: "Batch A", className: "10", status: "SCHEDULED", verificationStatus: "PENDING", pollAttempts: 0, nextCheckAt: null, pollLeaseUntil: null, pollLeaseToken: null, faculty: { fullName: "Test Teacher", facultyId: "FAC_TEST" } });
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return value.every(v => matches(row, v));
    if (key === "OR") return value.some(v => matches(row, v));
    if (value && typeof value === "object" && !(value instanceof Date)) return Object.entries(value).every(([op, v]) => op === "not" ? row[key] !== v : op === "notIn" ? !v.includes(row[key]) : op === "lte" ? row[key] != null && row[key] <= v : op === "gt" ? row[key] > v : op === "startsWith" ? String(row[key]).startsWith(v) : false);
    return value === null ? row[key] == null : row[key] === value;
  });
}
export function fixture() {
  const rows = [row()], entries = [];
  const connection = { status: "CONNECTED", connectedAt: now, facultyId: "faculty-one", googleSubject: "teacher-id", identityVerifiedAt: now };
  const attach = r => r && structuredClone({ ...r, incentiveEntry: entries.find(e => e.id === r.incentiveEntryId) || null });
  const update = (r, data) => { for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === "object" && "increment" in v ? r[k] + v.increment : structuredClone(v); };
  let queue = Promise.resolve();
  const db = {
    rows, entries, connection, $queryRaw: async () => [],
    facultyGoogleConnection: { findUnique: async () => ({ ...connection }), updateMany: async ({ data }) => { Object.assign(connection, data); return { count: 1 }; } },
    extraIncentiveType: { findUnique: async () => ({ id: "type-one", rate: 237.5, isActive: true }) },
    facultyExtraIncentiveOperationLock: { findUnique: async () => null },
    facultyExtraIncentiveEntry: { create: async ({ data }) => { const entry = { ...data, id: `entry-${entries.length}` }; entries.push(entry); return entry; } },
    facultyOnlineClass: {
      findFirst: async ({ where }) => attach(rows.find(r => matches(r, where))),
      findUnique: async ({ where }) => attach(rows.find(r => matches(r, where))),
      findMany: async ({ where }) => rows.filter(r => matches(r, where)).map(attach),
      updateMany: async ({ where, data }) => { const selected = rows.filter(r => matches(r, where)); for (const r of selected) { if (data.conferenceName && rows.some(o => o.id !== r.id && o.conferenceName === data.conferenceName)) throw Object.assign(new Error("Unique conference"), { code: "P2002" }); update(r, data); } return { count: selected.length }; },
      update: async ({ where, data }) => { const r = rows.find(r => matches(r, where)); update(r, data); return attach(r); },
    },
    $transaction: work => { const next = queue.then(() => work(db)); queue = next.catch(() => {}); return next; },
  };
  return db;
}
const json = data => ({ ok: true, status: 200, json: async () => data });
function provider({ ended = true, unknownTeacher = false, ambiguous = false, sessionFailure = false, onParticipant = async () => {} } = {}) {
  const calls = [];
  const fetcher = async input => {
    const url = new URL(input); calls.push(url.pathname + (url.searchParams.get("pageToken") || ""));
    if (url.pathname.includes("tokeninfo")) return json({ audience: "controlled-client", issued_to: "controlled-client", expires_in: 3600, scope: GOOGLE_MEET_SCOPE, ...(unknownTeacher ? {} : { user_id: "teacher-id" }) });
    if (url.pathname.endsWith("spaces/abc-defg-hij")) return json({ name: conference.space, meetingCode: "abc-defg-hij" });
    if (url.pathname.endsWith("conferenceRecords")) return json(url.searchParams.has("pageToken") ? { conferenceRecords: [conference, ...(ambiguous ? [{ ...conference, name: "conferenceRecords/second" }] : [])].map(c => ({ ...c, endTime: ended ? c.endTime : null })) } : { conferenceRecords: [oldConference], nextPageToken: "c-next" });
    if (url.pathname.endsWith("conferenceRecords/current")) return json({ ...conference, endTime: ended ? conference.endTime : null });
    if (url.pathname.endsWith("/participants")) {
      await onParticipant();
      return json(url.searchParams.has("pageToken") ? { participants: [{ name: `${conference.name}/participants/teacher-two`, signedinUser: { user: "users/teacher-id", displayName: "Teacher renamed" } }, { name: `${conference.name}/participants/student`, signedinUser: { user: "users/other-id", displayName: "Participant (not claimed student)" } }] } : { participants: [{ name: `${conference.name}/participants/teacher-one`, signedinUser: { user: "users/teacher-id", displayName: "Teacher" } }], nextPageToken: "p-next" });
    }
    if (url.pathname.endsWith("participantSessions")) {
      if (sessionFailure) return { ok: false, status: 429, headers: { get: () => "120" } };
      const parent = url.pathname.slice(4, -20);
      const second = url.searchParams.has("pageToken");
      return json({ participantSessions: [{ name: `${parent}/participantSessions/${second ? "second" : "first"}`, startTime: second ? "2026-10-11T12:10:00Z" : "2026-10-11T12:00:00Z", endTime: ended ? second ? "2026-10-11T12:45:00Z" : "2026-10-11T12:20:00Z" : null }], ...(second ? {} : { nextPageToken: "s-next" }) });
    }
    throw new Error("Unexpected mocked provider path");
  };
  return { fetcher, calls };
}
const options = (db, p, extra = {}) => ({ db, now, fetcher: p.fetcher, env: { GOOGLE_CLIENT_ID: "controlled-client" }, getToken: async () => "controlled-access", ...extra });

test("Google end received after check-start clock completes lifecycle independently of incentive review", async () => {
  const db = fixture();
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider(), { now: new Date("2026-10-11T12:44:59Z") }));
  assert.equal(result.status, "COMPLETED");
  assert.notEqual(result.verificationStatus, "LIVE");
  assert.equal(result.actualDurationSeconds, 2700);
});

test("ended evidence survives a later stale live conference response and incomplete attendance", async () => {
  for (const partial of [false, true]) {
    const db = fixture(), p = provider({ sessionFailure: partial });
    let reads = 0;
    const fetcher = input => new URL(input).pathname.endsWith(conference.name) && ++reads > 1 ? json({ ...conference, endTime: null }) : p.fetcher(input);
    const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p, { fetcher }));
    assert.equal(result.status, "COMPLETED");
    assert.equal(+result.actualEndAt, +new Date(conference.endTime));
    assert.notEqual(result.verificationStatus, "LIVE");
    if (partial) assert.equal(db.entries.length, 0);
  }
});

test("nullable schedules use a bounded start window and stale LIVE verification can recover before its old cooldown", async () => {
  const db = fixture(); db.rows[0].startsAt = new Date(conference.startTime); db.rows[0].endsAt = null;
  const filter = conferenceFilter(db.rows[0], conference.space);
  assert.match(filter, /2026-10-11T11:45:00.000Z/); assert.match(filter, /2026-10-11T12:15:00.000Z/);
  assert.equal(matchConferences([{ ...conference, startTime: "2026-10-11T12:15:00Z" }], db.rows[0], conference.space).length, 0);
  await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ ended: false })));
  Object.assign(db.rows[0], { actualEndAt: new Date(conference.endTime), attendanceCompleteAt: now, nextCheckAt: new Date(+now + 3600000) });
  db.rows[0].attendanceEvidence.conference.endTime = conference.endTime;
  const p = provider({ ambiguous: true });
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p));
  assert.equal(result.status, "COMPLETED"); assert.equal(result.verificationStatus, "VERIFIED");
  assert.equal(p.calls.includes("/v2/conferenceRecords"), false);
  assert.equal(db.entries.length, 1);
});

test("a previously live conference becoming ambiguous is review-required, not confirmed live", async () => {
  const db = fixture();
  const live = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ ended: false })));
  assert.equal(live.status, "LIVE");
  const retained = db.rows[0].conferenceName;
  db.rows[0].actualStartAt = new Date(+db.rows[0].actualStartAt - 1000);
  const retryAt = new Date(+db.rows[0].nextCheckAt + 1);
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ ambiguous: true }), { now: retryAt }));
  assert.equal(result.verificationStatus, "AMBIGUOUS_REVIEW");
  assert.equal(result.liveConfirmed, false);
  assert.equal(result.status, "LIVE", "Keep the protected lifecycle; do not permit cancellation/deletion by downgrading it");
  assert.equal(db.rows[0].conferenceName, retained);
  assert.equal(db.rows[0].attendanceEvidence.candidates.length, 3);
  assert.equal(db.entries.length, 0);
  let automaticChecks = 0;
  await pollOnlineMeetings({ db, now: new Date(+db.rows[0].nextCheckAt + 1), check: async () => { automaticChecks++; } });
  assert.equal(automaticChecks, 0, "Genuine ambiguity remains for review, not automatic selection");
  const repeated = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ ambiguous: true }), { now: new Date(+db.rows[0].nextCheckAt + 1) }));
  assert.equal(repeated.liveConfirmed, false);
  assert.equal(repeated.verificationStatus, "AMBIGUOUS_REVIEW");
  assert.equal(db.entries.length, 0);
});

test("proven live association survives separate restarted conferences and completes only its own evidence", async () => {
  const db = fixture();
  await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ ended: false })));
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ ambiguous: true }), { now: new Date(+db.rows[0].nextCheckAt + 1) }));
  assert.equal(result.conferenceName, conference.name);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.verificationStatus, "VERIFIED");
  assert.equal(+result.actualEndAt, +new Date(conference.endTime));
  assert.equal(db.rows[0].attendanceEvidence.candidates.length, 2, "Retain discovery evidence; do not rediscover on a bound conference");
  await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ ambiguous: true })));
  assert.equal(db.entries.length, 1);
});

test("duplicate candidate pages do not become distinct conferences", () => {
  assert.deepEqual(matchConferences([conference, conference, { ...conference }], row(), conference.space), [conference]);
});

test("fresh conference identity or start-time changes invalidate an established association", async () => {
  for (const changed of [{ name: "conferenceRecords/replaced" }, { startTime: "2026-10-11T12:00:01Z" }, { space: "spaces/other" }]) {
    const db = fixture();
    await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ ended: false })));
    const p = provider({ ambiguous: true });
    const fetcher = input => new URL(input).pathname.endsWith(conference.name) ? json({ ...conference, ...changed }) : p.fetcher(input);
    const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p, { fetcher, now: new Date(+db.rows[0].nextCheckAt + 1) }));
    assert.equal(result.verificationStatus, "MATCH_REVIEW");
    assert.equal(result.liveConfirmed, false);
    assert.equal(result.conferenceName, conference.name);
    assert.equal(db.entries.length, 0);
  }
});

test("same conference live-to-ended refresh credits once and repeated checks retain completion", async () => {
  const db = fixture();
  const live = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ ended: false })));
  assert.equal(live.liveConfirmed, true);
  assert.equal(db.entries.length, 0);
  const ended = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider(), { now: new Date(+db.rows[0].nextCheckAt + 1) }));
  assert.equal(ended.status, "COMPLETED");
  assert.equal(ended.liveConfirmed, false);
  assert.equal(ended.verificationStatus, "VERIFIED");
  assert.equal(+ended.actualEndAt, +new Date(conference.endTime));
  await checkOnlineMeeting("class-one", "faculty-one", options(db, provider()));
  assert.equal(db.entries.length, 1);
});

test("automatic credit waits while an incentive payout holds the accounting lease", async () => {
  const db = fixture();
  db.facultyExtraIncentiveOperationLock.findUnique = async () => ({ expiresAt: new Date(Date.now() + 60000) });
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider()));
  assert.equal(db.entries.length, 0, "Do not change a payout's pending snapshot during its external transfer");
  assert.equal(result.verificationStatus, "INCENTIVE_BUSY");
  assert.equal(db.rows[0].conferenceName, conference.name);
  assert.equal(db.rows[0].pollLeaseToken, null);
  assert.ok(db.rows[0].nextCheckAt > now);
  db.facultyExtraIncentiveOperationLock.findUnique = async () => null;
  const retryAt = new Date(+db.rows[0].nextCheckAt + 1);
  await checkOnlineMeeting("class-one", "faculty-one", options(db, provider(), { now: retryAt }));
  assert.equal(db.entries.length, 1);
});

test("deleted class evidence blocks reused conferences even after an unpaid reversal", async () => {
  for (const retainedName of [conference.name, null]) {
    const db = fixture();
    db.rows[0].deletedAt = null;
    db.rows.push({ ...row(), id: "deleted-class", deletedAt: now, status: "CANCELLED", conferenceName: retainedName });
    const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider()));
    assert.equal(result.verificationStatus, "DUPLICATE_REVIEW");
    assert.equal(db.entries.length, 0);
  }
});

test("deletion during Google retrieval invalidates the worker and cannot create an incentive", async () => {
  const db = fixture();
  const p = provider({ onParticipant: async () => {
    Object.assign(db.rows[0], { deletedAt: now, status: "CANCELLED", pollLeaseToken: null, pollLeaseUntil: null });
  } });
  await checkOnlineMeeting("class-one", "faculty-one", options(db, p));
  assert.equal(db.entries.length, 0);
  assert.equal(db.rows[0].conferenceName, conference.name, "Conference evidence remains reserved");
  await assert.rejects(checkOnlineMeeting("class-one", "faculty-one", options(db, p)), { status: 404 });
});

test("database constraint and pool failures retain evidence, remain retryable and release only their own lease", async () => {
  for (const error of [Object.assign(new Error("private DB detail"), { code: "23514" }), Object.assign(new Error("pool timeout"), { code: "P2024" })]) {
    const db = fixture(), original = db.facultyOnlineClass.updateMany;
    db.facultyOnlineClass.updateMany = args => args.data.status === "LIVE" ? Promise.reject(error) : original(args);
    const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ ended: false })));
    assert.equal(result.verificationStatus, error.code === "P2024" ? "DATABASE_BUSY" : "DATABASE_ERROR");
    assert.equal(db.rows[0].attendanceEvidence.conference.name, conference.name);
    assert.equal(db.rows[0].pollLeaseToken, null); assert.ok(db.rows[0].nextCheckAt > now); assert.equal(db.entries.length, 0);
    assert.ok(!result.verificationError.includes(error.message));
  }
  assert.equal(meetingFailure({ code: "P2004", meta: { database_error: { code: "23514" } } }).diagnostic.sqlState, "23514");
  const db = fixture();
  await checkOnlineMeeting("class-one", "faculty-one", options(db, provider({ onParticipant: async () => { db.rows[0].pollLeaseToken = "replacement-worker"; } })));
  assert.equal(db.rows[0].pollLeaseToken, "replacement-worker"); assert.equal(db.entries.length, 0);
});

test("stopping the worker drains its active check and schedules no overlapping work", async () => {
  let calls = 0, release;
  const stop = startMeetPollingWorker({ env: {}, poll: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  let stopped = false; const waiting = stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false); assert.equal(calls, 1);
  release(); await waiting; assert.equal(stopped, true); assert.equal(calls, 1);
});

test("real-response regression: a conference starting 30 seconds early is matched, including while live", () => {
  const scheduled = { startsAt: new Date("2026-10-11T17:52:00Z"), endsAt: new Date("2026-10-11T17:55:00Z") };
  const early = { name: "conferenceRecords/early", space: "spaces/example", startTime: "2026-10-11T17:51:30.081516Z", endTime: "2026-10-11T17:55:40.945547Z" };
  assert.deepEqual(matchConferences([early], scheduled, early.space), [early]);
  assert.equal(matchConferences([{ ...early, endTime: null }], scheduled, early.space).length, 1);
});

test("bounded filter and matcher agree at early/late limits and reject old reused calls", () => {
  const scheduled = row();
  const early = new Date(+scheduled.startsAt - MEET_START_TOLERANCE_MS);
  const late = new Date(+scheduled.endsAt + MEET_START_TOLERANCE_MS);
  assert.ok(conferenceFilter(scheduled, conference.space).includes(early.toISOString()));
  assert.ok(conferenceFilter(scheduled, conference.space).includes(late.toISOString()));
  const callAt = value => ({ ...conference, startTime: value.toISOString(), endTime: null });
  assert.equal(matchConferences([callAt(early)], scheduled, conference.space).length, 1);
  assert.equal(matchConferences([callAt(new Date(+early - 1)), callAt(late), oldConference], scheduled, conference.space).length, 0);
  assert.equal(matchConferences([callAt(new Date(+late - 1))], scheduled, conference.space).length, 1);
  assert.equal(matchConferences([callAt(early), { ...callAt(new Date(+early + 1)), name: "conferenceRecords/another" }], scheduled, conference.space).length, 2);
});

test("Google returns no conferences: pending retry is neutral, retains schedule and cannot credit", async () => {
  const db = fixture(), p = provider();
  const fetcher = input => new URL(input).pathname.endsWith("conferenceRecords") ? json({}) : p.fetcher(input);
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p, { fetcher }));
  assert.equal(result.verificationStatus, "MISSING_DATA"); assert.equal(result.verificationPending, true);
  assert.equal(result.status, "SCHEDULED"); assert.equal(db.entries.length, 0);
  assert.equal(+db.rows[0].nextCheckAt, +now + 60000);
  const retry = await checkOnlineMeeting("class-one", "faculty-one", options(db, p));
  assert.equal(retry.verificationPending, true); assert.match(retry.verificationMessage, /next automatic/);
});

test("early live provider response uses bounded filter and never creates a completion incentive", async () => {
  const db = fixture(), p = provider({ ended: false });
  db.rows[0].startsAt = new Date("2026-10-11T12:00:30Z"); db.rows[0].endsAt = new Date("2026-10-11T12:10:00Z");
  let query;
  const fetcher = input => { const url = new URL(input); if (url.pathname.endsWith("conferenceRecords")) query = url.searchParams.get("filter"); return p.fetcher(input); };
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p, { fetcher }));
  assert.equal(query, conferenceFilter(db.rows[0], conference.space));
  assert.equal(result.status, "LIVE"); assert.equal(result.actualEndAt, null); assert.equal(db.entries.length, 0);
  assert.equal(db.rows[0].attendanceEvidence.matching.toleranceMinutes, 15);
});

test("Google invalid query and permission errors remain genuine errors, not missing data", async () => {
  for (const [status, code] of [[400, "API_ERROR"], [403, "ACCESS_DENIED"], [404, "MISSING_DATA"]]) {
    const client = meetClient({ token: "controlled", refresh: async () => null, fetcher: async () => ({ ok: false, status }) });
    await assert.rejects(client.get("conferenceRecords"), { code });
  }
});

test("overlapping tolerance windows on duplicate classes require review without credit", async () => {
  const db = fixture();
  db.rows.push({ ...row(), id: "early-overlap", startsAt: new Date("2026-10-11T12:00:30Z"), endsAt: new Date("2026-10-11T12:10:00Z") });
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider()));
  assert.equal(result.verificationStatus, "DUPLICATE_REVIEW"); assert.equal(db.entries.length, 0);
});

test("reused links match only the saved scheduled window and exact space; ambiguous calls are retained for review", async () => {
  assert.deepEqual(matchConferences([oldConference, conference, { ...conference, space: "spaces/other" }], row(), conference.space), [conference]);
  const db = fixture(), p = provider({ ambiguous: true });
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p));
  assert.equal(result.verificationStatus, "AMBIGUOUS_REVIEW"); assert.equal(db.entries.length, 0);
  assert.equal(db.rows[0].attendanceEvidence.candidates.length, 3);
});

test("all conference/participant/session pages persist; reconnect overlap merges and configured rate is credited once", async () => {
  const db = fixture(), p = provider();
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p));
  assert.equal(result.verificationStatus, "VERIFIED"); assert.equal(result.conferenceName, conference.name);
  assert.equal(result.attendance.totalParticipants, 2); assert.equal(result.attendance.excludingTeacher, 1);
  assert.equal(result.attendance.participants[0].durationSeconds, 2700);
  assert.equal(result.attendance.participants[0].sessions.length, 4);
  assert.ok(p.calls.some(path => path.endsWith("participantSessionss-next")));
  assert.equal(db.entries.length, 1); assert.equal(db.entries[0].rateSnapshot, 237.5);
  await checkOnlineMeeting("class-one", "faculty-one", options(db, p)); assert.equal(db.entries.length, 1);
});

test("teacher departure and scheduled end never complete a live conference", async () => {
  const db = fixture(), p = provider({ ended: false });
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p));
  assert.equal(result.status, "LIVE"); assert.equal(result.actualEndAt, null); assert.equal(db.entries.length, 0);
});

test("unknown account identity is not guessed from display names, and missing signed-in peers require review", async () => {
  const db = fixture(), p = provider({ unknownTeacher: true });
  db.connection.googleSubject = null;
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p));
  assert.equal(result.verificationStatus, "TEACHER_IDENTITY_REVIEW"); assert.equal(result.attendance.excludingTeacher, null); assert.equal(db.entries.length, 0);
  const summary = attendanceSummary([{ name: "participant-one", displayName: "Teacher", sessions: [{ name: "s", startTime: conference.startTime, endTime: conference.endTime }] }], conference, "users/teacher-id");
  assert.equal(summary.teacherVerified, false);
  assert.equal(googleTeacherIdentity({ googleSubject: "teacher-id" }), null);
  assert.equal(googleTeacherIdentity({ googleSubject: "users/teacher-id", identityVerifiedAt: now }), null);
  assert.equal(googleTeacherIdentity(db.connection), null);
});

test("verified reconnection rechecks retained completed evidence and credits only once", async () => {
  const db = fixture(), p = provider();
  db.connection.googleSubject = null;
  await checkOnlineMeeting("class-one", "faculty-one", options(db, p));
  assert.equal(db.rows[0].verificationStatus, "TEACHER_IDENTITY_REVIEW");
  assert.equal(db.entries.length, 0);
  const retainedConference = db.rows[0].conferenceName;
  db.connection.googleSubject = "teacher-id";
  db.connection.identityVerifiedAt = new Date(+now + 3600001);
  db.connection.connectedAt = db.connection.identityVerifiedAt;
  const afterReconnect = new Date(+now + 3600001);
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p, { now: afterReconnect }));
  assert.equal(result.verificationStatus, "VERIFIED");
  assert.equal(db.rows[0].conferenceName, retainedConference);
  assert.equal(db.entries.length, 1);
  await checkOnlineMeeting("class-one", "faculty-one", options(db, p, { now: afterReconnect }));
  assert.equal(db.entries.length, 1);
});

test("API failures persist partial evidence and account backoff without marking paid or completed by schedule", async () => {
  const db = fixture(), p = provider({ sessionFailure: true });
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p));
  assert.equal(result.verificationStatus, "API_BACKOFF"); assert.equal(db.entries.length, 0);
  assert.ok(db.rows[0].attendanceEvidence.partialParticipants.length);
  assert.ok(db.connection.meetBackoffUntil >= new Date(+now + 120000));
  assert.equal(db.rows[0].pollLeaseToken, null);
});

test("cancellation cannot bypass protected completed evidence during provider calls", async () => {
  const db = fixture(); let cancelled = false;
  const p = provider({ onParticipant: async () => { if (!cancelled) { cancelled = true; await assert.rejects(transitionOnlineClass("faculty-one", "class-one", "cancel", db, now), { status: 409 }); } } });
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, p));
  assert.equal(result.status, "COMPLETED"); assert.equal(db.entries.length, 1); assert.equal(result.conferenceName, conference.name);
});

test("multiple batch associations still credit exactly one configured-rate incentive", async () => {
  const db = fixture();
  db.rows[0].batches = [{ batchId: "a", nameSnapshot: "Batch A" }, { batchId: "b", nameSnapshot: "Batch B" }];
  const result = await checkOnlineMeeting("class-one", "faculty-one", options(db, provider()));
  assert.equal(result.status, "COMPLETED"); assert.equal(db.entries.length, 1);
  assert.equal(db.entries[0].quantityChange, 1); assert.equal(Number(db.entries[0].rateSnapshot), 237.5);
  await checkOnlineMeeting("class-one", "faculty-one", options(db, provider()));
  assert.equal(db.entries.length, 1); assert.deepEqual(result.batchNames, ["Batch A", "Batch B"]);
  const report = await getMeetingAttendance("class-one", { id: "faculty-one", role: "faculty" }, db, now);
  assert.deepEqual(report.batches.map(batch => batch.nameSnapshot), ["Batch A", "Batch B"]);
  assert.ok((await buildMeetAttendancePdf(report)).subarray(0, 5).toString().startsWith("%PDF-"));
});

test("concurrent workers, duplicates and expired leases cannot double-credit; restart discovers due persisted work", async () => {
  const db = fixture(), p = provider();
  const checks = await Promise.allSettled([checkOnlineMeeting("class-one", "faculty-one", options(db, p)), checkOnlineMeeting("class-one", "faculty-one", options(db, p))]);
  assert.ok(checks.some(r => r.status === "fulfilled" && r.value.verificationPending && r.value.verificationMessage.includes("already running"))); assert.equal(db.entries.length, 1);
  const duplicate = fixture(); duplicate.rows.push({ ...row(), id: "class-two" });
  assert.equal((await checkOnlineMeeting("class-one", "faculty-one", options(duplicate, provider()))).verificationStatus, "DUPLICATE_REVIEW"); assert.equal(duplicate.entries.length, 0);
  const legacyDuplicate = fixture(); legacyDuplicate.rows.push({ ...row(), id: "legacy-class", trackingEnabled: false, status: "COMPLETED", incentiveEntryId: "legacy-paid" });
  assert.equal((await checkOnlineMeeting("class-one", "faculty-one", options(legacyDuplicate, provider()))).verificationStatus, "DUPLICATE_REVIEW"); assert.equal(legacyDuplicate.entries.length, 0);
  const restart = fixture(); restart.rows[0].pollLeaseToken = "crashed-worker"; restart.rows[0].pollLeaseUntil = new Date(+now - 1);
  await pollOnlineMeetings({ db: restart, now, check: (id, facultyId) => checkOnlineMeeting(id, facultyId, options(restart, provider())) }); assert.equal(restart.entries.length, 1);
  const stop = startMeetPollingWorker({ poll: async () => {}, env: { ENABLE_MEET_POLLING: "false" } }); stop();
});

test("legacy, other faculty, disconnected and backdated classes cannot get automatic incentives", async () => {
  const db = fixture(), p = provider();
  await assert.rejects(checkOnlineMeeting("class-one", "other", options(db, p)), { status: 404 });
  db.rows[0].trackingEnabled = false; await assert.rejects(checkOnlineMeeting("class-one", "faculty-one", options(db, p)), { code: "LEGACY" });
  const disconnected = fixture(); await checkOnlineMeeting("class-one", "faculty-one", options(disconnected, p, { getToken: async () => null })); assert.equal(disconnected.entries.length, 0);
  const backdated = fixture(); backdated.rows[0].createdAt = now; assert.equal((await checkOnlineMeeting("class-one", "faculty-one", options(backdated, p))).verificationStatus, "BACKDATED_REVIEW"); assert.equal(backdated.entries.length, 0);
});

test("PDF requires owning faculty or admin and complete persisted evidence; contains all participants", async () => {
  const db = fixture(); await checkOnlineMeeting("class-one", "faculty-one", options(db, provider()));
  for (const role of ["student", "staff", "guardian"]) await assert.rejects(getMeetingAttendance("class-one", { id: "faculty-one", role }, db), { status: 403 });
  await assert.rejects(getMeetingAttendance("class-one", { id: "other", role: "faculty" }, db), { status: 404 });
  const report = await getMeetingAttendance("class-one", { id: "faculty-one", role: "faculty" }, db, now);
  assert.ok((await buildMeetAttendancePdf(report)).subarray(0, 5).toString().startsWith("%PDF-"));
  assert.ok(await getMeetingAttendance("class-one", { id: 1, role: "admin" }, db, now));
  await assert.rejects(getMeetingAttendance("class-one", { id: 1, role: "admin" }, db, new Date(conference.startTime)), { status: 409 });
});

test("client retries one revoked access token and follows pagination without dropping pages", async () => {
  let requests = 0, refreshes = 0;
  const client = meetClient({ token: "old", refresh: async () => { refreshes++; return "new"; }, fetcher: async () => ++requests === 1 ? { status: 401, ok: false } : json(requests === 2 ? { participants: [1], nextPageToken: "next" } : { participants: [2] }) });
  assert.deepEqual(await client.pages("conferenceRecords/test/participants", "participants", {}), [1, 2]); assert.equal(refreshes, 1);
});
