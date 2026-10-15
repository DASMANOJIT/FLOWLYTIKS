import { randomUUID } from "node:crypto";
import prisma from "../prisma/client.js";
import { getFacultyGoogleAccessToken } from "./facultyGoogleService.js";
import { onlineClassDto, onlineClassInclude } from "./facultyOnlineClassService.js";

const fail = (message, status = 409, code = "UNVERIFIED", retryMs = 60000) => { throw Object.assign(new Error(message), { status, code, retryMs }); };
const leaseMs = 10 * 60000;
export function meetingFailure(error) {
  const sqlState = error?.meta?.code || error?.meta?.database_error?.code || error?.meta?.driverAdapterError?.cause?.originalCode || error?.cause?.code || (typeof error?.message === "string" ? /PostgresError \{ code: "([0-9A-Z]{5})"/.exec(error.message)?.[1] : null) || error?.code;
  const database = /^P\d{4}$/.test(error?.code || "") || /^\d{2}[0-9A-Z]{3}$/.test(sqlState || "") || error?.name?.startsWith("PrismaClient");
  return {
    code: error?.code === "P2002" ? "DUPLICATE_REVIEW" : database ? error?.code === "P2024" ? "DATABASE_BUSY" : "DATABASE_ERROR" : error?.code || "VERIFICATION_ERROR",
    message: database ? "Database verification is temporarily unavailable. Evidence retained; checking will retry." : error?.status ? error.message : "Meeting verification failed. Evidence retained; checking will retry.",
    diagnostic: { name: error?.name, code: error?.code, sqlState: /^[0-9A-Z]{5}$/.test(sqlState || "") ? sqlState : undefined },
  };
}
const stamp = value => { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? date : null; };
const resource = (value, pattern) => { if (typeof value !== "string" || !pattern.test(value)) fail("Google returned an invalid resource.", 502, "API_ERROR"); return value; };
export const meetingCode = link => new URL(link).pathname.replaceAll("/", "");
export const MEET_START_TOLERANCE_MS = 15 * 60000;
export const conferenceWindow = row => ({ start: new Date(+row.startsAt - MEET_START_TOLERANCE_MS), end: new Date(+row.endsAt + MEET_START_TOLERANCE_MS) });
export function conferenceFilter(row, space) {
  const window = conferenceWindow(row);
  return `space.name = "${space}" AND start_time >= "${window.start.toISOString()}" AND start_time < "${window.end.toISOString()}"`;
}

export function matchConferences(records, row, space) {
  const seen = new Map();
  const window = conferenceWindow(row);
  for (const record of records) {
    const start = stamp(record.startTime), end = stamp(record.endTime);
    if (record.space === space && start && start >= window.start && start < window.end && (!end || end >= start)) seen.set(record.name, record);
  }
  return [...seen.values()];
}

export function attendanceSummary(participants, conference, teacherId) {
  const start = stamp(conference.startTime), end = stamp(conference.endTime);
  const groups = new Map(); let complete = Boolean(start && end);
  for (const participant of participants) {
    const user = participant.googleUserId || null;
    const key = user || participant.name; // Anonymous identities must never be guessed from names.
    const group = groups.get(key) || { identity: key, googleUserId: user, displayName: participant.displayName || "Unknown participant", resourceNames: [], sessions: [] };
    group.resourceNames.push(participant.name);
    for (const session of participant.sessions) {
      const from = stamp(session.startTime), to = stamp(session.endTime);
      if (!from || !to || to < from) { complete = false; continue; }
      group.sessions.push({ name: session.name, startTime: from.toISOString(), endTime: to.toISOString() });
    }
    if (!participant.sessions.length) complete = false;
    groups.set(key, group);
  }
  const people = [...groups.values()].map(group => {
    const intervals = group.sessions.map(s => [Math.max(+new Date(s.startTime), +start), Math.min(+new Date(s.endTime), +(end || new Date()))]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]); else merged.push([...interval]);
    }
    return { ...group, durationSeconds: merged.reduce((sum, [a, b]) => sum + (b - a) / 1000, 0), mergedIntervals: merged.map(([a, b]) => ({ startTime: new Date(a).toISOString(), endTime: new Date(b).toISOString() })) };
  });
  const teacher = teacherId ? people.find(p => p.googleUserId === teacherId) : null;
  // Only a different signed-in Google identity proves a non-teacher attendee.
  const verifiedNonTeacher = teacher ? people.filter(p => p.googleUserId && p.googleUserId !== teacherId && p.durationSeconds > 0).length : null;
  return { participants: people, totalParticipants: people.length, excludingTeacher: teacher ? people.length - 1 : null, teacherVerified: Boolean(teacher?.durationSeconds > 0), verifiedNonTeacher, complete };
}

