import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { meetingFailure } from "../services/meetVerificationService.js";
import { requireDisposableDatabase } from "./disposableDatabase.js";

if (process.env.RUN_MEET_POSTGRES_TESTS === "true") requireDisposableDatabase();

test("production PostgreSQL migrations allow Scheduled -> Live -> Completed and still reject invalid lifecycle", { skip: process.env.RUN_MEET_POSTGRES_TESTS !== "true" }, async () => {
  await import("../config/loadEnv.js");
  const { default: db } = await import("../prisma/client.js");
  const rollback = new Error("ROLLBACK_ISOLATED_MEET_TEST");
  const requestId = randomUUID();
  try {
    const migrations = await db.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = '20261012010000_allow_live_online_class_status' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.equal(migrations.length, 1);
    await assert.rejects(db.$transaction(async tx => {
      const faculty = await tx.faculty.findFirst({ select: { id: true } });
      const type = await tx.extraIncentiveType.findFirst({ select: { id: true } });
      assert.ok(faculty && type, "Existing development faculty and incentive type required");
      const row = await tx.facultyOnlineClass.create({ data: { facultyId: faculty.id, incentiveTypeId: type.id, requestId, batchName: "Isolated regression", className: "Test", topic: "Rollback-only status constraint test", startsAt: new Date("2026-10-12T01:00:00Z"), endsAt: new Date("2026-10-12T02:00:00Z"), meetUrl: "https://meet.google.com/abc-defg-hij" } });
      assert.equal(row.status, "SCHEDULED");
      for (const status of ["LIVE", "COMPLETED"]) assert.equal((await tx.facultyOnlineClass.update({ where: { id: row.id }, data: { status } })).status, status);
      await tx.$executeRawUnsafe("SAVEPOINT invalid_lifecycle_probe");
      await assert.rejects(tx.facultyOnlineClass.update({ where: { id: row.id }, data: { status: "VERIFIED" } }), error => {
        assert.equal(meetingFailure(error).code, "DATABASE_ERROR");
        assert.equal(meetingFailure(error).diagnostic.sqlState, "23514"); return true;
      });
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_lifecycle_probe");
      assert.equal((await tx.facultyOnlineClass.findUnique({ where: { id: row.id } })).status, "COMPLETED");
      throw rollback;
    }), error => error === rollback);
    assert.equal(await db.facultyOnlineClass.count({ where: { requestId } }), 0);
  } finally { await db.$disconnect(); }
});
