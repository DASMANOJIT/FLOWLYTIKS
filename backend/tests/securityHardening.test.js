import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

const events = [];
const locks = new Map();
let unavailable = false;
globalThis.__flowlytiksPrisma = {
  $transaction: async (work, options) => {
    assert.equal(options.isolationLevel, "ReadCommitted");
    if (unavailable) throw Object.assign(new Error("Controlled failure"), { code: "P2024" });
    let unlock;
    const tx = {
      $queryRaw: async (sql, key) => {
        assert.match(sql.join("?"), /pg_advisory_xact_lock/);
        assert.match(sql.join("?"), /::text AS locked/, "Prisma cannot deserialize PostgreSQL void results");
        const previous = locks.get(key) || Promise.resolve();
        const current = new Promise(resolve => { unlock = resolve; });
        locks.set(key, current);
        await previous;
      },
      authRateLimitEvent: {
        count: async ({ where }) => {
          await new Promise(resolve => setImmediate(resolve));
          return events.filter(e => e.key === where.key && e.createdAt >= where.createdAt.gte).length;
        },
        findFirst: async ({ where }) => events.find(e => e.key === where.key && e.createdAt >= where.createdAt.gte),
        create: async ({ data }) => { events.push({ ...data, createdAt: new Date() }); },
      },
    };
    try { return await work(tx); } finally { unlock?.(); }
  },
};
const { createRateLimiter } = await import("../middleware/security.js");
const { buildRequestLogMeta, getRequestIp, logError, logInfo } = await import("../utils/appLogger.js");
const response = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } });

test("concurrent requests consume exactly the configured budget", async () => {
  const limit = createRateLimiter({ namespace: "concurrency", windowMs: 60000, max: 5, message: "Limited" });
  let allowed = 0;
  const responses = await Promise.all(Array.from({ length: 40 }, async () => {
    const res = response();
    await limit({ ip: "192.0.2.1", headers: { "x-forwarded-for": Math.random().toString() } }, res, () => allowed++);
    return res;
  }));
  assert.equal(allowed, 5);
  assert.equal(events.length, 5);
  assert.equal(responses.filter(r => r.statusCode === 429).length, 35);
  for (const res of responses.filter(r => r.statusCode === 429)) assert.ok(res.headers["Retry-After"] > 0);
  const other = response();
  await limit({ ip: "192.0.2.2", headers: {} }, other, () => allowed++);
  assert.equal(allowed, 6);
});

test("expired events release the budget and store failures do not authorize", async () => {
  const limit = createRateLimiter({ namespace: "expiry", windowMs: 1000, max: 1, message: "Limited" });
  events.push({ namespace: "expiry", key: "expiry:192.0.2.3", createdAt: new Date(Date.now() - 2000) });
  let allowed = false;
  await limit({ ip: "192.0.2.3", headers: {} }, response(), () => { allowed = true; });
  assert.equal(allowed, true);
  unavailable = true;
  try {
    const res = response();
    await limit({ ip: "192.0.2.3", headers: {} }, res, () => assert.fail("Must fail closed"));
    assert.equal(res.statusCode, 503);
  } finally { unavailable = false; }
});

test("logging strips URL queries, nested credentials and secret-bearing errors", () => {
  const captured = [];
  const originals = { info: console.info, error: console.error };
  console.info = console.error = (...args) => captured.push(args);
  try {
    const req = { method: "GET", originalUrl: "/api/faculty/google/callback?code=secret-code&state=secret-state", ip: "192.0.2.9", headers: { "x-forwarded-for": "spoofed" } };
    assert.equal(getRequestIp(req), "192.0.2.9");
    logInfo("test", buildRequestLogMeta(req, { nested: { password: "secret-password", otp: "012345", state: "secret-state", code: "secret-code", headers: { authorization: "Bearer secret-token" } } }));
    logError("test.error", { code: "P2024", error: new Error("GET https://example.com/callback?code=secret-code&state=secret-state Authorization=secret-header password=secret-password") });
    const output = JSON.stringify(captured);
    for (const value of ["secret-code", "secret-state", "secret-password", "012345", "secret-token", "secret-header", "spoofed"]) assert.equal(output.includes(value), false);
    assert.ok(output.includes("/api/faculty/google/callback"));
    assert.ok(output.includes("P2024"));
  } finally { Object.assign(console, originals); }
});

test("one-hop Express trust uses the nearest forwarded address, not the first", () => {
  const app = express();
  app.set("trust proxy", 1);
  const req = Object.assign(Object.create(app.request), {
    app,
    socket: { remoteAddress: "127.0.0.1" },
    headers: { "x-forwarded-for": "198.51.100.99, 192.0.2.9" },
  });
  assert.equal(getRequestIp(req), "192.0.2.9");
  app.set("trust proxy", false);
  assert.equal(getRequestIp(req), "127.0.0.1");
});