export function googleTeacherIdentity(connection) {
  // Meet SignedinUser.user is users/{Google account ID}; OIDC sub is the bare account ID.
  return connection?.identityVerifiedAt && typeof connection.googleSubject === "string" && /^[a-zA-Z0-9_-]{1,255}$/.test(connection.googleSubject) ? `users/${connection.googleSubject}` : null;
}

export function meetClient({ token, refresh, fetcher = fetch, pulse = async () => {} }) {
  let refreshed = false;
  const get = async (path, params = {}) => {
    await pulse();
    const url = new URL(`https://meet.googleapis.com/v2/${path}`);
    for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
    let response, data;
    try { response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }); }
    catch { fail("Google Meet is temporarily unavailable.", 502, "API_ERROR"); }
    if (response.status === 401 && !refreshed) { refreshed = true; token = await refresh(); if (!token) fail("Reconnect your Google account.", 409, "RECONNECT_REQUIRED"); return get(path, params); }
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers?.get("retry-after");
        const retryMs = /^\d+$/.test(retry || "") ? Number(retry) * 1000 : Math.max(0, +(stamp(retry) || 0) - Date.now());
        fail("Google Meet is temporarily unavailable. Checking will retry automatically.", 503, "API_BACKOFF", Math.max(60000, Math.min(3600000, retryMs)));
      }
      if (response.status === 404) fail("Google meeting data is not available yet. Verification will retry automatically.", 409, "MISSING_DATA");
      fail(response.status === 401 ? "Reconnect your Google account." : response.status === 403 ? "Google did not allow access to this meeting." : "Google rejected the meeting request.", response.status === 401 || response.status === 403 ? 409 : 502, response.status === 401 ? "RECONNECT_REQUIRED" : response.status === 403 ? "ACCESS_DENIED" : "API_ERROR");
    }
    try { data = await response.json(); } catch { fail("Google returned unreadable meeting data.", 502, "API_ERROR"); }
    await pulse(); return data;
  };
  const pages = async (path, field, params, onPage = async () => {}) => {
    const rows = [], tokens = new Set(); let pageToken;
    do {
      const data = await get(path, { ...params, pageToken });
      if (data[field] != null && !Array.isArray(data[field])) fail("Google returned invalid attendance data.", 502, "API_ERROR");
      rows.push(...(data[field] || [])); await onPage(data[field] || []);
      pageToken = data.nextPageToken;
      if (pageToken && (typeof pageToken !== "string" || tokens.has(pageToken))) fail("Google pagination did not finish.", 502, "API_ERROR");
      if (pageToken) tokens.add(pageToken);
    } while (pageToken);
    return rows;
  };
  return { get, pages };
}

