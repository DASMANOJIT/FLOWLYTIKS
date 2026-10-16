import prisma from "../prisma/client.js";
import { resolveClassDirectory } from "./adminOnlineClassService.js";

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const isOnlineDoubtClass = type => String(type?.name || "").trim().replace(/\s+/g, " ").toUpperCase() === "ONLINE DOUBT CLASS";
export const usesOnlineClassWorkflow = async (db, type) => isOnlineDoubtClass(type) || Boolean(await db.facultyOnlineClass.findFirst({ where: { incentiveTypeId: type.id }, select: { id: true } }));

export function validateOnlineClass(body) {
  const data = {};
  for (const [key, max] of [["topic", 200]]) {
    if (typeof body?.[key] !== "string" || !body[key].trim() || body[key].trim().length > max) fail(`${key} is required and must be at most ${max} characters.`);
    data[key] = body[key].trim();
  }
  if (body.message != null && (typeof body.message !== "string" || body.message.length > 2000)) fail("Announcement must be at most 2000 characters.");
  data.message = body.message?.trim() || null;
  if (![body.date, body.startTime].every(value => typeof value === "string") || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.startTime || "")) fail("A valid class date and start time in IST are required.");
  const calendar = new Date(`${body.date}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== body.date) fail("Class date is invalid.");
  data.startsAt = new Date(`${body.date}T${body.startTime}:00+05:30`);
  // Older clients may still submit an end. Omitting it on edit retains the historical value.
  if (body.endTime != null && body.endTime !== "") {
    if (typeof body.endTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.endTime)) fail("Invalid scheduled end time.");
    data.endsAt = new Date(`${body.date}T${body.endTime}:00+05:30`);
    if (data.endsAt <= data.startsAt) fail("End time must be after start time on the class date.");
  }
  let url;
  try { url = new URL(body.meetUrl); } catch { fail("Enter a valid HTTPS Google Meet link."); }
  if (url.protocol !== "https:" || url.hostname !== "meet.google.com" || url.port || url.username || url.password || !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)) fail("Enter a valid HTTPS Google Meet link.");
  data.meetUrl = `https://meet.google.com${url.pathname.replace(/\/$/, "")}`;
  return data;
}

export const onlineClassInclude = { batches: { orderBy: { batchId: "asc" } }, faculty: { select: { fullName: true, facultyId: true } }, incentiveEntry: { select: { id: true, rateSnapshot: true, amountSnapshot: true, status: true, paymentRecordId: true } } };
export const onlineClassBatchNames = row => row.batches?.length ? row.batches.map(batch => batch.nameSnapshot) : [row.batchName].filter(Boolean);
export function onlineClassDeletionBlockedReason(row) {
  if (!["SCHEDULED", "CANCELLED"].includes(row.status) || row.actualStartAt || row.actualEndAt || row.completedAt) return "Live or completed classes cannot be deleted, including after cancellation.";
  if (row.incentiveEntry && (row.incentiveEntry.status !== "PENDING" || row.incentiveEntry.paymentRecordId)) return "Linked payout is paid or processing. Admin correction is required.";
  return null;
}
const include = onlineClassInclude;
const dateFormat = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" });
export function onlineClassDto(row, now = new Date()) {
  const teacherName = row.faculty.fullName;
  const ended = Boolean(row.conferenceName && row.actualStartAt && row.actualEndAt && row.actualEndAt >= row.actualStartAt);
  const status = ended && row.status !== "CANCELLED" ? "COMPLETED" : row.status;
  const staleLive = ended && row.verificationStatus === "LIVE";
  return { id: row.id, facultyId: row.facultyId, teacherName, facultyCode: row.faculty.facultyId,
    incentiveTypeId: row.incentiveTypeId, directoryGradeId: row.directoryGradeId || null, batchIds: (row.batches || []).map(batch => batch.batchId), batchNames: onlineClassBatchNames(row), batchName: onlineClassBatchNames(row).join(", "), className: row.className, topic: row.topic, message: row.message,
    startsAt: row.startsAt, endsAt: row.endsAt, meetUrl: row.meetUrl, status, updatedAt: row.updatedAt,
    liveConfirmed: row.status === "LIVE" && row.verificationStatus === "LIVE" && Boolean(row.conferenceName && row.actualStartAt) && !row.actualEndAt && !row.verificationError,
    canComplete: false, trackingEnabled: Boolean(row.trackingEnabled),
    canEdit: !row.deletedAt && row.status === "SCHEDULED" && !row.conferenceName && !row.incentiveEntryId && !(row.pollLeaseUntil > now),
    canCancel: !row.deletedAt && row.status === "SCHEDULED" && !row.actualStartAt && !row.actualEndAt && !row.completedAt && !row.incentiveEntryId,
    canDelete: !row.deletedAt && !onlineClassDeletionBlockedReason(row),
    deletionBlockedReason: onlineClassDeletionBlockedReason(row),
    verificationStatus: staleLive ? "ATTENDANCE_PENDING" : row.verificationStatus || "LEGACY", verificationError: staleLive ? "Meeting ended. Final attendance and incentive verification are pending; check again shortly." : row.verificationError,
    verificationPending: staleLive || ["PENDING", "MISSING_DATA", "ATTENDANCE_PENDING", "LIVE", "INCENTIVE_BUSY"].includes(row.verificationStatus),
    conferenceName: row.conferenceName, actualStartAt: row.actualStartAt, actualEndAt: row.actualEndAt,
    actualDurationSeconds: row.actualStartAt && row.actualEndAt ? Math.max(0, (row.actualEndAt - row.actualStartAt) / 1000) : null,
    attendance: row.attendanceEvidence?.summary || null, attendanceCompleteAt: row.attendanceCompleteAt,
    canDownloadAttendance: Boolean(row.attendanceCompleteAt && row.actualEndAt),
    incentive: row.incentiveEntry ? { id: row.incentiveEntry.id, rate: Number(row.incentiveEntry.rateSnapshot), amount: Number(row.incentiveEntry.amountSnapshot), status: row.incentiveEntry.status, paymentRecordId: row.incentiveEntry.paymentRecordId } : null,
    announcement: `Online Doubt Class\nTeacher: ${teacherName}\nBatches: ${onlineClassBatchNames(row).join(", ")}${row.className ? `\nClass: ${row.className}` : ""}\nTopic: ${row.topic}\nDate: ${dateFormat.format(row.startsAt)}\nStart: ${timeFormat.format(row.startsAt)} IST\nGoogle Meet: ${row.meetUrl}${row.message ? `\n\n${row.message}` : ""}` };
}

