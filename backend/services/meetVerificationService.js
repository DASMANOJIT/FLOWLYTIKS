import { randomUUID } from "node:crypto";
import { registerMeetWorkerWakeHandler } from "./meetWorkerSignals.js";
import prisma from "../prisma/client.js";
import { getFacultyGoogleAccessToken } from "./facultyGoogleService.js";
import {
  onlineClassDto,
  onlineClassInclude,
} from "./facultyOnlineClassService.js";

const fail = (message, status = 409, code = "UNVERIFIED", retryMs = 60000) => {
  throw Object.assign(new Error(message), { status, code, retryMs });
};
const leaseMs = 10 * 60000;
export function meetingFailure(error) {
  const sqlState =
    error?.meta?.code ||
    error?.meta?.database_error?.code ||
    error?.meta?.driverAdapterError?.cause?.originalCode ||
    error?.cause?.code ||
    (typeof error?.message === "string"
      ? /PostgresError \{ code: "([0-9A-Z]{5})"/.exec(error.message)?.[1]
      : null) ||
    error?.code;
  const database =
    /^P\d{4}$/.test(error?.code || "") ||
    /^\d{2}[0-9A-Z]{3}$/.test(sqlState || "") ||
    error?.name?.startsWith("PrismaClient");
  return {
    code:
      error?.code === "P2002"
        ? "DUPLICATE_REVIEW"
        : database
          ? error?.code === "P2024"
            ? "DATABASE_BUSY"
            : "DATABASE_ERROR"
          : error?.code || "VERIFICATION_ERROR",
    message: database
      ? "Database verification is temporarily unavailable. Evidence retained; checking will retry."
      : error?.status
        ? error.message
        : "Meeting verification failed. Evidence retained; checking will retry.",
    diagnostic: {
      name: error?.name,
      code: error?.code,
      sqlState: /^[0-9A-Z]{5}$/.test(sqlState || "") ? sqlState : undefined,
    },
  };
}
const stamp = (value) => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date : null;
};
const resource = (value, pattern) => {
  if (typeof value !== "string" || !pattern.test(value))
    fail("Google returned an invalid resource.", 502, "API_ERROR");
  return value;
};
export const meetingCode = (link) => new URL(link).pathname.replaceAll("/", "");
export const MEET_START_TOLERANCE_MS = 15 * 60000;
// This bounds conference start discovery, not meeting duration. New sessions allow 15 minutes either side of start.
export const conferenceWindow = (row) => ({
  start: new Date(+row.startsAt - MEET_START_TOLERANCE_MS),
  end: new Date(
    +(row.endsAt > row.startsAt ? row.endsAt : row.startsAt) +
      MEET_START_TOLERANCE_MS,
  ),
});
export function conferenceFilter(row, space) {
  const window = conferenceWindow(row);
  return `space.name = "${space}" AND start_time >= "${window.start.toISOString()}" AND start_time < "${window.end.toISOString()}"`;
}

export function matchConferences(records, row, space) {
  const seen = new Map();
  const window = conferenceWindow(row);
  for (const record of records) {
    const start = stamp(record.startTime),
      end = stamp(record.endTime);
    if (
      record.space === space &&
      start &&
      start >= window.start &&
      start < window.end &&
      (!record.endTime || (end && end >= start))
    )
      seen.set(record.name, record);
  }
  return [...seen.values()];
}

export function establishedConference(row) {
  const saved = row.attendanceEvidence?.conference;
  return /^conferenceRecords\/[a-zA-Z0-9_-]+$/.test(row.conferenceName || "") &&
    /^spaces\/[a-zA-Z0-9_-]+$/.test(row.conferenceSpace || "") &&
    saved?.name === row.conferenceName &&
    saved.space === row.conferenceSpace &&
    row.actualStartAt &&
    +stamp(saved.startTime) === +row.actualStartAt &&
    matchConferences([saved], row, row.conferenceSpace).length === 1
    ? saved
    : null;
}

function retainConferenceEnd(fresh, previous, row) {
  const savedEnd =
    previous?.endTime ||
    (row.conferenceName === fresh.name && row.actualEndAt
      ? row.actualEndAt.toISOString()
      : null);
  if (savedEnd && fresh.endTime && +stamp(savedEnd) !== +stamp(fresh.endTime))
    fail(
      "Conference end evidence changed. Admin review required.",
      409,
      "MATCH_REVIEW",
    );
  return savedEnd && !fresh.endTime ? { ...fresh, endTime: savedEnd } : fresh;
}

