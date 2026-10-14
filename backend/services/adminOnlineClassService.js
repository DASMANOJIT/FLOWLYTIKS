import prisma from "../prisma/client.js";
import { Prisma } from "@prisma/client";

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function directoryName(value, max = 120) {
  if (typeof value !== "string") fail("A name is required.");
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > max) fail(`Name must contain 1-${max} characters.`);
  return { name, normalizedName: name.toLocaleLowerCase("en-IN") };
}

export function currentOnlineClassWeek(now = new Date()) {
  const ist = new Date(+now + 330 * 60000);
  const midnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const start = new Date(midnight - ((ist.getUTCDay() - 5 + 7) % 7) * 86400000 - 330 * 60000);
  return { start, end: new Date(+start + 7 * 86400000) };
}

export async function getOnlineClassSummary(db = prisma, now = new Date()) {
  const { start, end } = currentOnlineClassWeek(now);
  const scope = { deletedAt: null };
  const [live, scheduled, taken] = await db.$transaction([
    db.facultyOnlineClass.count({ where: { ...scope, status: "LIVE", conferenceName: { not: null }, actualStartAt: { lte: now }, actualEndAt: null } }),
    db.facultyOnlineClass.count({ where: { ...scope, status: "SCHEDULED" } }),
    db.facultyOnlineClass.count({ where: { ...scope, status: "COMPLETED", verificationStatus: "VERIFIED", actualEndAt: { gte: start, lt: end, lte: now }, attendanceCompleteAt: { not: null } } }),
  ], { isolationLevel: "RepeatableRead" });
  return { live, scheduled, taken, weekStart: start, weekEnd: new Date(+end - 1), serverNow: now };
}

export async function listOnlineClassDirectory(activeOnly = false, db = prisma, search) {
  if (search != null && (typeof search !== "string" || search.length > 120)) fail("Invalid batch search.");
  if (search != null && !search.trim()) return [];
  return db.onlineClassBatch.findMany({ where: { isActive: true, ...(search != null ? { name: { contains: search.trim(), mode: "insensitive" } } : {}) },
    select: { id: true, name: true, isActive: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
}

export async function deleteOnlineClassBatch(id, db = prisma) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) fail("Invalid batch ID.");
  try {
    // The existing availability flag preserves references and name snapshots. Selection's
    // FOR SHARE lock serializes against this update, including simultaneous scheduling.
    return await db.onlineClassBatch.update({ where: { id }, data: { isActive: false }, select: { id: true, name: true, isActive: true } });
  } catch (error) { if (error.code === "P2025") fail("Batch not found.", 404); throw error; }
}

export async function saveDirectoryItem(kind, id, body, db = prisma) {
  if (!["batch", "grade"].includes(kind)) fail("Invalid directory item.");
  const data = directoryName(body?.name, kind === "grade" ? 80 : 120);
  if (body.isActive != null && typeof body.isActive !== "boolean") fail("Status must be active or inactive.");
  if (body.isActive != null) data.isActive = body.isActive;
  try {
    return await db.$transaction(async tx => {
      const model = kind === "batch" ? tx.onlineClassBatch : tx.onlineClassGrade;
      if (id) {
        if (!await model.findUnique({ where: { id } })) fail("Directory item not found.", 404);
        return model.update({ where: { id }, data });
      }
      if (kind === "grade") {
        if (typeof body.batchId !== "string" || !await tx.onlineClassBatch.findUnique({ where: { id: body.batchId } })) fail("Select an existing batch.");
        data.batchId = body.batchId;
      }
      return model.create({ data });
    });
  } catch (error) { if (error.code === "P2002") fail("This name already exists in the directory.", 409); throw error; }
}

export async function resolveClassDirectory(body, existing, tx) {
  const ids = body.batchIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) || new Set(ids).size !== ids.length) fail("Select at least one active batch (up to 50 unique batches).");
  const batches = await tx.$queryRaw(Prisma.sql`SELECT "id", "name", "isActive" FROM "OnlineClassBatch" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR SHARE`);
  if (batches.length !== ids.length || batches.some(batch => !batch.isActive)) fail("One or more selected batches are missing or inactive. Select active batches.");
  const snapshots = new Map((existing?.batches || []).map(batch => [batch.batchId, batch.nameSnapshot]));
  return { ...(!existing ? { batchName: batches[0].name, className: "" } : {}), batches: {
    ...(existing ? { deleteMany: {} } : {}),
    create: batches.map(batch => ({ batchId: batch.id, nameSnapshot: snapshots.get(batch.id) || batch.name })),
  } };
}
