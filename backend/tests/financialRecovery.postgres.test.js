import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("separate-process financial deadlock rollback, bounded retry and accepted-payout crash recovery", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true", timeout: 30000 }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const children = [];
  const spawn = (...args) => {
    const env = { ...process.env }; delete env.DATABASE_URL;
    const child = fork(new URL("./financialRecoveryWorker.js", import.meta.url), args, { env, execArgv: ["--import", "./tests/setupDisposableDatabase.js"], stdio: ["ignore", "ignore", "ignore", "ipc"] });
    children.push(child); const messages = [], waiters = [];
    child.on("message", message => { const index = waiters.findIndex(item => item.stage === message.stage); if (index >= 0) waiters.splice(index, 1)[0].resolve(message); else messages.push(message); });
    return { child, wait(stage) { const index = messages.findIndex(item => item.stage === stage); return index >= 0 ? Promise.resolve(messages.splice(index, 1)[0]) : new Promise(resolve => waiters.push({ stage, resolve })); } };
  };
  try {
    const id = randomUUID();
    const faculty = await db.faculty.create({ data: { facultyId: id, username: id, passwordHash: "TEST_LOGIN_DISABLED", fullName: "Recovery fixture", phone: id, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED" } });
    const rows = [];
    for (let index = 0; index < 2; index++) {
      const startDate = new Date(Date.now() + Math.floor(Math.random() * 1e12));
      const cycle = await db.payrollCycle.create({ data: { cycleNumber: randomUUID(), startDate, endDate: new Date(+startDate + 86400000), status: "DRAFT" } });
      rows.push(await db.facultyEarningsPayroll.create({ data: { facultyId: faculty.id, payrollCycleId: cycle.id, totalEntries: 1, totalAmount: 100, status: "DRAFT" } }));
    }
    const a = spawn("deadlock", rows[0].id, rows[1].id), b = spawn("deadlock", rows[1].id, rows[0].id);
    await Promise.all([a.wait("locked"), b.wait("locked")]);
    a.child.send("continue"); b.child.send("continue");
    const results = await Promise.all([a.wait("done"), b.wait("done")]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.ok(results.some(result => result.code === "P2034" || result.databaseCode === "40P01" || result.deadlock));
    for (const row of rows) assert.equal(Number((await db.facultyEarningsPayroll.findUniqueOrThrow({ where: { id: row.id } })).totalAmount), 101, "Victim's partial update rolled back");
    // Exactly one explicit retry, database-only and ordered; no provider call is repeated.
    await db.$transaction(async tx => { for (const row of [...rows].sort((x, y) => x.id.localeCompare(y.id))) await tx.facultyEarningsPayroll.update({ where: { id: row.id }, data: { totalAmount: { increment: 1 } } }); }, { timeout: 5000 });
    const crashed = spawn("crash", rows[0].id, rows[1].id);
    await crashed.wait("locked"); const stopped = once(crashed.child, "exit"); crashed.child.kill("SIGKILL"); await stopped;
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '3s'");
      for (const row of rows) { const saved = await tx.facultyEarningsPayroll.update({ where: { id: row.id }, data: { totalEntries: 1 } }); assert.equal(Number(saved.totalAmount), 102); }
    }, { timeout: 5000 });
    await db.facultyBankAccount.create({ data: { facultyId: faculty.id, verificationStatus: "VERIFIED", payoutEligible: true, cashfreeBeneficiaryId: "isolated" } });
    const payout = await db.facultyPayout.create({ data: { facultyId: faculty.id, amount: 204, status: "PENDING" } });
    const dispatch = spawn("dispatch", payout.id); await dispatch.wait("accepted");
    const accepted = await db.facultyPayout.findUniqueOrThrow({ where: { id: payout.id } });
    assert.equal(accepted.status, "PROCESSING"); assert.ok(accepted.cashfreeTransferId);
    const exited = once(dispatch.child, "exit"); dispatch.child.kill("SIGKILL"); await exited;
    const recovery = spawn("recover", payout.id); assert.equal((await recovery.wait("done")).ok, true);
    const saved = await db.facultyPayout.findUniqueOrThrow({ where: { id: payout.id } });
    assert.equal(saved.status, "SUCCESS"); assert.equal(saved.cashfreeTransferId, accepted.cashfreeTransferId); assert.equal(Number(saved.paidAmount), 204);
    assert.equal(await db.facultyPayout.count({ where: { facultyId: faculty.id } }), 1);
    const reserved = await db.facultyPayout.create({ data: { facultyId: faculty.id, amount: 17, status: "PENDING" } });
    const resumed = spawn("recover-pending", reserved.id);
    assert.equal((await resumed.wait("done")).ok, true, "A fresh process can initiate a never-dispatched reservation once");
    assert.equal((await db.facultyPayout.findUniqueOrThrow({ where: { id: reserved.id } })).status, "SUCCESS");
  } finally { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await db.$disconnect(); }
});
