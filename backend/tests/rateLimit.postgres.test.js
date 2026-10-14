import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("PostgreSQL rate budget is atomic across separate processes, windows and rollback", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { createRateLimiter } = await import("../middleware/security.js");
  const namespace = `phase2:${randomUUID()}`;
  const invoke = async (key = "shared") => {
    const limiter = createRateLimiter({ namespace, windowMs: 60000, max: 7, message: "Limited", keyGenerator: () => key });
    return new Promise(resolve => limiter({ ip: "127.0.0.1" }, { setHeader() {}, status(code) { this.code = code; return this; }, json() { resolve(this.code); } }, () => resolve(200)));
  };
  const workers = [];
  try {
    const results = await Promise.all(Array.from({ length: 2 }, () => new Promise((resolve, reject) => {
      const child = fork(new URL("./rateLimitProcess.js", import.meta.url), [], { execArgv: [], env: { ...process.env, DATABASE_URL: "", TEST_RATE_NAMESPACE: namespace }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
      workers.push(child);
      child.on("error", reject);
      child.on("message", message => { if (message.ready) child.send("run"); else if (message.codes) resolve(message.codes); });
      child.on("exit", code => { if (code) reject(new Error(`Rate worker failed: ${code}`)); });
    })));
    const codes = results.flat();
    assert.equal(codes.filter(code => code === 200).length, 7);
    assert.equal(codes.filter(code => code === 429).length, 23);
    assert.equal(await db.authRateLimitEvent.count({ where: { namespace } }), 7);
    assert.equal(await invoke("independent"), 200);
    await db.authRateLimitEvent.updateMany({ where: { namespace }, data: { createdAt: new Date(Date.now() - 61000) } });
    assert.equal(await invoke(), 200);
    const before = await db.authRateLimitEvent.count({ where: { namespace } });
    await assert.rejects(db.$transaction(async tx => {
      await tx.authRateLimitEvent.create({ data: { namespace, key: `${namespace}:rollback` } });
      throw new Error("Controlled rollback");
    }), /Controlled rollback/);
    assert.equal(await db.authRateLimitEvent.count({ where: { namespace } }), before);
    await db.$queryRaw`SELECT 1 AS pool_still_usable`;
  } finally {
    for (const child of workers) if (child.connected) child.disconnect();
    await db.authRateLimitEvent.deleteMany({ where: { namespace } });
    await db.$disconnect();
  }
});
