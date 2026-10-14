import { Prisma } from "@prisma/client";
import prisma from "../prisma/client.js";
import { withIncentiveOperationLock } from "./incentiveCopySetService.js";
import { onlineClassDeletionBlockedReason } from "./facultyOnlineClassService.js";

const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };

export async function deleteFacultyOnlineClass(facultyId, id, db = prisma, actor = null) {
  return withIncentiveOperationLock(facultyId, guard => db.$transaction(async tx => {
    await guard(tx);
    await tx.$queryRaw`SELECT "id" FROM "FacultyOnlineClass" WHERE "id" = ${id} AND "facultyId" = ${facultyId} FOR UPDATE`;
    const row = await tx.facultyOnlineClass.findFirst({ where: { id, facultyId }, include: { incentiveEntry: true } });
    if (!row) fail("Class not found.", 404);
    if (row.deletedAt) return { id, deleted: true, alreadyDeleted: true };
    const blocked = onlineClassDeletionBlockedReason(row);
    if (blocked) fail(blocked, 409);
    if (row.incentiveEntryId && !row.incentiveEntry) fail("The linked incentive needs admin review before deletion.", 409);
    const entry = row.incentiveEntry;
    if (entry && (entry.status !== "PENDING" || entry.paymentRecordId)) fail("This class is linked to a paid or processing payout. Admin correction is required.", 409);
    if (entry && (entry.facultyId !== facultyId || entry.incentiveTypeId !== row.incentiveTypeId || entry.quantityChange <= 0)) fail("The linked incentive needs admin correction before deletion.", 409);
    if (entry) {
      await tx.facultyExtraIncentiveEntry.create({ data: {
        facultyId, incentiveTypeId: entry.incentiveTypeId, quantityChange: -entry.quantityChange,
        rateSnapshot: entry.rateSnapshot, amountSnapshot: new Prisma.Decimal(entry.amountSnapshot).negated(),
        status: "PENDING", createdByType: actor?.type || "FACULTY", createdById: actor ? String(actor.id) : facultyId,
        note: `Online class deletion reversal (${id}): ${row.topic}`,
      } });
    }
    await tx.facultyOnlineClass.update({ where: { id }, data: {
      deletedAt: new Date(), status: "CANCELLED", pollLeaseToken: null, pollLeaseUntil: null, nextCheckAt: null,
    } });
    return { id, deleted: true, alreadyDeleted: false, reversedAmount: entry ? Number(entry.amountSnapshot) : 0 };
  }), db);
}