export async function finalizeMeeting(tx, row, summary, now, connectionTime) {
  // Share the payout lease's acquisition barrier before changing pending accounting.
  await tx.$queryRaw`SELECT "id" FROM "Faculty" WHERE "id" = ${row.facultyId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "facultyId" FROM "FacultyExtraIncentiveOperationLock" WHERE "facultyId" = ${row.facultyId} FOR UPDATE`;
  const accountingLease = await tx.facultyExtraIncentiveOperationLock.findUnique({ where: { facultyId: row.facultyId } });
  if (accountingLease?.expiresAt > new Date()) fail("An incentive payment or update is in progress. Meeting evidence is retained and crediting will retry.", 409, "INCENTIVE_BUSY");
  await tx.$queryRaw`SELECT "id" FROM "FacultyOnlineClass" WHERE "id" = ${row.id} FOR UPDATE`;
  const current = await tx.facultyOnlineClass.findUnique({ where: { id: row.id }, include: onlineClassInclude });
  if (!current || current.deletedAt || current.status === "CANCELLED" || current.pollLeaseToken !== row.pollLeaseToken) return current;
  if (current.incentiveEntryId) return current;
  const connection = await tx.facultyGoogleConnection.findUnique({ where: { facultyId: row.facultyId } });
  const authorized = connection?.status === "CONNECTED" && +connection.connectedAt === +connectionTime;
  const teacherVerified = summary.teacherVerified && Boolean(current.teacherGoogleUserId) && googleTeacherIdentity(connection) === current.teacherGoogleUserId;
  let reason = !authorized ? "RECONNECT_REQUIRED" : !summary.complete ? "ATTENDANCE_PENDING" : !teacherVerified ? "TEACHER_IDENTITY_REVIEW" : !summary.verifiedNonTeacher ? "PARTICIPANT_IDENTITY_REVIEW" : current.actualStartAt < current.createdAt ? "BACKDATED_REVIEW" : null;
  if (!current.actualEndAt || current.actualEndAt > now) reason = "LIVE";
  const type = await tx.extraIncentiveType.findUnique({ where: { id: current.incentiveTypeId } });
  if (!type?.isActive || !Number.isFinite(Number(type.rate)) || Number(type.rate) <= 0) reason ||= "INCENTIVE_REVIEW";
  if (reason) return tx.facultyOnlineClass.update({ where: { id: row.id }, data: { status: reason === "LIVE" ? "LIVE" : "COMPLETED", verificationStatus: reason, verificationError: reason === "LIVE" ? null : "Meeting evidence retained; verification or admin review is required. No incentive credited.", ...(summary.complete ? { attendanceCompleteAt: now } : {}) }, include: onlineClassInclude });
  // Unique conferenceName and incentiveEntryId survive retries and admin corrections.
  const entry = await tx.facultyExtraIncentiveEntry.create({ data: { facultyId: row.facultyId, incentiveTypeId: type.id, quantityChange: 1, rateSnapshot: type.rate, amountSnapshot: type.rate, status: "PENDING", createdByType: "FACULTY", createdById: row.facultyId, note: `Google Meet verified: ${current.conferenceName}` } });
  return tx.facultyOnlineClass.update({ where: { id: row.id }, data: { status: "COMPLETED", completedAt: current.actualEndAt, attendanceCompleteAt: now, verificationStatus: "VERIFIED", verificationError: null, incentiveEntryId: entry.id }, include: onlineClassInclude });
}

