import { randomUUID } from "node:crypto";
import prisma from "../prisma/client.js";
import { usesOnlineClassWorkflow } from "./facultyOnlineClassService.js";

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const leaseMs = 5 * 60000;
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const copySetDto = row => ({ id: row.id, incentiveTypeId: row.incentiveTypeId, name: row.incentiveType?.name || "Incentive", quantityChange: row.quantityChange, rate: Number(row.rateSnapshot), amount: Number(row.amountSnapshot), note: row.note, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, editable: row.status === "PENDING" && !row.paymentRecordId && row.quantityChange > 0 && !row.onlineClass });

// A durable lease also covers the payout's external-network phase, without holding a transaction open.
export async function withIncentiveOperationLock(facultyId, work, db = prisma) {
  const leaseId = randomUUID();
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Faculty" WHERE "id" = ${facultyId} FOR UPDATE`;
    if (!await tx.faculty.findUnique({ where: { id: facultyId }, select: { id: true } })) fail("Faculty not found.", 404);
    const current = await tx.facultyExtraIncentiveOperationLock.findUnique({ where: { facultyId } });
    if (current && current.expiresAt > new Date()) fail("An incentive update or payment is in progress. Please try again shortly.", 409);
    const data = { leaseId, expiresAt: new Date(Date.now() + leaseMs) };
    await tx.facultyExtraIncentiveOperationLock.upsert({ where: { facultyId }, create: { facultyId, ...data }, update: data });
  });
  const guard = async tx => {
    await tx.$queryRaw`SELECT "facultyId" FROM "FacultyExtraIncentiveOperationLock" WHERE "facultyId" = ${facultyId} FOR UPDATE`;
    const current = await tx.facultyExtraIncentiveOperationLock.findUnique({ where: { facultyId } });
    if (!current || current.leaseId !== leaseId || current.expiresAt <= new Date()) fail("The incentive operation expired. Refresh and try again.", 409);
  };
  let renewing = null;
  const timer = setInterval(() => {
    if (!renewing) renewing = db.facultyExtraIncentiveOperationLock.updateMany({ where: { facultyId, leaseId, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date(Date.now() + leaseMs) } })
      .catch(error => console.warn("incentive.lock_renewal_failed", { code: error.code, name: error.name })).finally(() => { renewing = null; });
  }, 30000);
  timer.unref();
  try { return await work(guard); }
  finally {
    clearInterval(timer);
    if (renewing) await renewing;
    await db.facultyExtraIncentiveOperationLock.updateMany({ where: { facultyId, leaseId }, data: { expiresAt: new Date(0) } })
      .catch(error => console.warn("incentive.lock_release_failed", { code: error.code, name: error.name }));
  }
}

export function validateCopySet(body) {
  if (!Number.isSafeInteger(body?.quantity) || body.quantity < 1 || body.quantity > 2147483647) fail("Number of copies must be a positive whole number.");
  if (body.remark != null && typeof body.remark !== "string") fail("Remark must be text.");
  const note = (body.remark || "").trim();
  if (note.length > 2000) fail("Remark must be 2000 characters or fewer.");
  return { quantity: body.quantity, note: note || null };
}