export function attendanceSummary(participants, conference, teacherId) {
  const start = stamp(conference.startTime);
  const end = stamp(conference.endTime);
  const groups = new Map();

  for (const participant of participants) {
    const user = participant.googleUserId || null;
    const resourceName = participant.name || `unknown-${groups.size}`;
    const key = user || resourceName;

    const group = groups.get(key) || {
      identity: key,
      googleUserId: user,
      displayName: participant.displayName || "Unknown participant",
      resourceNames: [],
      attendanceStatus: "PRESENT",
    };

    if (!group.resourceNames.includes(resourceName)) {
      group.resourceNames.push(resourceName);
    }

    if (
      group.displayName === "Unknown participant" &&
      participant.displayName
    ) {
      group.displayName = participant.displayName;
    }

    groups.set(key, group);
  }

  const people = [...groups.values()];
  const teacher = teacherId
    ? people.find((person) => person.googleUserId === teacherId)
    : null;

  const excludingTeacher = teacher ? people.length - 1 : null;

  return {
    participants: people,
    totalParticipants: people.length,
    excludingTeacher,
    teacherVerified: Boolean(teacher),
    verifiedNonTeacher: teacher ? excludingTeacher : null,
    complete: Boolean(start && end && end >= start),
  };
}

export function googleTeacherIdentity(connection) {
  // Meet SignedinUser.user is users/{Google account ID}; OIDC sub is the bare account ID.
  return connection?.identityVerifiedAt &&
    typeof connection.googleSubject === "string" &&
    /^[a-zA-Z0-9_-]{1,255}$/.test(connection.googleSubject)
    ? `users/${connection.googleSubject}`
    : null;
}

export function meetClient({
  token,
  refresh,
  fetcher = fetch,
  pulse = async () => {},
}) {
  let refreshed = false;
  const get = async (path, params = {}) => {
    await pulse();
    const url = new URL(`https://meet.googleapis.com/v2/${path}`);
    for (const [key, value] of Object.entries(params))
      if (value != null) url.searchParams.set(key, value);
    let response, data;
    try {
      response = await fetcher(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      fail("Google Meet is temporarily unavailable.", 502, "API_ERROR");
    }
    if (response.status === 401 && !refreshed) {
      refreshed = true;
      token = await refresh();
      if (!token)
        fail("Reconnect your Google account.", 409, "RECONNECT_REQUIRED");
      return get(path, params);
    }
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers?.get("retry-after");
        const retryMs = /^\d+$/.test(retry || "")
          ? Number(retry) * 1000
          : Math.max(0, +(stamp(retry) || 0) - Date.now());
        fail(
          "Google Meet is temporarily unavailable. Checking will retry automatically.",
          503,
          "API_BACKOFF",
          Math.max(60000, retryMs),
        );
      }
      if (response.status === 404)
        fail(
          "Google meeting data is not available yet. Verification will retry automatically.",
          409,
          "MISSING_DATA",
        );
      fail(
        response.status === 401
          ? "Reconnect your Google account."
          : response.status === 403
            ? "Google did not allow access to this meeting."
            : "Google rejected the meeting request.",
        response.status === 401 || response.status === 403 ? 409 : 502,
        response.status === 401
          ? "RECONNECT_REQUIRED"
          : response.status === 403
            ? "ACCESS_DENIED"
            : "API_ERROR",
      );
    }
    try {
      data = await response.json();
    } catch {
      fail("Google returned unreadable meeting data.", 502, "API_ERROR");
    }
    await pulse();
    return data;
  };
  const pages = async (path, field, params, onPage = async () => {}) => {
    const rows = [],
      tokens = new Set();
    let pageToken;
    do {
      const data = await get(path, { ...params, pageToken });
      if (data[field] != null && !Array.isArray(data[field]))
        fail("Google returned invalid attendance data.", 502, "API_ERROR");
      rows.push(...(data[field] || []));
      await onPage(data[field] || []);
      pageToken = data.nextPageToken;
      if (pageToken && (typeof pageToken !== "string" || tokens.has(pageToken)))
        fail("Google pagination did not finish.", 502, "API_ERROR");
      if (pageToken) tokens.add(pageToken);
    } while (pageToken);
    return rows;
  };
  return { get, pages };
}

