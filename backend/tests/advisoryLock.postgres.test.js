import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";
// Retain a test-only reproduction of the removed pattern. It must never be
// imported by production callers; transaction-bound regressions follow below.
const withPgAdvisoryLock = async (db, key, work) => {
  const rows = await db.$queryRaw`SELECT pg_try_advisory_lock(hashtext(${key})::bigint) AS acquired`;
  if (!rows[0]?.acquired) return null;
  try { return await work(); }
  finally { await db.$queryRaw`SELECT pg_advisory_unlock(hashtext(${key})::bigint) AS released`; }
};

test("diagnostic: legacy session advisory helper allows overlapping work on a reused connection", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { PrismaClient } = await import("@prisma/client");
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set("connection_limit", "1");
  const db = new PrismaClient({ datasourceUrl: url.href, log: [] });
  let release, first;
  try {
    const key = randomUUID();
    let entered; const ready = new Promise(resolve => { entered = resolve; });
    first = withPgAdvisoryLock(db, key, async () => { entered(); await new Promise(resolve => { release = resolve; }); });
    await ready;
    let overlapped = false;
    await withPgAdvisoryLock(db, key, async () => { overlapped = true; });
    assert.equal(overlapped, true, "This diagnostic reproduces the retired pattern, not successful mutual exclusion");
    release(); await first; first = null;
    assert.equal((await db.$queryRaw`SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`)[0].count, 0);
    await assert.rejects(withPgAdvisoryLock(db, key, async () => { throw new Error("Controlled rollback"); }), /Controlled rollback/);
    assert.equal((await db.$queryRaw`SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`)[0].count, 0);
  } finally { release?.(); await first?.catch(() => {}); await db.$disconnect(); }
});

test("diagnostic: pooled unlock on another connection leaks a legacy session lock", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { PrismaClient } = await import("@prisma/client");
  const url = new URL(process.env.TEST_DATABASE_URL); url.searchParams.set("connection_limit", "2");
  const db = new PrismaClient({ datasourceUrl: url.href, log: [] });
  let pid, held, release;
  const key = randomUUID();
  const adapter = { $queryRaw: async (sql, ...values) => {
    if (sql.join("").includes("pg_try_advisory_lock")) {
      const rows = await db.$queryRaw`SELECT pg_try_advisory_lock(hashtext(${values[0]})::bigint) AS acquired, pg_backend_pid() AS pid`;
      pid = rows[0].pid; return rows;
    }
    return db.$queryRaw(sql, ...values);
  } };
  try {
    await withPgAdvisoryLock(adapter, key, async () => {
      let entered; const ready = new Promise(resolve => { entered = resolve; });
      held = db.$transaction(async tx => {
        assert.equal((await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid, pid);
        entered(); await new Promise(resolve => { release = resolve; });
      });
      await ready;
    });
    release(); await held; held = null;
    assert.equal((await db.$queryRaw`SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND pid = ${pid}`)[0].count, 1, "Diagnostic confirms leaked lock after the helper returned");
  } finally { release?.(); await held?.catch(() => {}); await db.$disconnect(); }
});

test("transaction advisory lock stays on one backend, rolls back and has bounded contention", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [] });
  const key = randomUUID(); let release, holder;
  try {
    let entered; const ready = new Promise(resolve => { entered = resolve; });
    holder = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)::text`;
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      assert.equal((await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid, pid);
      entered(); await new Promise(resolve => { release = resolve; });
      throw new Error("Controlled lock rollback");
    });
    const rollback = assert.rejects(holder, /Controlled lock rollback/);
    await ready;
    const started = Date.now();
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)::text`;
    }));
    assert.ok(Date.now() - started < 2000);
    release(); await rollback; holder = null;
    await db.$transaction(async tx => { assert.equal((await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${key})::bigint) AS acquired`)[0].acquired, true); });
  } finally { release?.(); await holder?.catch(() => {}); await db.$disconnect(); }
});