export async function saveCopySet(facultyId, incentiveTypeId, body, entryId = null, db = prisma) {
  const { quantity, note } = validateCopySet(body);
  if (!entryId && !uuid(body.requestId)) fail("A valid submission ID is required.");
  if (entryId && (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt)))) fail("Refresh the set before editing.");
  return withIncentiveOperationLock(facultyId, guard => db.$transaction(async tx => {
    await guard(tx);
    const type = await tx.extraIncentiveType.findFirst({ where: { id: incentiveTypeId, isActive: true } });
    if (!type) fail("Incentive type not found.", 404);
    if (await usesOnlineClassWorkflow(tx, type)) fail("Online doubt class incentives use the existing class workflow.", 403);
    const previous = await tx.facultyExtraIncentiveEntry.findUnique({ where: { id: entryId || body.requestId }, include: { incentiveType: true, onlineClass: { select: { id: true } } } });
    if (previous) {
      if (previous.facultyId !== facultyId || previous.incentiveTypeId !== incentiveTypeId) fail("Incentive set not found.", 404);
      if (!entryId) {
        if (previous.quantityChange !== quantity || previous.note !== note) fail("This submission was already saved with different details. Refresh the entries.", 409);
        return { entry: copySetDto(previous), changed: false };
      }
      if (!copySetDto(previous).editable) fail("Paid, processing or legacy adjustment entries cannot be edited.", 409);
      if (previous.quantityChange === quantity && previous.note === note) return { entry: copySetDto(previous), changed: false };
      if (+previous.updatedAt !== Date.parse(body.expectedUpdatedAt)) fail("This set changed. Refresh it before editing.", 409);
    } else if (entryId) fail("Incentive set not found.", 404);
    const rate = Number(previous ? previous.rateSnapshot : type.rate);
    const amount = Number((quantity * rate).toFixed(2));
    if (!Number.isFinite(amount) || rate <= 0 || amount > 9999999999.99) fail("The calculated amount is too large.");
    const data = { quantityChange: quantity, note, amountSnapshot: amount };
    const row = previous ? await tx.facultyExtraIncentiveEntry.update({ where: { id: entryId }, data, include: { incentiveType: true } }) : await tx.facultyExtraIncentiveEntry.create({ data: { id: body.requestId, facultyId, incentiveTypeId, ...data, rateSnapshot: rate, status: "PENDING", createdByType: "FACULTY", createdById: facultyId }, include: { incentiveType: true } });
    return { entry: copySetDto(row), changed: true, previous: previous ? { quantity: previous.quantityChange, remark: previous.note } : null };
  }), db);
}

export async function listCopySets(facultyId, incentiveTypeId, page = 1, db = prisma) {
  if (!Number.isSafeInteger(page) || page < 1) fail("Invalid page.");
  const where = { facultyId, status: { not: "DELETED" }, ...(incentiveTypeId ? { incentiveTypeId } : {}) };
  const [rows, total] = await Promise.all([
    db.facultyExtraIncentiveEntry.findMany({ where, include: { incentiveType: true, onlineClass: { select: { id: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 20 }),
    db.facultyExtraIncentiveEntry.count({ where }),
  ]);
  return { entries: rows.map(copySetDto), page, totalPages: Math.max(1, Math.ceil(total / 20)) };
}

export async function deleteCopySet(facultyId, incentiveTypeId, entryId, body, db = prisma, actorName = null) {
  if (typeof body?.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) fail("Refresh the set before deleting.");
  return withIncentiveOperationLock(facultyId, guard => db.$transaction(async tx => {
    await guard(tx);
    await tx.$queryRaw`SELECT "id" FROM "FacultyExtraIncentiveEntry" WHERE "id" = ${entryId} AND "facultyId" = ${facultyId} FOR UPDATE`;
    const entry = await tx.facultyExtraIncentiveEntry.findUnique({ where: { id: entryId }, include: { incentiveType: true, onlineClass: { select: { id: true } } } });
    if (!entry || entry.facultyId !== facultyId || entry.incentiveTypeId !== incentiveTypeId) fail("Incentive set not found.", 404);
    if (entry.onlineClass || await usesOnlineClassWorkflow(tx, entry.incentiveType)) fail("Online class entries cannot be deleted through copy sets.", 403);
    if (entry.status === "DELETED" && !entry.paymentRecordId) return { deleted: true, alreadyDeleted: true };
    if (!copySetDto(entry).editable) fail("Paid, processing, reserved, locked or legacy adjustment entries cannot be deleted.", 409);
    if (+entry.updatedAt !== Date.parse(body.expectedUpdatedAt)) fail("This set changed. Refresh it before deleting.", 409);
    // Retain the original quantity, rate and remark as financial history, but remove it from payable balances.
    await tx.facultyExtraIncentiveEntry.update({ where: { id: entry.id }, data: { status: "DELETED" } });
    await tx.auditLog.create({ data: {
      actorType: "FACULTY", actorId: facultyId, actorName,
      action: "EXTRA_INCENTIVE_SET_DELETED", entityType: "FacultyExtraIncentiveEntry", entityId: entry.id,
      metadataJson: { facultyId, incentiveTypeId, quantity: entry.quantityChange, rate: Number(entry.rateSnapshot), amount: Number(entry.amountSnapshot), remark: entry.note, previousStatus: entry.status, createdAt: entry.createdAt.toISOString(), previousUpdatedAt: entry.updatedAt.toISOString() },
    } });
    return { deleted: true, alreadyDeleted: false };
  }), db);
}