export async function finalizeMeeting(
  tx,
  row,
  summary,
  now,
  connectionTime,
  finalEvidence = null,
) {
  // Share the payout lease's acquisition barrier before changing pending accounting.
  await tx.$queryRaw`SELECT "id" FROM "Faculty" WHERE "id" = ${row.facultyId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "facultyId" FROM "FacultyExtraIncentiveOperationLock" WHERE "facultyId" = ${row.facultyId} FOR UPDATE`;
  const accountingLease =
    await tx.facultyExtraIncentiveOperationLock.findUnique({
      where: { facultyId: row.facultyId },
    });
  if (accountingLease?.expiresAt > new Date())
    fail(
      "An incentive payment or update is in progress. Meeting evidence is retained and crediting will retry.",
      409,
      "INCENTIVE_BUSY",
    );
  await tx.$queryRaw`SELECT "id" FROM "FacultyOnlineClass" WHERE "id" = ${row.id} FOR UPDATE`;
  const current = await tx.facultyOnlineClass.findUnique({
    where: { id: row.id },
    include: onlineClassInclude,
  });
  if (
    !current ||
    current.deletedAt ||
    current.status === "CANCELLED" ||
    current.pollLeaseToken !== row.pollLeaseToken
  )
    return current;
  if (current.incentiveEntryId) return current;
  if (finalEvidence) {
    await tx.facultyOnlineClass.update({
      where: { id: row.id },
      data: finalEvidence,
    });
    Object.assign(current, finalEvidence);
  }
  const connection = await tx.facultyGoogleConnection.findUnique({
    where: { facultyId: row.facultyId },
  });
  const authorized =
    connection?.status === "CONNECTED" &&
    +connection.connectedAt === +connectionTime;
  const teacherVerified =
    summary.teacherVerified &&
    Boolean(current.teacherGoogleUserId) &&
    googleTeacherIdentity(connection) === current.teacherGoogleUserId;

  const MINIMUM_DURATION_SECONDS = 3600;

  const actualDurationSeconds =
    current.actualStartAt && current.actualEndAt
      ? Math.max(
          0,
          (new Date(current.actualEndAt).getTime() -
            new Date(current.actualStartAt).getTime()) /
            1000,
        )
      : null;

  const durationEligible =
    actualDurationSeconds !== null &&
    actualDurationSeconds > MINIMUM_DURATION_SECONDS;

  let reason = !current.actualEndAt
    ? authorized
      ? "LIVE"
      : "RECONNECT_REQUIRED"
    : !authorized
      ? "RECONNECT_REQUIRED"
      : !durationEligible
        ? "ENDED_TOO_EARLY"
        : !summary.complete
          ? "ATTENDANCE_PENDING"
          : !teacherVerified
            ? "TEACHER_IDENTITY_REVIEW"
            : !summary.verifiedNonTeacher
              ? "PARTICIPANT_IDENTITY_REVIEW"
              : current.actualStartAt < current.createdAt
                ? "BACKDATED_REVIEW"
                : null;

  const type = await tx.extraIncentiveType.findUnique({
    where: { id: current.incentiveTypeId },
  });
  if (
    !type?.isActive ||
    !Number.isFinite(Number(type.rate)) ||
    Number(type.rate) <= 0
  )
    reason ||= "INCENTIVE_REVIEW";

  if (reason) {
    return tx.facultyOnlineClass.update({
      where: { id: row.id },
      data: {
        status: current.actualEndAt ? "COMPLETED" : "LIVE",
        completedAt: current.actualEndAt || null,
        verificationStatus: reason,
        verificationError:
          reason === "LIVE"
            ? null
            : reason === "ENDED_TOO_EARLY"
              ? "Class duration must be longer than 1 hour."
              : "Meeting evidence retained; verification or admin review is required.",

        ...(summary.complete ? { attendanceCompleteAt: now } : {}),
      },
      include: onlineClassInclude,
    });
  }

  // Unique conferenceName and incentiveEntryId survive retries and admin corrections.
  const entry = await tx.facultyExtraIncentiveEntry.create({
    data: {
      facultyId: row.facultyId,
      incentiveTypeId: type.id,
      quantityChange: 1,
      rateSnapshot: type.rate,
      amountSnapshot: type.rate,
      status: "PENDING",
      createdByType: "FACULTY",
      createdById: row.facultyId,
      note: `Google Meet verified: ${current.conferenceName}`,
    },
  });
  return tx.facultyOnlineClass.update({
    where: { id: row.id },
    data: {
      status: "COMPLETED",
      completedAt: current.actualEndAt,
      attendanceCompleteAt: now,
      verificationStatus: "VERIFIED",
      verificationError: null,
      incentiveEntryId: entry.id,
    },
    include: onlineClassInclude,
  });
}