export async function checkOnlineMeeting(id, facultyId, { db = prisma, fetcher = fetch, env = process.env, getToken = getFacultyGoogleAccessToken, identity = googleTeacherIdentity, now = new Date() } = {}) {
  const row = await db.facultyOnlineClass.findFirst({ where: { id, ...(facultyId ? { facultyId } : {}) }, include: onlineClassInclude });
  if (!row || row.deletedAt) fail("Class not found.", 404, "NOT_FOUND");
  if (!row.trackingEnabled) fail("Legacy classes are not automatically verified or credited.", 409, "LEGACY");
  if (row.status === "CANCELLED" || row.verificationStatus === "VERIFIED") return onlineClassDto(row);
  if (row.nextCheckAt > now || conferenceWindow(row).start > now) return { ...onlineClassDto(row), verificationPending: true, verificationMessage: "Waiting for the next automatic meeting check. No incentive has been credited." };
  const pollLeaseToken = randomUUID();
  const claimed = await db.facultyOnlineClass.updateMany({ where: { id, status: { not: "CANCELLED" }, verificationStatus: { not: "VERIFIED" }, trackingEnabled: true, AND: [{ OR: [{ pollLeaseUntil: null }, { pollLeaseUntil: { lte: now } }] }, { OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] }] }, data: { pollLeaseToken, pollLeaseUntil: new Date(+now + leaseMs) } });
  if (!claimed.count) return { ...onlineClassDto(await db.facultyOnlineClass.findUnique({ where: { id }, include: onlineClassInclude })), verificationPending: true, verificationMessage: "A meeting check is already running. Refresh shortly for its result." };
  row.pollLeaseToken = pollLeaseToken;
  const progress = async data => {
    const result = await db.facultyOnlineClass.updateMany({ where: { id, pollLeaseToken, status: { not: "CANCELLED" } }, data: { ...data, pollLeaseUntil: new Date(Date.now() + leaseMs) } });
    if (!result.count) fail("Meeting check cancelled or replaced.", 409, "CANCELLED");
  };
  const evidence = { ...(row.attendanceEvidence || {}), fetchedAt: now.toISOString() };
  const participantCache = new Map((evidence.participantCache || evidence.participants || evidence.partialParticipants || []).map(p => [p.name, p]));
  const cacheParticipant = p => {
    const cached = participantCache.get(p.name) || { ...p, sessions: [] };
    cached.displayName = p.displayName; cached.googleUserId = p.googleUserId;
    const sessions = new Map(cached.sessions.map(s => [s.name, s]));
    for (const s of p.sessions) sessions.set(s.name, { ...s });
    cached.sessions = [...sessions.values()]; participantCache.set(p.name, cached);
    evidence.participantCache = [...participantCache.values()];
  };
  try {
    if (+now - +row.endsAt > 30 * 86400000 && !row.attendanceCompleteAt && (!row.conferenceName || row.actualEndAt)) fail("Google meeting evidence may have expired. Admin review required.", 409, "EXPIRED", 86400000);
    const available = await db.facultyGoogleConnection.findUnique({ where: { facultyId: row.facultyId } });
    if (available?.meetBackoffUntil > now) fail("Google API cooldown is active. Checking will retry automatically.", 503, "API_BACKOFF", +available.meetBackoffUntil - +now);
    const token = await getToken(row.facultyId, { db, env, fetcher });
    if (!token) fail("Connect or reconnect your Google account.", 409, "RECONNECT_REQUIRED", 3600000);
    const connection = await db.facultyGoogleConnection.findUnique({ where: { facultyId: row.facultyId } });
    const client = meetClient({ token, fetcher, refresh: () => getToken(row.facultyId, { db, env, fetcher, forceRefresh: true }), pulse: () => progress({}) });
    const space = await client.get(`spaces/${meetingCode(row.meetUrl)}`);
    resource(space.name, /^spaces\/[a-zA-Z0-9_-]+$/);
    if (space.meetingCode !== meetingCode(row.meetUrl)) fail("Google meeting link could not be matched.", 409, "MATCH_REVIEW");
    evidence.candidates = [];
    evidence.matching = { filter: conferenceFilter(row, space.name), scheduledStartUtc: row.startsAt.toISOString(), scheduledEndUtc: row.endsAt.toISOString(), toleranceMinutes: 15 };
    let candidates = await client.pages("conferenceRecords", "conferenceRecords", { pageSize: 100, filter: evidence.matching.filter }, async page => {
      evidence.candidates = [...(evidence.candidates || []), ...page.map(c => ({ name: c.name, space: c.space, startTime: c.startTime, endTime: c.endTime || null, expireTime: c.expireTime || null }))];
      const cache = new Map((evidence.candidateCache || []).map(c => [c.name, c]));
      for (const c of evidence.candidates) cache.set(c.name, c);
      evidence.candidateCache = [...cache.values()];
      await progress({ attendanceEvidence: evidence });
    });
    candidates = matchConferences(candidates, row, space.name);
    // Reused links can start new calls after a previously identified conference.
    // Keep that association only when independent saved evidence still agrees.
    const saved = row.attendanceEvidence?.conference;
    const associated = candidates.find(candidate => candidate.name === row.conferenceName
      && row.conferenceSpace === space.name && saved?.name === candidate.name && saved.space === space.name
      && row.actualStartAt && +stamp(candidate.startTime) === +row.actualStartAt
      && +stamp(saved.startTime) === +row.actualStartAt);
    if (candidates.length !== 1 && !associated) fail(candidates.length ? "Multiple conferences match this class. Admin review required." : "Waiting for Google meeting data. Verification will retry automatically; no incentive has been credited.", 409, candidates.length ? "AMBIGUOUS_REVIEW" : "MISSING_DATA");
    let conference = associated || candidates[0]; resource(conference.name, /^conferenceRecords\/[a-zA-Z0-9_-]+$/);
    if (row.conferenceName && row.conferenceName !== conference.name) fail("The conference match changed. Admin review required.", 409, "MATCH_REVIEW");
    const duplicates = await db.facultyOnlineClass.findMany({ where: { id: { not: id }, AND: [{ OR: [{ status: { not: "CANCELLED" } }, { deletedAt: { not: null } }] }, { OR: [{ conferenceName: conference.name }, { meetUrl: { startsWith: `https://meet.google.com/${meetingCode(row.meetUrl)}` }, startsAt: { lte: new Date(+stamp(conference.startTime) + MEET_START_TOLERANCE_MS) }, endsAt: { gt: new Date(+stamp(conference.startTime) - MEET_START_TOLERANCE_MS) } }] }] }, select: { id: true } });
    if (duplicates.length) fail("Another class matches this conference. Admin review required; no duplicate credit allowed.", 409, "DUPLICATE_REVIEW");
    const selected = conference;
    conference = await client.get(selected.name);
    if (conference.name !== selected.name || (row.conferenceName && +stamp(conference.startTime) !== +row.actualStartAt) || matchConferences([conference], row, space.name).length !== 1) fail("Conference details changed. Admin review required.", 409, "MATCH_REVIEW");
    evidence.conference = { name: conference.name, space: conference.space, startTime: conference.startTime, endTime: conference.endTime || null, expireTime: conference.expireTime || null };
    await progress({ conferenceName: conference.name, conferenceSpace: space.name, actualStartAt: stamp(conference.startTime), actualEndAt: stamp(conference.endTime), conferenceExpiresAt: stamp(conference.expireTime), status: conference.endTime ? "COMPLETED" : "LIVE", attendanceEvidence: evidence });
    let teacherId = null;
    try { teacherId = await identity(connection); } catch { /* Unknown identity retains evidence, never awards. */ }
    evidence.partialParticipants = [];
    await client.pages(`${conference.name}/participants`, "participants", { pageSize: 250 }, async page => {
      for (const p of page) {
        resource(p.name, new RegExp(`^${conference.name}/participants/[a-zA-Z0-9_-]+$`));
        const participant = { name: p.name, googleUserId: /^users\/[a-zA-Z0-9_-]+$/.test(p.signedinUser?.user || "") ? p.signedinUser.user : null, displayName: String(p.signedinUser?.displayName || p.anonymousUser?.displayName || p.phoneUser?.displayName || "Unknown participant").slice(0, 500), sessions: [] };
        evidence.partialParticipants.push(participant); cacheParticipant(participant); await progress({ attendanceEvidence: evidence });
        await client.pages(`${p.name}/participantSessions`, "participantSessions", { pageSize: 250 }, async sessions => {
          for (const s of sessions) {
            resource(s.name, new RegExp(`^${p.name}/participantSessions/[a-zA-Z0-9_-]+$`));
            if (!participant.sessions.some(old => old.name === s.name)) participant.sessions.push({ name: s.name, startTime: s.startTime || null, endTime: s.endTime || null });
          }
          cacheParticipant(participant);
          await progress({ attendanceEvidence: evidence });
        });
      }
    });
    // Re-fetch conference end, not teacher departure or the planned schedule.
    const final = await client.get(conference.name);
    if (final.name !== conference.name || +stamp(final.startTime) !== +stamp(conference.startTime) || matchConferences([final], row, space.name).length !== 1) fail("Conference details changed. Admin review required.", 409, "MATCH_REVIEW");
    conference = final; evidence.conference = { ...evidence.conference, endTime: final.endTime || null };
    const summary = attendanceSummary(evidence.partialParticipants, conference, teacherId);
    evidence.participants = evidence.partialParticipants; delete evidence.partialParticipants; evidence.summary = summary;
    await progress({ actualEndAt: stamp(conference.endTime), teacherGoogleUserId: teacherId, attendanceEvidence: evidence });
    await db.$transaction(tx => finalizeMeeting(tx, row, summary, now, connection.connectedAt));
    await db.facultyOnlineClass.updateMany({ where: { id, pollLeaseToken }, data: { nextCheckAt: new Date(+now + (conference.endTime ? 3600000 : 60000)), lastCheckedAt: now, pollAttempts: 0 } });
  } catch (error) {
    const failure = meetingFailure(error);
    console.warn("meet.verification.failed", { classId: id, category: failure.code, ...failure.diagnostic });
    if (error.code === "RECONNECT_REQUIRED") await db.facultyGoogleConnection.updateMany({ where: { facultyId: row.facultyId }, data: { status: "RECONNECT_REQUIRED" } });
    const backoff = error.code === "MISSING_DATA" ? 60000 : Math.min(3600000, Math.max(error.retryMs || 60000, 60000 * 2 ** Math.min(row.pollAttempts || 0, 6)));
    if (error.code === "API_BACKOFF") await db.facultyGoogleConnection.updateMany({ where: { facultyId: row.facultyId }, data: { meetBackoffUntil: new Date(+now + backoff) } });
    try {
      await db.facultyOnlineClass.updateMany({ where: { id, pollLeaseToken, status: { not: "CANCELLED" } }, data: { attendanceEvidence: evidence, verificationStatus: failure.code, verificationError: failure.message, lastCheckedAt: now, nextCheckAt: new Date(+now + backoff), pollAttempts: { increment: 1 } } });
    } catch (persistError) { console.warn("meet.failure_persist.failed", { classId: id, ...meetingFailure(persistError).diagnostic }); throw persistError; }
  } finally {
    try { await db.facultyOnlineClass.updateMany({ where: { id, pollLeaseToken }, data: { pollLeaseToken: null, pollLeaseUntil: null } }); }
    catch (releaseError) { console.warn("meet.lease_release.failed", { classId: id, ...meetingFailure(releaseError).diagnostic }); }
  }
  return onlineClassDto(await db.facultyOnlineClass.findUnique({ where: { id }, include: onlineClassInclude }));
}

