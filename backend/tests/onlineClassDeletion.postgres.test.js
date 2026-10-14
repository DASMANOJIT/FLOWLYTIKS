import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deleteFacultyOnlineClass } from "../services/facultyOnlineClassDeletionService.js";
import { listOnlineClasses, transitionOnlineClass } from "../services/facultyOnlineClassService.js";
import { withIncentiveOperationLock } from "../services/incentiveCopySetService.js";
import { finalizeMeeting } from "../services/meetVerificationService.js";
import { requireDisposableDatabase } from "./disposableDatabase.js";

if (process.env.RUN_ONLINE_DELETE_POSTGRES_TESTS === "true") requireDisposableDatabase();

test("PostgreSQL class tombstones atomically reverse unpaid snapshots and protect races/history", { skip: process.env.RUN_ONLINE_DELETE_POSTGRES_TESTS !== "true" }, async () => {
  await import("../config/loadEnv.js");
  const { default: db } = await import("../prisma/client.js");
  const facultyId = randomUUID(), otherId = randomUUID(), typeId = randomUUID();
  let payment, release;
  try {
    for (const id of [facultyId, otherId]) await db.faculty.create({ data: { id, facultyId: `FAC_DELETE_TEST_${id}`, username: `delete-test-${id}`, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Isolated Deletion Test", phone: `test-${id}`, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "INACTIVE" } });
    await db.extraIncentiveType.create({ data: { id: typeId, name: `Isolated Online Deletion ${typeId}`, rate: 300 } });
    const make = async (credited = false, status = "SCHEDULED") => {
      const entry = credited ? await db.facultyExtraIncentiveEntry.create({ data: { facultyId, incentiveTypeId: typeId, quantityChange: 1, rateSnapshot: 237.5, amountSnapshot: 237.5, status: "PENDING", createdByType: "FACULTY", createdById: facultyId } }) : null;
      return db.facultyOnlineClass.create({ data: { facultyId, incentiveTypeId: typeId, requestId: randomUUID(), batchName: "Test Batch", className: "Test", topic: "Isolated Delete Test", startsAt: new Date("2026-10-12T10:00:00Z"), endsAt: new Date("2026-10-12T11:00:00Z"), meetUrl: "https://meet.google.com/abc-defg-hij", status, trackingEnabled: true, pollLeaseToken: randomUUID(), conferenceName: credited ? `conferenceRecords/${randomUUID()}` : null, incentiveEntryId: entry?.id } });
    };
    const credited = await make(true, "CANCELLED");
    await assert.rejects(deleteFacultyOnlineClass(otherId, credited.id), { status: 404 });
    const attempts = await Promise.allSettled([deleteFacultyOnlineClass(facultyId, credited.id), deleteFacultyOnlineClass(facultyId, credited.id)]);
    assert.ok(attempts.some(result => result.status === "fulfilled"));
    for (const result of attempts) if (result.status === "rejected") assert.equal(result.reason.status, 409);
    await deleteFacultyOnlineClass(facultyId, credited.id);
    const total = await db.facultyExtraIncentiveEntry.aggregate({ where: { facultyId }, _sum: { quantityChange: true, amountSnapshot: true } });
    assert.equal(total._sum.quantityChange, 0); assert.equal(Number(total._sum.amountSnapshot), 0);
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId } }), 2);
    const tombstone = await db.facultyOnlineClass.findUnique({ where: { id: credited.id } });
    assert.ok(tombstone.deletedAt); assert.equal(tombstone.conferenceName, credited.conferenceName); assert.equal(tombstone.pollLeaseToken, null);
    assert.equal((await listOnlineClasses({ facultyId })).records.length, 0);
    await assert.rejects(db.facultyOnlineClass.create({ data: { facultyId, incentiveTypeId: typeId, requestId: randomUUID(), batchName: "Test", className: "Test", topic: "Duplicate", startsAt: credited.startsAt, endsAt: credited.endsAt, meetUrl: credited.meetUrl, conferenceName: credited.conferenceName } }), { code: "P2002" });
    for (const status of ["SCHEDULED", "CANCELLED"]) {
      const row = await make(false, status); await deleteFacultyOnlineClass(facultyId, row.id);
      assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId } }), 2);
      await db.$transaction(tx => finalizeMeeting(tx, row, { complete: true, teacherVerified: true, verifiedNonTeacher: true }, new Date(), new Date()));
      assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId } }), 2, "Stale worker cannot credit a tombstone");
    }
    const paid = await make(true, "COMPLETED");
    await db.facultyExtraIncentiveEntry.update({ where: { id: paid.incentiveEntryId }, data: { status: "PAID" } });
    await assert.rejects(deleteFacultyOnlineClass(facultyId, paid.id), { status: 409 });
    const processing = await make(true, "COMPLETED");
    const admin = await db.admin.findFirst({ select: { id: true } });
    assert.ok(admin, "A development Admin is required for the isolated payout reference");
    const record = await db.facultyExtraIncentivePayment.create({ data: { facultyId, totalAmount: 237.5, status: "PROCESSING", paidByAdminId: admin.id } });
    await db.facultyExtraIncentiveEntry.update({ where: { id: processing.incentiveEntryId }, data: { paymentRecordId: record.id } });
    await assert.rejects(deleteFacultyOnlineClass(facultyId, processing.id), { status: 409 });
    for (const status of ["LIVE", "COMPLETED"]) {
      const protectedClass = await make(false, status);
      for (const actor of [null, { type: "ADMIN", id: "test-admin" }]) await assert.rejects(deleteFacultyOnlineClass(facultyId, protectedClass.id, db, actor), { status: 409 });
      await assert.rejects(transitionOnlineClass(facultyId, protectedClass.id, "cancel", db), { status: 409 });
      assert.equal((await db.facultyOnlineClass.findUnique({ where: { id: protectedClass.id } })).status, status);
    }
    const historical = await make(false, "CANCELLED");
    await db.facultyOnlineClass.update({ where: { id: historical.id }, data: { actualStartAt: new Date() } });
    await assert.rejects(deleteFacultyOnlineClass(facultyId, historical.id), { status: 409 });
    const rollback = await make(true, "CANCELLED");
    const before = await db.facultyExtraIncentiveEntry.count({ where: { facultyId } });
    const failingDb = {
      facultyExtraIncentiveOperationLock: db.facultyExtraIncentiveOperationLock,
      $transaction: work => db.$transaction(tx => work(new Proxy(tx, { get(target, key) {
        if (key === "facultyOnlineClass") return new Proxy(tx.facultyOnlineClass, { get(model, method) {
          if (method === "update") return async () => { throw new Error("Controlled tombstone write failure"); };
          return model[method];
        } });
        return target[key];
      } }))),
    };
    await assert.rejects(deleteFacultyOnlineClass(facultyId, rollback.id, failingDb), /Controlled tombstone write failure/);
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId } }), before, "Failed tombstone write rolls back the reversal");
    assert.equal((await db.facultyOnlineClass.findUnique({ where: { id: rollback.id } })).deletedAt, null);
    const raced = await make(true, "CANCELLED");
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    payment = withIncentiveOperationLock(facultyId, async guard => {
      entered(); await new Promise(resolve => { release = resolve; });
      await db.$transaction(async tx => { await guard(tx); await tx.facultyExtraIncentiveEntry.update({ where: { id: raced.incentiveEntryId }, data: { status: "PAID" } }); });
    });
    await ready;
    await assert.rejects(deleteFacultyOnlineClass(facultyId, raced.id), { status: 409 });
    release(); await payment; payment = null;
    await assert.rejects(deleteFacultyOnlineClass(facultyId, raced.id), { status: 409 });
    const statusRace = await make(false);
    let unlock, locked;
    const lockReady = new Promise(resolve => { locked = resolve; });
    const verifier = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "FacultyOnlineClass" WHERE "id" = ${statusRace.id} FOR UPDATE`;
      locked(); await new Promise(resolve => { unlock = resolve; });
      await tx.facultyOnlineClass.update({ where: { id: statusRace.id }, data: { status: "LIVE", actualStartAt: new Date() } });
    });
    await lockReady;
    const deletion = deleteFacultyOnlineClass(facultyId, statusRace.id);
    unlock(); await verifier;
    await assert.rejects(deletion, { status: 409 });
  } finally {
    release?.(); if (payment) await payment.catch(() => {});
    await db.$transaction(async tx => {
      await tx.facultyOnlineClass.deleteMany({ where: { facultyId } });
      await tx.facultyExtraIncentiveEntry.deleteMany({ where: { facultyId } });
      await tx.facultyExtraIncentivePayment.deleteMany({ where: { facultyId } });
      await tx.faculty.deleteMany({ where: { id: { in: [facultyId, otherId] }, username: { startsWith: "delete-test-" } } });
      await tx.extraIncentiveType.deleteMany({ where: { id: typeId } });
    });
    await db.$disconnect();
  }
});