export async function checkOnlineMeeting(
  id,
  facultyId,
  {
    db = prisma,
    fetcher = fetch,
    env = process.env,
    getToken = getFacultyGoogleAccessToken,
    identity = googleTeacherIdentity,
    now = new Date(),
  } = {},
) {
  const row = await db.facultyOnlineClass.findFirst({
    where: { id, ...(facultyId ? { facultyId } : {}) },
    include: onlineClassInclude,
  });
  if (!row || row.deletedAt) fail("Class not found.", 404, "NOT_FOUND");
  if (!row.trackingEnabled)
    fail(
      "Legacy classes are not automatically verified or credited.",
      409,
      "LEGACY",
    );
  if (
    row.status === "CANCELLED" ||
    (TERMINAL_MEET_VERIFICATION_STATUSES.includes(row.verificationStatus) &&
      row.verificationStatus !== "TEACHER_IDENTITY_REVIEW")
  )
    return onlineClassDto(row);
  const repairEndedLive =
    row.verificationStatus === "LIVE" &&
    row.actualEndAt &&
    establishedConference(row);
  const firstActivation =
    !row.lastCheckedAt && conferenceWindow(row).start <= now;
  if (
    (row.nextCheckAt > now && !repairEndedLive && !firstActivation) ||
    conferenceWindow(row).start > now
  )
    return {
      ...onlineClassDto(row),
      verificationPending: true,
      verificationMessage:
        "Waiting for the next automatic meeting check. No incentive has been credited.",
    };
  const pollLeaseToken = randomUUID();
  const claimed = await db.facultyOnlineClass.updateMany({
    where: {
      id,
      status: { not: "CANCELLED" },
      OR: [
        { verificationStatus: { notIn: TERMINAL_MEET_VERIFICATION_STATUSES } },
        { verificationStatus: "TEACHER_IDENTITY_REVIEW" },
      ],
      trackingEnabled: true,
      AND: [
        { OR: [{ pollLeaseUntil: null }, { pollLeaseUntil: { lte: now } }] },
        {
          OR: [
            { nextCheckAt: null },
            { nextCheckAt: { lte: now } },
            ...(firstActivation ? [{ lastCheckedAt: null }] : []),
            ...(repairEndedLive
              ? [{ verificationStatus: "LIVE", actualEndAt: { not: null } }]
              : []),
          ],
        },
      ],
    },
    data: { pollLeaseToken, pollLeaseUntil: new Date(+now + leaseMs) },
  });
  if (!claimed.count)
    return {
      ...onlineClassDto(
        await db.facultyOnlineClass.findUnique({
          where: { id },
          include: onlineClassInclude,
        }),
      ),
      verificationPending: true,
      verificationMessage:
        "A meeting check is already running. Refresh shortly for its result.",
    };
  row.pollLeaseToken = pollLeaseToken;

  const progress = async (data) => {
    const result = await db.facultyOnlineClass.updateMany({
      where: {
        id,
        pollLeaseToken,
        status: { not: "CANCELLED" },
        deletedAt: null,
        verificationStatus: { not: "VERIFIED" },
        ...(data.status === "LIVE" ? { actualEndAt: null } : {}),
      },
      data: { ...data, pollLeaseUntil: new Date(Date.now() + leaseMs) },
    });
    if (!result.count)
      fail("Meeting check cancelled or replaced.", 409, "CANCELLED");
  };

  const evidence = {
    ...(row.attendanceEvidence || {}),
    fetchedAt: now.toISOString(),
  };
  const participantCache = new Map(
    (
      evidence.participantCache ||
      evidence.participants ||
      evidence.partialParticipants ||
      []
    ).map((p) => [p.name, p]),
  );
  const cacheParticipant = (p) => {
    const cached = {
      name: p.name,
      googleUserId: p.googleUserId || null,
      displayName: p.displayName || "Unknown participant",
    };
    participantCache.set(p.name, cached);
    evidence.participantCache = [...participantCache.values()];
  };
  try {
    if (
      +now -
        +(
          row.actualEndAt ||
          (row.endsAt > row.startsAt ? row.endsAt : row.startsAt)
        ) >
        30 * 86400000 &&
      !row.attendanceCompleteAt &&
      (!row.conferenceName || row.actualEndAt)
    )
      fail(
        "Google meeting evidence may have expired. Admin review required.",
        409,
        "EXPIRED",
        86400000,
      );
    const available = await db.facultyGoogleConnection.findUnique({
      where: { facultyId: row.facultyId },
    });
    if (available?.meetBackoffUntil > now)
      fail(
        "Google API cooldown is active. Checking will retry automatically.",
        503,
        "API_BACKOFF",
        +available.meetBackoffUntil - +now,
      );
    const token = await getToken(row.facultyId, { db, env, fetcher });
    if (!token)
      fail(
        "Connect or reconnect your Google account.",
        409,
        "RECONNECT_REQUIRED",
        3600000,
      );
    const connection = await db.facultyGoogleConnection.findUnique({
      where: { facultyId: row.facultyId },
    });
    const client = meetClient({
      token,
      fetcher,
      refresh: () =>
        getToken(row.facultyId, { db, env, fetcher, forceRefresh: true }),
      pulse: () => progress({}),
    });
    const established = establishedConference(row);
    let space, conference;
    if (established) {
      // Discovery is only for unbound classes. A reused link is not the identity
      // of an already matched conference, and later list pages may omit it.
      space = { name: row.conferenceSpace };
      conference = established;
    } else {
      space = await client.get(`spaces/${meetingCode(row.meetUrl)}`);
      resource(space.name, /^spaces\/[a-zA-Z0-9_-]+$/);
      if (space.meetingCode !== meetingCode(row.meetUrl))
        fail("Google meeting link could not be matched.", 409, "MATCH_REVIEW");
      evidence.candidates = [];
      evidence.matching = {
        filter: conferenceFilter(row, space.name),
        scheduledStartUtc: row.startsAt.toISOString(),
        scheduledEndUtc: row.endsAt?.toISOString() || null,
        toleranceMinutes: 15,
      };
      let candidates = await client.pages(
        "conferenceRecords",
        "conferenceRecords",
        { pageSize: 100, filter: evidence.matching.filter },
        async (page) => {
          evidence.candidates = [
            ...(evidence.candidates || []),
            ...page.map((c) => ({
              name: c.name,
              space: c.space,
              startTime: c.startTime,
              endTime: c.endTime || null,
              expireTime: c.expireTime || null,
            })),
          ];
          const cache = new Map(
            (evidence.candidateCache || []).map((c) => [c.name, c]),
          );
          for (const c of evidence.candidates) cache.set(c.name, c);
          evidence.candidateCache = [...cache.values()];
          await progress({ attendanceEvidence: evidence });
        },
      );
      console.info("meet.conference.discovery", {
  classId: id,
  facultyId,
  space: space.name,
  scheduledStart: row.startsAt.toISOString(),
  scheduledEnd: row.endsAt?.toISOString() || null,
  toleranceMinutes: 15,
  googleRecordsReturned: candidates.length,
  records: candidates.map((c) => ({
    name: c.name,
    space: c.space,
    startTime: c.startTime,
    endTime: c.endTime || null,
  })),
});
if (candidates.length === 0) {
  const diagnosticStart = new Date(
    +row.startsAt - 24 * 60 * 60 * 1000,
  );
  const diagnosticEnd = new Date(
    +row.startsAt + 24 * 60 * 60 * 1000,
  );

  const diagnosticFilter =
    `space.name = "${space.name}" AND ` +
    `start_time >= "${diagnosticStart.toISOString()}" AND ` +
    `start_time < "${diagnosticEnd.toISOString()}"`;

  try {
    const nearbyRecords = await client.pages(
      "conferenceRecords",
      "conferenceRecords",
      {
        pageSize: 100,
        filter: diagnosticFilter,
      },
    );

    console.info("meet.conference.broad.discovery", {
      classId: id,
      facultyId,
      space: space.name,
      recordsReturned: nearbyRecords.length,
      records: nearbyRecords.map((c) => ({
        name: c.name,
        startTime: c.startTime,
        endTime: c.endTime || null,
      })),
    });
  } catch (error) {
    console.warn("meet.conference.broad.discovery.failed", {
      classId: id,
      message: error.message,
    });
  }
}
      candidates = matchConferences(candidates, row, space.name);
      if (candidates.length !== 1)
        fail(
          candidates.length
            ? "Multiple conferences match this class. Admin review required."
            : "Waiting for Google meeting data. Verification will retry automatically; no incentive has been credited.",
          409,
          candidates.length ? "AMBIGUOUS_REVIEW" : "MISSING_DATA",
        );
      conference = candidates[0];
    }
    resource(conference.name, /^conferenceRecords\/[a-zA-Z0-9_-]+$/);
    if (row.conferenceName && row.conferenceName !== conference.name)
      fail(
        "The conference match changed. Admin review required.",
        409,
        "MATCH_REVIEW",
      );
    const duplicates = await db.facultyOnlineClass.findMany({
      where: {
        id: { not: id },
        AND: [
          {
            OR: [
              { status: { not: "CANCELLED" } },
              { deletedAt: { not: null } },
            ],
          },
          {
            OR: [
              { conferenceName: conference.name },
              {
                meetUrl: {
                  startsWith: `https://meet.google.com/${meetingCode(row.meetUrl)}`,
                },
                startsAt: {
                  lte: new Date(
                    +stamp(conference.startTime) + MEET_START_TOLERANCE_MS,
                  ),
                },
                OR: [
                  {
                    endsAt: {
                      gt: new Date(
                        +stamp(conference.startTime) - MEET_START_TOLERANCE_MS,
                      ),
                    },
                  },
                  {
                    startsAt: {
                      gt: new Date(
                        +stamp(conference.startTime) - MEET_START_TOLERANCE_MS,
                      ),
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      select: { id: true },
    });
    if (duplicates.length)
      fail(
        "Another class matches this conference. Admin review required; no duplicate credit allowed.",
        409,
        "DUPLICATE_REVIEW",
      );
    const selected = conference;
    conference = await client.get(selected.name);
    if (
      conference.name !== selected.name ||
      (row.conferenceName &&
        +stamp(conference.startTime) !== +row.actualStartAt) ||
      matchConferences([conference], row, space.name).length !== 1
    )
      fail(
        "Conference details changed. Admin review required.",
        409,
        "MATCH_REVIEW",
      );
    conference = retainConferenceEnd(conference, selected, row);
    evidence.conference = {
      name: conference.name,
      space: conference.space,
      startTime: conference.startTime,
      endTime: conference.endTime || null,
      expireTime: conference.expireTime || null,
    };
    await progress({
      conferenceName: conference.name,
      conferenceSpace: space.name,
      actualStartAt: stamp(conference.startTime),
      actualEndAt: stamp(conference.endTime),
      conferenceExpiresAt: stamp(conference.expireTime),
      status: conference.endTime ? "COMPLETED" : "LIVE",
      ...(conference.endTime
        ? {
            completedAt: stamp(conference.endTime),
            verificationStatus: "ATTENDANCE_PENDING",
            verificationError: null,
          }
        : {}),
      attendanceEvidence: evidence,
    });
    let teacherId = null;
    try {
      teacherId = await identity(connection);
    } catch {
      /* Unknown identity retains evidence, never awards. */
    }
    evidence.partialParticipants = [];
    await client.pages(
      `${conference.name}/participants`,
      "participants",
      { pageSize: 250 },
      async (page) => {
        for (const p of page) {
          resource(
            p.name,
            new RegExp(`^${conference.name}/participants/[a-zA-Z0-9_-]+$`),
          );
          const participant = {
            name: p.name,
            googleUserId: /^users\/[a-zA-Z0-9_-]+$/.test(
              p.signedinUser?.user || "",
            )
              ? p.signedinUser.user
              : null,
            displayName: String(
              p.signedinUser?.displayName ||
                p.anonymousUser?.displayName ||
                p.phoneUser?.displayName ||
                "Unknown participant",
            ).slice(0, 500),
          };
          evidence.partialParticipants.push(participant);
          cacheParticipant(participant);
          await progress({ attendanceEvidence: evidence });
        }
      },
    );
    // Re-fetch conference end, not teacher departure or the planned schedule.
    const final = await client.get(conference.name);
    if (
      final.name !== conference.name ||
      +stamp(final.startTime) !== +stamp(conference.startTime) ||
      matchConferences([final], row, space.name).length !== 1
    )
      fail(
        "Conference details changed. Admin review required.",
        409,
        "MATCH_REVIEW",
      );
    conference = retainConferenceEnd(final, conference, row);
    evidence.conference = {
      ...evidence.conference,
      endTime: conference.endTime || null,
    };
    const summary = attendanceSummary(
      evidence.partialParticipants,
      conference,
      teacherId,
    );
    evidence.participants = evidence.partialParticipants;
    delete evidence.partialParticipants;
    evidence.summary = summary;
    const finalEvidence = {
      actualEndAt: stamp(conference.endTime),
      teacherGoogleUserId: teacherId,
      attendanceEvidence: evidence,
      ...(conference.endTime
        ? {
            status: "COMPLETED",
            completedAt: stamp(conference.endTime),
            verificationStatus: "ATTENDANCE_PENDING",
          }
        : {}),
      ...(summary.complete ? { attendanceCompleteAt: now } : {}),
    };
    // Persist Google lifecycle/report evidence even when crediting must retry after a payout or DB failure.
    await progress(finalEvidence);

    const finalized = await db.$transaction((tx) =>
      finalizeMeeting(tx, row, summary, now, connection.connectedAt),
    );

    const retryMs = 30 * 60 * 1000;
    await db.facultyOnlineClass.updateMany({
      where: { id, pollLeaseToken },
      data: {
        nextCheckAt: new Date(+now + retryMs),
        lastCheckedAt: now,
        pollAttempts: 0,
      },
    });
  } catch (error) {
    const failure = meetingFailure(error);
    console.warn("meet.verification.failed", {
      classId: id,
      category: failure.code,
      ...failure.diagnostic,
    });
    if (error.code === "RECONNECT_REQUIRED")
      await db.facultyGoogleConnection.updateMany({
        where: { facultyId: row.facultyId },
        data: { status: "RECONNECT_REQUIRED" },
      });
    const backoff = Math.max(
      30 * 60 * 1000,
      Number(error.retryMs) || 0,
    );
    if (error.code === "API_BACKOFF")
      await db.facultyGoogleConnection.updateMany({
        where: { facultyId: row.facultyId },
        data: { meetBackoffUntil: new Date(+now + backoff) },
      });
    try {
      await db.facultyOnlineClass.updateMany({
        where: {
          id,
          pollLeaseToken,
          status: { not: "CANCELLED" },
          verificationStatus: { not: "VERIFIED" },
          ...(evidence.conference && !evidence.conference.endTime
            ? { actualEndAt: null }
            : {}),
        },
        data: {
          attendanceEvidence: evidence,
          verificationStatus: failure.code,
          verificationError: failure.message,
          lastCheckedAt: now,
          nextCheckAt: new Date(+now + backoff),
          pollAttempts: { increment: 1 },
        },
      });
    } catch (persistError) {
      console.warn("meet.failure_persist.failed", {
        classId: id,
        ...meetingFailure(persistError).diagnostic,
      });
      throw persistError;
    }
  } finally {
    try {
      await db.facultyOnlineClass.updateMany({
        where: { id, pollLeaseToken },
        data: { pollLeaseToken: null, pollLeaseUntil: null },
      });
    } catch (releaseError) {
      console.warn("meet.lease_release.failed", {
        classId: id,
        ...meetingFailure(releaseError).diagnostic,
      });
    }
  }
  return onlineClassDto(
    await db.facultyOnlineClass.findUnique({
      where: { id },
      include: onlineClassInclude,
    }),
  );
}

function resolveMeetPollConcurrency(value, fallback = 10) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(10, Math.max(1, parsed));
}
const TERMINAL_MEET_VERIFICATION_STATUSES = [
  "VERIFIED",
  "EXPIRED",
  "AMBIGUOUS_REVIEW",
  "DUPLICATE_REVIEW",
  "MATCH_REVIEW",
  "ENDED_TOO_EARLY",
  "TEACHER_IDENTITY_REVIEW",
  "PARTICIPANT_IDENTITY_REVIEW",
  "BACKDATED_REVIEW",
  "INCENTIVE_REVIEW",
];

export async function pollOnlineMeetings({
  db = prisma,
  check = checkOnlineMeeting,
  now = new Date(),
  concurrency = 3,
} = {}) {
  const eligibleWhere = {
    trackingEnabled: true,
    deletedAt: null,
    status: { not: "CANCELLED" },
    verificationStatus: {
      notIn: TERMINAL_MEET_VERIFICATION_STATUSES,
    },
  };

  const rows = await db.facultyOnlineClass.findMany({
    where: {
      ...eligibleWhere,
      OR: [
        { nextCheckAt: null },
        { nextCheckAt: { lte: now } },
        { lastCheckedAt: null },
        {
          verificationStatus: "LIVE",
          actualEndAt: { not: null },
        },
      ],
      startsAt: {
        lte: new Date(+now + MEET_START_TOLERANCE_MS),
      },
    },
    orderBy: [
      { nextCheckAt: "asc" },
      { id: "asc" },
    ],
    take: 10,
    select: {
      id: true,
      verificationStatus: true,
      conferenceName: true,
      conferenceSpace: true,
      actualStartAt: true,
      startsAt: true,
      endsAt: true,
      attendanceEvidence: true,
    },
  });

  const limit = resolveMeetPollConcurrency(concurrency);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(limit, rows.length) },
    async () => {
      while (nextIndex < rows.length) {
        const row = rows[nextIndex++];

try {
          await check(row.id, null, { db, now });
        } catch (error) {
          if (!["CHECK_RUNNING", "CHECK_NOT_DUE"].includes(error.code)) {
            console.warn("meet.poll.failed", {
              code: error.code || "UNAVAILABLE",
            });
          }
        }
      }
    }
  );

  await Promise.all(workers);

  // A full batch may mean more due classes remain.
  if (rows.length === 10) {
    return { nextDelayMs: 0 };
  }

  // Find the earliest retry deadline for eligible classes
  // already inside their conference window.
  const retryRow = await db.facultyOnlineClass.findFirst({
    where: {
      ...eligibleWhere,
      startsAt: {
        lte: new Date(+now + MEET_START_TOLERANCE_MS),
      },
      nextCheckAt: { gt: now },
      lastCheckedAt: { not: null },
    },
    orderBy: [
      { nextCheckAt: "asc" },
      { id: "asc" },
    ],
    select: {
      nextCheckAt: true,
    },
  });

  // Find the earliest upcoming class outside its conference window.
  const upcomingRow = await db.facultyOnlineClass.findFirst({
    where: {
      ...eligibleWhere,
      startsAt: {
        gt: new Date(+now + MEET_START_TOLERANCE_MS),
      },
    },
    orderBy: [
      { startsAt: "asc" },
      { id: "asc" },
    ],
    select: {
      startsAt: true,
    },
  });

  const deadlines = [];

  if (retryRow?.nextCheckAt) {
    deadlines.push(+retryRow.nextCheckAt);
  }

  if (upcomingRow) {
    deadlines.push(
      +upcomingRow.startsAt - MEET_START_TOLERANCE_MS,
    );
  }

  const nextDeadline = deadlines.length
    ? Math.min(...deadlines)
    : null;

  return {
    nextDelayMs:
      nextDeadline === null
        ? null
        : Math.max(0, nextDeadline - +now),
  };
}




export function startMeetPollingWorker({
  env = process.env,
  poll = pollOnlineMeetings,
  intervalMs = 30 * 60 * 1000,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
} = {}) {
  if (env.ENABLE_MEET_POLLING === "false") {
    console.info("meet.worker.disabled");
    return async () => {};
  }

  const concurrency = resolveMeetPollConcurrency(
    env.MEET_POLL_CONCURRENCY
  );

  console.info("meet.worker.started", {
    concurrency,
    recoveryIntervalMs: intervalMs,
  });

  let stopped = false;
  let timer = null;
  let active = null;
  let wakeRequested = false;

  const scheduleNext = (delayMs) => {
    if (stopped) return;

    timer = schedule(() => {
      timer = null;
      startRun();
    }, delayMs);

    timer?.unref?.();
  };

  const run = async () => {
    let result = null;

    try {
      result = await poll({ concurrency });
    } catch (error) {
      console.warn("meet.worker.failed", {
        code: error.code || "UNAVAILABLE",
      });
    }

    // Mark the current poll as finished before handling wake requests.
    active = null;

    if (stopped) return;

    if (wakeRequested) {
      wakeRequested = false;
      startRun();
      return;
    }

    const suggestedDelay = Number.isFinite(result?.nextDelayMs)
      ? Math.max(0, result.nextDelayMs)
      : intervalMs;

    // The recovery interval is the default sleep time.
    // It also discovers work created by other backend instances.
    scheduleNext(suggestedDelay);
  };

  const startRun = () => {
    if (stopped) return;

    if (active) {
      wakeRequested = true;
      return;
    }

    wakeRequested = false;
    active = run();
  };

  const wake = () => {
    if (stopped) return;

    if (timer !== null) {
      cancelSchedule(timer);
      timer = null;
    }

    if (active) {
      wakeRequested = true;
      return;
    }

    startRun();
  };

  const unregisterWakeHandler =
    registerMeetWorkerWakeHandler(wake);

  startRun();

  return async () => {
    stopped = true;
    unregisterWakeHandler();

    if (timer !== null) {
      cancelSchedule(timer);
      timer = null;
    }

    await active;
  };
}