export async function pollOnlineMeetings({ db = prisma, check = checkOnlineMeeting, now = new Date() } = {}) {
  const rows = await db.facultyOnlineClass.findMany({ where: { trackingEnabled: true, status: { not: "CANCELLED" }, verificationStatus: { notIn: ["VERIFIED", "EXPIRED", "AMBIGUOUS_REVIEW", "DUPLICATE_REVIEW", "MATCH_REVIEW"] }, startsAt: { lte: new Date(+now + MEET_START_TOLERANCE_MS) }, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] }, orderBy: [{ nextCheckAt: "asc" }, { id: "asc" }], take: 10, select: { id: true } });
  for (const row of rows) {
    try { await check(row.id, null, { db, now }); }
    catch (error) { if (!["CHECK_RUNNING", "CHECK_NOT_DUE"].includes(error.code)) console.warn("meet.poll.failed", { code: error.code || "UNAVAILABLE" }); }
  }
}

export function startMeetPollingWorker({ env = process.env, poll = pollOnlineMeetings } = {}) {
  if (env.ENABLE_MEET_POLLING === "false") { console.info("meet.worker.disabled"); return async () => {}; }
  console.info("meet.worker.started", { concurrency: 1, intervalMs: 30000 });
  let stopped = false, timer, active;
  const run = async () => {
    try { await poll(); } catch (error) { console.warn("meet.worker.failed", { code: error.code || "UNAVAILABLE" }); }
    if (!stopped) { timer = setTimeout(() => { active = run(); }, 30000); timer.unref?.(); }
  };
  active = run();
  return async () => { stopped = true; clearTimeout(timer); await active; };
}
