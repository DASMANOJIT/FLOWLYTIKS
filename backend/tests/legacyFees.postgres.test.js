import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("legacy fee helper serializes cash replay and reversal cannot overwrite newer online evidence", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { createCashPaymentForStudent, reversePayment, bulkUpdatePayments, markPaid } = await import("../controllers/paymentcontrollers.js");
  const admin = await db.admin.findFirstOrThrow();
  const student = await db.student.create({ data: { name: "Legacy fee fixture", password: "TEST_LOGIN_DISABLED", phone: randomUUID(), school: "Test", class: "8", isVerified: true } });
  const run = async (handler, body, userRole = "admin") => { const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await handler({ userRole, user: admin, body, headers: {} }, res); return res; };
  const originalFind = db.payment.findFirst;
  try {
    const snapshot = () => db.payment.findMany({ where: { studentId: student.id } });
    for (const handler of [markPaid, bulkUpdatePayments, reversePayment]) {
      for (const role of [undefined, "faculty", "staff", "student"]) assert.equal((await run(handler, { studentId: student.id }, role || "anonymous")).code, 403);
    }
    assert.deepEqual(await snapshot(), []);
    assert.equal((await run(markPaid, { studentId: student.id, month: "invalid" })).code, 400);
    assert.equal((await run(bulkUpdatePayments, { studentIds: [student.id], month: "June", status: "pending", paymentMode: "cash" })).code, 400);
    const cash = () => db.$transaction(tx => createCashPaymentForStudent({ tx, studentId: student.id, month: "June", academicYear: 2026, monthlyFee: 600, adminId: admin.id, runPostPaymentActions: false }));
    const attempts = await Promise.allSettled([cash(), cash(), cash()]);
    assert.ok(attempts.every(result => result.status === "fulfilled"), "Cash replay must not abort its transaction after a uniqueness conflict");
    assert.equal(attempts.filter(result => result.value.outcome === "created").length, 1);
    const payment = (await snapshot())[0]; assert.equal(payment.amount, 600);
    const reversal = { studentId: student.id, paymentId: payment.id, month: "June", academicYear: 2026 };
    assert.equal((await run(reversePayment, { ...reversal, studentId: student.id + 999999 })).code, 404);
    const before = await snapshot();
    await assert.rejects(db.$transaction(async tx => { await createCashPaymentForStudent({ tx, studentId: student.id, month: "July", academicYear: 2026, monthlyFee: 600, runPostPaymentActions: false }); throw new Error("Injected rollback"); }), /Injected rollback/);
    assert.deepEqual(await snapshot(), before);
    const reversals = await Promise.all([run(reversePayment, reversal), run(reversePayment, reversal), run(reversePayment, reversal)]);
    assert.equal(reversals.filter(result => result.code === 200).length, 1);
    assert.equal((await run(reversePayment, reversal)).code, 409);
    await cash();
    db.payment.findFirst = async args => {
      const record = await originalFind.call(db.payment, args);
      if (record?.id === payment.id) await db.payment.update({ where: { id: payment.id }, data: { paymentProvider: "CASHFREE" } });
      return record;
    };
    assert.equal((await run(reversePayment, reversal)).code, 409, "Stale cash read cannot reverse an online payment");
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status, "paid");
    db.payment.findFirst = originalFind;
    const bulk = { studentIds: [student.id], month: "August", status: "paid", paymentMode: "cash" };
    assert.equal((await run(bulkUpdatePayments, bulk)).code, 200);
    assert.equal((await run(bulkUpdatePayments, bulk)).code, 409);
    assert.equal((await run(markPaid, { studentId: student.id, month: "September" })).code, 200);
    assert.equal((await run(markPaid, { studentId: student.id, month: "September" })).code, 409);
    const records = await snapshot();
    assert.equal(records.length, 3); assert.ok(records.every(row => row.amount === 600 && row.status === "paid"));
  } finally { db.payment.findFirst = originalFind; await db.$disconnect(); }
});
