import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { requireDisposableDatabase } from "./disposableDatabase.js";

const worker = message => new Promise((resolve, reject) => {
  const child = fork(new URL("./remainingLockProcess.js", import.meta.url), [], { execArgv: [], env: { ...process.env, DATABASE_URL: "" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let result;
  child.on("message", data => { if (data.ready) child.send(message); else if (data.result) result = data.result; });
  child.on("error", reject);
  child.on("exit", code => code === 0 && result ? resolve(result) : reject(new Error("Isolated lock worker failed")));
});

test("checkout reservation across processes survives retries, expired claims and stale finalizers", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true", timeout: 30000 }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { reserveCashfreeCheckout, finishCashfreeCheckout } = await import("../services/cashfreeCheckoutService.js");
  const student = await db.student.create({ data: { name: "Reservation test", phone: randomUUID(), password: "TEST_LOGIN_DISABLED", school: "Test", class: "8" } });
  const details = { studentId: student.id, academicYear: 2099, month: "June", amount: 600, teacherAdminId: null, environment: "sandbox", preferredMethod: "upi", notifyUrl: "https://example.invalid/webhook" };
  try {
    const results = await Promise.all([worker({ kind: "checkout", details }), worker({ kind: "checkout", details })]);
    const first = results.find(result => result.gatewayOrder);
    assert.ok(first); assert.equal(results.filter(result => result.locked).length, 1);
    assert.equal(await db.paymentGatewayOrder.count({ where: { studentId: student.id } }), 1);
    assert.equal((await reserveCashfreeCheckout(db, details)).locked, true);
    await db.paymentGatewayOrder.update({ where: { id: first.gatewayOrder.id }, data: { metadata: { ...first.gatewayOrder.metadata, checkoutLease: { id: first.leaseId, expiresAt: new Date(0).toISOString() } } } });
    const retry = await reserveCashfreeCheckout(db, details);
    assert.equal(retry.gatewayOrder.id, first.gatewayOrder.id);
    assert.equal(retry.gatewayOrder.cashfreeOrderId, first.gatewayOrder.cashfreeOrderId);
    assert.notEqual(retry.leaseId, first.leaseId);
    assert.equal((await finishCashfreeCheckout(db, first, { status: "FAILED" })).locked, true);
    const saved = await finishCashfreeCheckout(db, retry, { status: "INITIATED", paymentSessionId: "isolated-session", orderExpiryTime: new Date(Date.now() + 60000) });
    assert.equal(saved.gatewayOrder.status, "INITIATED");
    assert.equal((await reserveCashfreeCheckout(db, details)).reusableOrder.id, first.gatewayOrder.id);
    let release, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const verification = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`cashfree:finalize:${first.gatewayOrder.cashfreeOrderId}`})::bigint)::text`;
      await tx.payment.updateMany({ where: { studentId: student.id }, data: { status: "paid" } });
      await tx.paymentGatewayOrder.update({ where: { id: first.gatewayOrder.id }, data: { status: "PAID" } });
      entered(); await new Promise(resolve => { release = resolve; });
    });
    await ready;
    const lateCheckout = finishCashfreeCheckout(db, retry, { status: "FAILED" });
    await new Promise(resolve => setTimeout(resolve, 30)); release(); await verification;
    assert.equal((await lateCheckout).alreadyPaid, true);
    assert.equal((await db.paymentGatewayOrder.findUniqueOrThrow({ where: { id: first.gatewayOrder.id } })).status, "PAID");
    assert.equal((await finishCashfreeCheckout(db, retry, { status: "FAILED" })).alreadyPaid, true);
    assert.equal((await reserveCashfreeCheckout(db, details)).alreadyPaid, true);
  } finally { await db.$disconnect(); }
});

test("dispatcher claims one job across processes, repeats safely and fences stale completion", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true", timeout: 30000 }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { processPendingBackgroundJobs, claimNextBackgroundJob } = await import("../services/backgroundJobService.js");
  const key = `dispatch:${randomUUID()}`;
  const job = await db.backgroundJob.create({ data: { type: "DAILY_FEE_REMINDER", source: "test", dedupeKey: key } });
  try {
    const results = await Promise.all([worker({ kind: "job", jobId: job.id, key }), worker({ kind: "job", jobId: job.id, key })]);
    assert.equal(results.reduce((sum, result) => sum + result.count, 0), 1);
    assert.equal(await db.authRateLimitEvent.count({ where: { namespace: key } }), 1);
    assert.equal((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status, "COMPLETED");
    assert.equal(await processPendingBackgroundJobs({ db, jobId: job.id, execute: () => assert.fail("Completed job cannot run again") }), 0);
    await db.backgroundJob.update({ where: { id: job.id }, data: { status: "PENDING" } });
    await assert.rejects(db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'background-job-dispatcher'})::bigint)::text`;
      await tx.backgroundJob.update({ where: { id: job.id }, data: { status: "RUNNING" } });
      throw new Error("Controlled dispatch rollback");
    }), /Controlled dispatch rollback/);
    assert.equal((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status, "PENDING");
    await processPendingBackgroundJobs({ db, jobId: job.id, maxJobs: 1, execute: async () => {
      await db.backgroundJob.update({ where: { id: job.id }, data: { lastHeartbeatAt: new Date(0) } });
      const replacement = await claimNextBackgroundJob(db, job.id);
      assert.ok(replacement);
      return { staleResult: true };
    } });
    const replaced = await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(replaced.status, "RUNNING"); assert.equal(replaced.result, null);
  } finally { await db.backgroundJob.deleteMany({ where: { id: job.id } }); await db.$disconnect(); }
});
