import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getOnlineClassSummary, listOnlineClassDirectory, saveDirectoryItem, deleteOnlineClassBatch } from "../services/adminOnlineClassService.js";
import { saveOnlineClass, transitionOnlineClass, listOnlineClasses } from "../services/facultyOnlineClassService.js";
import { deleteFacultyOnlineClass } from "../services/facultyOnlineClassDeletionService.js";
import { requireDisposableDatabase } from "./disposableDatabase.js";

if (process.env.RUN_ADMIN_ONLINE_POSTGRES_TESTS === "true") requireDisposableDatabase();

test("PostgreSQL directory preserves legacy snapshots, validates selections and feeds real summary counts", { skip: process.env.RUN_ADMIN_ONLINE_POSTGRES_TESTS !== "true" }, async () => {
  await import("../config/loadEnv.js");
  const { default: db } = await import("../prisma/client.js");
  const facultyId = randomUUID(), tag = randomUUID();
  let batch, second;
  try {
    await db.faculty.create({ data: { id: facultyId, facultyId: `FAC_ADMIN_ONLINE_TEST_${tag}`, username: `admin-online-test-${tag}`, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Isolated Admin Class Test", phone: `test-${tag}`, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "INACTIVE" } });
    const type = await db.extraIncentiveType.findFirst({ where: { name: { equals: "ONLINE DOUBT CLASS", mode: "insensitive" }, isActive: true } });
    assert.ok(type, "An existing configured Online Doubt Class incentive is required");
    batch = await saveDirectoryItem("batch", null, { name: `  Test Batch ${tag}  ` });
    await assert.rejects(saveDirectoryItem("batch", null, { name: `TEST BATCH ${tag.toUpperCase()}` }), { status: 409 });
    const grade = await saveDirectoryItem("grade", null, { name: "Grade 10", batchId: batch.id });
    await assert.rejects(saveDirectoryItem("grade", null, { name: " grade 10 ", batchId: batch.id }), { status: 409 });
    second = await saveDirectoryItem("batch", null, { name: `Second Batch ${tag}` });
    const emptyHistory = await listOnlineClasses({ facultyId, historyFilters: true, search: "no classes yet" });
    assert.equal(emptyHistory.total, 0); assert.ok(emptyHistory.batches.includes(batch.name)); assert.ok(emptyHistory.batches.includes(second.name));
    const body = { batchIds: [batch.id, second.id], topic: "Isolated future scheduled class", date: "2099-10-09", startTime: "17:00", endTime: "18:00", meetUrl: "https://meet.google.com/abc-defg-hij", requestId: randomUUID(), incentiveTypeId: type.id };
    const record = await saveOnlineClass(facultyId, body);
    assert.deepEqual(new Set(record.batchIds), new Set(body.batchIds)); assert.equal(record.className, "");
    assert.match(record.announcement, new RegExp(second.name));
    await saveOnlineClass(facultyId, body);
    assert.equal(await db.facultyOnlineClass.count({ where: { facultyId } }), 1);
    for (const name of [batch.name, second.name]) assert.equal((await listOnlineClasses({ facultyId, historyFilters: true, batch: name })).total, 1);
    await saveDirectoryItem("batch", batch.id, { name: `Renamed ${tag}`, isActive: false });
    await saveDirectoryItem("grade", grade.id, { name: "Grade Ten", isActive: false });
    const saved = await db.facultyOnlineClass.findUnique({ where: { id: record.id } });
    assert.equal(saved.className, ""); assert.equal(saved.directoryGradeId, null);
    assert.deepEqual(new Set((await listOnlineClasses({ facultyId })).records[0].batchNames), new Set([batch.name, second.name]));
    assert.equal((await listOnlineClassDirectory(true)).some(item => item.id === batch.id), false);
    await assert.rejects(saveOnlineClass(facultyId, { ...body, requestId: randomUUID() }), /inactive/);
    await assert.rejects(saveOnlineClass(facultyId, { ...body, expectedUpdatedAt: saved.updatedAt.toISOString() }, saved.id), /inactive/);
    await saveOnlineClass(facultyId, { ...body, batchIds: [second.id], topic: "Updated by Admin workflow", expectedUpdatedAt: saved.updatedAt.toISOString() }, saved.id);
    assert.equal((await listOnlineClasses({ facultyId })).records[0].topic, "Updated by Admin workflow");
    await transitionOnlineClass(facultyId, record.id, "cancel");
    await deleteFacultyOnlineClass(facultyId, record.id, db, { type: "ADMIN", id: "test-admin" });
    assert.equal((await listOnlineClasses({ facultyId })).records.length, 0);
    const now = new Date("2026-10-15T18:29:59.999Z");
    const make = async (status, verificationStatus, end, extra = {}) => db.facultyOnlineClass.create({ data: { facultyId, incentiveTypeId: type.id, requestId: randomUUID(), batchName: "Legacy Batch", className: "Legacy Class", topic: "Isolated summary test", startsAt: new Date("2026-10-09T10:00:00Z"), endsAt: new Date("2026-10-09T11:00:00Z"), meetUrl: "https://meet.google.com/abc-defg-hij", status, verificationStatus, actualEndAt: end ? new Date(end) : null, attendanceCompleteAt: end ? now : null, ...extra } });
    await make("LIVE", "LIVE", null, { conferenceName: `conferenceRecords/${randomUUID()}`, actualStartAt: new Date("2026-10-15T17:00:00Z") });
    await make("SCHEDULED", "PENDING", null);
    await make("COMPLETED", "VERIFIED", "2026-10-08T18:30:00Z");
    await make("COMPLETED", "VERIFIED", "2026-10-15T18:29:59.999Z");
    await make("COMPLETED", "VERIFIED", "2026-10-08T18:29:59.999Z");
    await make("COMPLETED", "VERIFIED", "2026-10-15T18:30:00Z");
    await make("CANCELLED", "VERIFIED", "2026-10-10T11:00:00Z");
    await make("COMPLETED", "VERIFIED", "2026-10-10T11:00:00Z", { deletedAt: now });
    await make("COMPLETED", "TEACHER_IDENTITY_REVIEW", "2026-10-10T11:00:00Z");
    const scoped = { facultyOnlineClass: { count: args => db.facultyOnlineClass.count({ where: { ...args.where, facultyId } }) }, $transaction: queries => db.$transaction(queries) };
    const summary = await getOnlineClassSummary(scoped, now);
    assert.deepEqual([summary.live, summary.scheduled, summary.taken], [1, 1, 2]);
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId } }), 0);
    for (const status of ["SCHEDULED", "LIVE", "COMPLETED", "CANCELLED"]) {
      const row = await make(status, "LEGACY", null);
      await db.facultyOnlineClass.update({ where: { id: row.id }, data: { className: "Historical Grade", directoryGradeId: grade.id, attendanceEvidence: { retained: true }, batches: { create: { batchId: second.id, nameSnapshot: second.name } } } });
    }
    const before = await db.facultyOnlineClass.findMany({ where: { facultyId }, include: { batches: true }, orderBy: { id: "asc" } });
    assert.equal((await listOnlineClassDirectory(false, db, tag.toUpperCase())).length, 1);
    await deleteOnlineClassBatch(second.id, db); await deleteOnlineClassBatch(second.id, db);
    assert.deepEqual(await db.facultyOnlineClass.findMany({ where: { facultyId }, include: { batches: true }, orderBy: { id: "asc" } }), before);
    assert.equal((await listOnlineClassDirectory(false, db, tag)).length, 0);
    assert.equal((await listOnlineClassDirectory(true, db)).some(item => item.id === second.id), false);
    await assert.rejects(saveOnlineClass(facultyId, { ...body, batchIds: [second.id], requestId: randomUUID() }), /inactive/);
    await assert.rejects(saveDirectoryItem("batch", null, { name: second.name.toUpperCase() }), { status: 409 });
    assert.ok((await listOnlineClasses({ facultyId })).records.some(row => row.batchNames.includes(second.name)));
    const filteredEmpty = await listOnlineClasses({ facultyId, historyFilters: true, search: "no matching topics" });
    assert.equal(filteredEmpty.total, 0); assert.ok(filteredEmpty.batches.includes(second.name), "Deleted historical batches remain available independently of results");
  } finally {
    await db.$transaction(async tx => {
      await tx.facultyOnlineClass.deleteMany({ where: { facultyId } });
      await tx.faculty.deleteMany({ where: { id: facultyId, username: `admin-online-test-${tag}` } });
      if (batch) { await tx.onlineClassGrade.deleteMany({ where: { batchId: batch.id } }); await tx.onlineClassBatch.deleteMany({ where: { id: batch.id } }); }
      if (second) await tx.onlineClassBatch.deleteMany({ where: { id: second.id } });
    });
    await db.$disconnect();
  }
});
