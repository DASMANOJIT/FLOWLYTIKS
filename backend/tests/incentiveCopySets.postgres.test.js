import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { saveCopySet, withIncentiveOperationLock } from "../services/incentiveCopySetService.js";
import { requireDisposableDatabase } from "./disposableDatabase.js";

if (process.env.RUN_COPY_SET_POSTGRES_TESTS === "true") requireDisposableDatabase();

test("real PostgreSQL copy sets preserve snapshots, lock payments and deduplicate requests", { skip: process.env.RUN_COPY_SET_POSTGRES_TESTS !== "true" }, async () => {
  await import("../config/loadEnv.js");
  const { default: db } = await import("../prisma/client.js");
  const facultyId = randomUUID(), typeId = randomUUID();
  let release, payment;
  try {
    await db.faculty.create({ data: { id: facultyId, facultyId: `FAC_COPY_TEST_${facultyId}`, username: `copy-test-${facultyId}`, passwordHash: "TEST_ACCOUNT_LOGIN_DISABLED", fullName: "Isolated Copy Set Test", phone: `test-${facultyId}`, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "INACTIVE" } });
    await db.extraIncentiveType.create({ data: { id: typeId, name: `Isolated Copy Test ${typeId}`, rate: 100 } });
    const body = { quantity: 2, remark: "First isolated set", requestId: randomUUID() };
    const first = await saveCopySet(facultyId, typeId, body);
    await saveCopySet(facultyId, typeId, body);
    await saveCopySet(facultyId, typeId, { quantity: 3, remark: "Second isolated set", requestId: randomUUID() });
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId } }), 2);
    await db.extraIncentiveType.update({ where: { id: typeId }, data: { rate: 300 } });
    const edited = await saveCopySet(facultyId, typeId, { quantity: 4, remark: "Edited isolated set", expectedUpdatedAt: first.entry.updatedAt.toISOString() }, first.entry.id);
    assert.equal(edited.entry.rate, 100); assert.equal(edited.entry.amount, 400);
    const snapshot = await db.facultyExtraIncentiveEntry.aggregate({ where: { facultyId }, _sum: { quantityChange: true, amountSnapshot: true } });
    assert.equal(snapshot._sum.quantityChange, 7); assert.equal(Number(snapshot._sum.amountSnapshot), 700);
    await assert.rejects(saveCopySet("not-the-owner", typeId, { quantity: 1, expectedUpdatedAt: edited.entry.updatedAt.toISOString() }, first.entry.id), { status: 404 });
    let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    payment = withIncentiveOperationLock(facultyId, async guard => {
      entered(); await new Promise(resolve => { release = resolve; });
      await db.$transaction(async tx => {
        await guard(tx);
        await tx.facultyExtraIncentiveEntry.updateMany({ where: { facultyId, status: "PENDING" }, data: { status: "PAID" } });
      });
    });
    await ready;
    await assert.rejects(saveCopySet(facultyId, typeId, { quantity: 5, expectedUpdatedAt: edited.entry.updatedAt.toISOString() }, first.entry.id), { status: 409 });
    release(); await payment; payment = null;
    await assert.rejects(saveCopySet(facultyId, typeId, { quantity: 5, expectedUpdatedAt: edited.entry.updatedAt.toISOString() }, first.entry.id), { status: 409 });
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId, status: "PAID" } }), 2);
  } finally {
    if (release) release();
    if (payment) await payment.catch(() => {});
    // Only this test's randomly identified records are removed; existing faculties/ledger remain untouched.
    await db.$transaction(async tx => {
      await tx.facultyExtraIncentiveEntry.deleteMany({ where: { facultyId } });
      await tx.faculty.deleteMany({ where: { id: facultyId, username: `copy-test-${facultyId}` } });
      await tx.extraIncentiveType.deleteMany({ where: { id: typeId, name: `Isolated Copy Test ${typeId}` } });
    });
    assert.equal(await db.facultyExtraIncentiveEntry.count({ where: { facultyId } }), 0);
    await db.$disconnect();
  }
});