export function onlineClassHistoryWhere({ search = "", date = "", batch = "" } = {}) {
  for (const [value, max] of [[search, 200], [date, 10], [batch, 120]]) {
    if (typeof value !== "string" || value.length > max) fail("Invalid history filter.");
  }
  const dayRange = value => {
    const calendar = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value) fail("Invalid class date filter.");
    const start = new Date(`${value}T00:00:00+05:30`);
    return { gte: start, lt: new Date(start.getTime() + 86400000) };
  };
  const where = {};
  if (date) where.startsAt = dayRange(date);
  if (batch.trim()) where.AND = [{ OR: [{ batches: { some: { nameSnapshot: { equals: batch.trim(), mode: "insensitive" } } } }, { batches: { none: {} }, batchName: { equals: batch.trim(), mode: "insensitive" } }] }];
  const text = search.trim();
  if (text) {
    const alternatives = [{ topic: { contains: text, mode: "insensitive" } }, { batches: { none: {} }, batchName: { contains: text, mode: "insensitive" } }, { batches: { some: { nameSnapshot: { contains: text, mode: "insensitive" } } } }];
    let searchDate = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
    const numeric = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
    if (numeric) searchDate = `${numeric[3]}-${numeric[2]}-${numeric[1]}`;
    const displayed = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i.exec(text);
    if (displayed) {
      const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const month = months.indexOf(displayed[2].slice(0, 3).toLowerCase());
      if (month >= 0) searchDate = `${displayed[3]}-${String(month + 1).padStart(2, "0")}-${displayed[1].padStart(2, "0")}`;
    }
    if (searchDate) {
      try { alternatives.push({ startsAt: dayRange(searchDate) }); } catch { /* Invalid date text may still match a topic. */ }
    }
    where.OR = alternatives;
  }
  return where;
}

