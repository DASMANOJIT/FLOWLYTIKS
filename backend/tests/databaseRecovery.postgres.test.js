import test from "node:test";
import assert from "node:assert/strict";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("isolated PostgreSQL pool timeout is bounded and the pool recovers after contention", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { PrismaClient } = await import("@prisma/client");
  const { withDatabaseRecovery } = await import("../utils/databaseRecovery.js");
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.searchParams.set("connection_limit", "1"); target.searchParams.set("pool_timeout", "1");
  const db = new PrismaClient({ datasourceUrl: target.href, log: [] });
  let release, held;
  try {
    let entered; const ready = new Promise(resolve => { entered = resolve; });
    held = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS connected`; entered();
      await new Promise(resolve => { release = resolve; });
    }, { timeout: 10000 });
    await ready;
    const started = Date.now();
    await assert.rejects(db.$queryRaw`SELECT 1 AS contended`, { code: "P2024" });
    assert.ok(Date.now() - started < 5000, "Pool failure must be bounded");
    release(); await held; held = null;
    assert.equal((await withDatabaseRecovery(() => db.$queryRaw`SELECT 1 AS recovered`, "isolated.pool"))[0].recovered, 1);
    await db.$disconnect();
    assert.equal((await db.$queryRaw`SELECT 1 AS restarted`)[0].restarted, 1);
  } finally { release?.(); await held?.catch(() => {}); await db.$disconnect(); }
});

test("terminated isolated database connections recover without revoking stored sessions", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { PrismaClient } = await import("@prisma/client");
  const { Client } = await import("pg");
  const { withDatabaseRecovery } = await import("../utils/databaseRecovery.js");
  const target = new URL(process.env.TEST_DATABASE_URL);
  target.searchParams.set("connection_limit", "1");
  const db = new PrismaClient({ datasourceUrl: target.href, log: [] });
  target.search = "";
  const control = new Client({ connectionString: target.href });
  try {
    await control.connect();
    const activeBefore = await db.userSession.count({ where: { isActive: true } });
    const [{ pid }] = await db.$queryRaw`SELECT pg_backend_pid() AS pid`;
    const result = await control.query("SELECT pg_terminate_backend($1) AS terminated", [pid]);
    assert.equal(result.rows[0].terminated, true);
    assert.equal(await withDatabaseRecovery(() => db.userSession.count({ where: { isActive: true } }), "isolated.connection"), activeBefore);
    await db.$queryRaw`SELECT 1 AS healthy`;
  } finally { await control.end(); await db.$disconnect(); }
});
