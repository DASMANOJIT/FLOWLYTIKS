import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { requireDisposableDatabase } from "./disposableDatabase.js";
import { withPgTransactionLock } from "../utils/dbLocks.js";

const enabled = process.env.RUN_PHASE2_POSTGRES_TESTS === "true";

test("scheduler transaction lock serializes separate processes without exceeding a budget", { skip: !enabled, timeout: 30000 }, async () => {
  requireDisposableDatabase();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  const key = `scheduler-test:${randomUUID()}`;
  const children = [];
  try {
    const results = await Promise.all(Array.from({ length: 2 }, () => new Promise((resolve, reject) => {
      const child = fork(new URL("./transactionLockProcess.js", import.meta.url), [], { execArgv: [], env: { ...process.env, DATABASE_URL: "" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
      children.push(child);
      let result;
      child.on("error", reject);
      child.on("message", message => {
        if (message.ready) child.send({ key });
        if (message.results) result = message.results;
      });
      child.on("exit", code => code === 0 && result ? resolve(result) : reject(new Error("Isolated transaction worker failed")));
    })));
    assert.equal(results.flat().filter(value => value === "accepted").length, 7);
    assert.equal(results.flat().filter(value => value === "limited").length, 23);
    assert.equal(await db.authRateLimitEvent.count({ where: { namespace: key } }), 7);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill();
    await db.authRateLimitEvent.deleteMany({ where: { namespace: key } });
    await db.$disconnect();
  }
});

test("scheduler helpers use the lock transaction and roll back/repeat safely with a one-connection pool", { skip: !enabled }, async () => {
  requireDisposableDatabase();
  const { PrismaClient } = await import("@prisma/client");
  const { createBackgroundJob } = await import("../services/backgroundJobService.js");
  const { findActivePromotionJobForAcademicYear } = await import("../services/promotionService.js");
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("connection_limit", "1");
  const db = new PrismaClient({ datasourceUrl: url.href, log: [] });
  const key = `scheduler-test:${randomUUID()}`;
  try {
    await assert.rejects(withPgTransactionLock(db, key, async tx => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      assert.equal((await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid, pid);
      await createBackgroundJob({ type: "DAILY_FEE_REMINDER", source: "test", dedupeKey: key }, tx);
      await findActivePromotionJobForAcademicYear(2099, tx);
      throw new Error("Controlled scheduler rollback");
    }), /Controlled scheduler rollback/);
    assert.equal(await db.backgroundJob.count({ where: { dedupeKey: key } }), 0);
    for (let i = 0; i < 2; i++) {
      const result = await withPgTransactionLock(db, key, tx => createBackgroundJob({ type: "DAILY_FEE_REMINDER", source: "test", dedupeKey: key }, tx));
      assert.equal(result.created, i === 0);
    }
    assert.equal(await db.backgroundJob.count({ where: { dedupeKey: key } }), 1);
    assert.equal((await db.$queryRaw`SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`)[0].count, 0);
  } finally {
    await db.backgroundJob.deleteMany({ where: { dedupeKey: key } });
    await db.$disconnect();
  }
});