export async function listOnlineClasses({ facultyId, incentiveTypeId, paymentId, page = 1, historyFilters = false, search, date, batch, status }, db = prisma) {
  if (!Number.isInteger(page) || page < 1 || page > 100000) fail("Invalid page.");
  if (facultyId != null && (typeof facultyId !== "string" || facultyId.length > 64)) fail("Invalid faculty filter.");
  if (status && !["SCHEDULED", "LIVE", "COMPLETED", "CANCELLED"].includes(status)) fail("Invalid class status.");
  const scope = { deletedAt: null, ...(facultyId ? { facultyId } : {}), ...(incentiveTypeId ? { incentiveTypeId } : {}), ...(paymentId ? { incentiveEntry: { paymentRecordId: paymentId } } : {}) };
  const where = { ...scope, ...(historyFilters ? onlineClassHistoryWhere({ search, date, batch }) : {}), ...(status ? { status } : {}) };
  const rows = await db.facultyOnlineClass.findMany({ where, include, orderBy: [{ startsAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 21 });
  const metadata = historyFilters ? {
    total: await db.facultyOnlineClass.count({ where }),
    batches: [...new Set([
      ...(await db.onlineClassBatch.findMany({ where: { isActive: true }, select: { name: true } })).map(batch => batch.name),
      ...(await db.facultyOnlineClass.findMany({ where: scope, select: { batchName: true, batches: { select: { nameSnapshot: true } } } })).flatMap(onlineClassBatchNames),
    ])].sort((a, b) => a.localeCompare(b)),
  } : {};
  return { records: rows.slice(0, 20).map(row => onlineClassDto(row)), hasMore: rows.length > 20, serverNow: new Date(), ...metadata };
}

export async function saveOnlineClass(facultyId, body, id = null, db = prisma) {
  const data = validateOnlineClass(body);
  return db.$transaction(async tx => {
    if (id) {
      await tx.$queryRaw`SELECT "id" FROM "FacultyOnlineClass" WHERE "id" = ${id} AND "facultyId" = ${facultyId} FOR UPDATE`;
      const row = await tx.facultyOnlineClass.findFirst({ where: { id, facultyId }, include: { batches: true } });
      if (!row) fail("Class not found.", 404);
      if (row.deletedAt) fail("Class not found.", 404);
      if (row.status !== "SCHEDULED") fail("Only scheduled classes can be edited.", 409);
      if (row.incentiveEntryId) fail("Credited classes require admin correction and cannot be edited here.", 409);
      if (row.conferenceName || row.pollLeaseUntil > new Date()) fail("A meeting is being tracked. It cannot be rescheduled or changed.", 409);
      if (body.expectedUpdatedAt !== row.updatedAt.toISOString()) fail("This class changed. Refresh before editing.", 409);
      const directory = await resolveClassDirectory(body, row, tx);
      return onlineClassDto(await tx.facultyOnlineClass.update({ where: { id }, data: { ...data, ...directory, ...(row.trackingEnabled ? { nextCheckAt: data.startsAt, verificationStatus: "PENDING", verificationError: null, attendanceEvidence: null } : {}) }, include }));
    }
    if (typeof body.requestId !== "string" || !/^[a-zA-Z0-9_-]{10,64}$/.test(body.requestId)) fail("A valid request ID is required.");
    const type = await tx.extraIncentiveType.findFirst({ where: { id: body.incentiveTypeId, isActive: true } });
    if (!type || !await usesOnlineClassWorkflow(tx, type)) fail("Online doubt class incentive not found.", 404);
    // Serialize retries of the same save before checking the unique request key.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${facultyId}:${body.requestId}`}, 0))::text`;
    const existing = await tx.facultyOnlineClass.findUnique({ where: { facultyId_requestId: { facultyId, requestId: body.requestId } }, include });
    if (existing?.deletedAt) fail("This class was deleted. Start a new class submission.", 409);
    if (existing) return onlineClassDto(existing);
    const directory = await resolveClassDirectory(body, null, tx);
    return onlineClassDto(await tx.facultyOnlineClass.create({ data: { ...data, ...directory, facultyId, incentiveTypeId: type.id, requestId: body.requestId, trackingEnabled: true, verificationStatus: "PENDING", nextCheckAt: data.startsAt }, include }));
  });
}

export async function transitionOnlineClass(facultyId, id, action, db = prisma, now = new Date()) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "FacultyOnlineClass" WHERE "id" = ${id} AND "facultyId" = ${facultyId} FOR UPDATE`;
    const row = await tx.facultyOnlineClass.findFirst({ where: { id, facultyId }, include });
    if (!row) fail("Class not found.", 404);
    if (row.deletedAt) fail("Class not found.", 404);
    if (action === "complete" && row.status === "COMPLETED") return onlineClassDto(row, now);
    if (action === "cancel" && row.status === "CANCELLED") return onlineClassDto(row, now);
    if (row.incentiveEntryId || row.incentiveEntry || row.status !== "SCHEDULED" || row.actualStartAt || row.actualEndAt || row.completedAt) fail("Only scheduled classes with no live or completed history can be cancelled here.", 409);
    if (action === "cancel") return onlineClassDto(await tx.facultyOnlineClass.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now, pollLeaseToken: null, pollLeaseUntil: null }, include }), now);
    if (action !== "complete") fail("Invalid class action.");
    fail("Manual completion is disabled. Use Check Meeting Status for Google verification.", 409);
  });
}
