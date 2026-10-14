import "./setupDisposableDatabase.js";
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import express from "express";
import bcrypt from "bcryptjs";
import { Client } from "pg";
import { fork } from "node:child_process";

test("real HTTP sessions survive isolated database transport loss, idle reconnect and cancelled reads", { timeout: 60000 }, async () => {
  const target = new URL(process.env.TEST_DATABASE_URL), sockets = new Set(); let interrupted = false;
  const upstreamPort = Number(target.port), upstreamHost = target.hostname;
  const proxy = net.createServer(client => {
    if (interrupted) { client.destroy(); return; }
    const upstream = net.connect(upstreamPort, upstreamHost);
    for (const socket of [client, upstream]) { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => { client.destroy(); upstream.destroy(); }); }
    client.pipe(upstream); upstream.pipe(client);
  }).listen(0, "127.0.0.1");
  await new Promise(resolve => proxy.once("listening", resolve));
  target.port = String(proxy.address().port); target.searchParams.set("connect_timeout", "1"); target.searchParams.set("pool_timeout", "1"); target.searchParams.set("connection_limit", "2");
  const db = new PrismaClient({ datasourceUrl: target.href, log: [] }); globalThis.__flowlytiksPrisma = db;
  let server;
  try {
    const id = randomUUID(), password = "Isolated-Password1!", hash = await bcrypt.hash(password, 10);
    const users = {
      admin: await db.admin.create({ data: { name: "Recovery Admin", email: `p4-admin-${id}@example.invalid`, password: hash } }),
      student: await db.student.create({ data: { name: "Recovery Student", email: `p4-student-${id}@example.invalid`, phone: id, password: hash, school: "Synthetic", class: "8", isVerified: true } }),
      faculty: await db.faculty.create({ data: { facultyId: `P4R_${id}`, username: id, email: `p4-faculty-${id}@example.invalid`, fullName: "Recovery Faculty", phone: id, passwordHash: hash, joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } }),
    };
    users.staff = await db.staff.create({ data: { name: "Recovery Staff", email: `p4-staff-${id}@example.invalid`, passwordHash: hash, verifiedAt: new Date(), createdByAdminId: users.admin.id } });
    const app = express(); app.use(express.json());
    for (const [prefix, route] of [["auth", "authroute"], ["faculty-auth", "facultyauthroute"], ["staff", "staffroute"]]) app.use(`/api/${prefix}`, (await import(`../routes/${route}.js`)).default);
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`, tokens = {}, timings = {};
    for (const role of Object.keys(users)) {
      timings[role] = [];
      const path = role === "faculty" ? "faculty-auth/login" : role === "staff" ? "staff/login" : "auth/login";
      for (let i = 0; i < 8; i++) {
        const start = performance.now();
        const response = await fetch(`${base}/api/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: users[role].email, password, role }) });
        const body = await response.json(); assert.equal(response.status, 200, `${role}: ${body.message || body.error}`);
        tokens[role] = body.token; assert.ok(tokens[role]); timings[role].push(performance.now() - start);
      }
    }
    const heartbeat = role => fetch(`${base}/api/auth/heartbeat`, { headers: { Authorization: `Bearer ${tokens[role]}` }, signal: AbortSignal.timeout(8000) });
    for (const role of Object.keys(users)) assert.equal((await heartbeat(role)).status, 200);
    interrupted = true; for (const socket of sockets) socket.destroy();
    const start = performance.now(); const unavailable = await heartbeat("admin");
    assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).code, "AUTH_SERVICE_UNAVAILABLE");
    assert.ok(performance.now() - start < 8000);
    interrupted = false;
    const probe = new Client({ connectionString: target.href });
    await probe.connect(); assert.equal((await probe.query("SELECT 1 AS healthy")).rows[0].healthy, 1); await probe.end();
    const recoveries = {};
    for (const role of Object.keys(users)) {
      const recoveryStart = performance.now(); let status;
      for (let attempt = 0; attempt < 30; attempt++) {
        status = (await heartbeat(role)).status;
        if (status === 200) break;
        assert.equal(status, 503, "Transient failures must not become authentication failures");
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      recoveries[role] = performance.now() - recoveryStart;
      assert.equal(status, 200, `Same ${role} token recovers without login`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    for (const socket of sockets) socket.destroy();
    let idleStatus;
    for (let attempt = 0; attempt < 8; attempt++) { idleStatus = (await heartbeat("admin")).status; if (idleStatus === 200) break; assert.equal(idleStatus, 503); await new Promise(resolve => setTimeout(resolve, 250)); }
    assert.equal(idleStatus, 200, "Idle closed connections recover without changing the session");
    const aborts = await Promise.allSettled(Array.from({ length: 20 }, () => fetch(`${base}/api/auth/heartbeat`, { headers: { Authorization: `Bearer ${tokens.admin}` }, signal: AbortSignal.timeout(1) })));
    assert.ok(aborts.some(result => result.status === "rejected"));
    assert.equal((await heartbeat("admin")).status, 200);
    for (const [role, user] of Object.entries(users)) assert.ok(await db.userSession.count({ where: { role, userId: String(user.id), isActive: true } }));
    const result = { loginMs: timings, transportOutage: "503 then same tokens 200 for all four roles", recoveryMs: recoveries, idleClosed: "recovered", cancelledReads: aborts.filter(r => r.status === "rejected").length };
    console.log("phase4.recovery", JSON.stringify(result));
    if (process.env.PHASE4_OUTPUT?.startsWith("/tmp/flowlytiks-phase4-")) await writeFile(`${process.env.PHASE4_OUTPUT}/recovery.json`, JSON.stringify(result, null, 2));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.$disconnect(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => proxy.close(resolve));
  }
});

test("Google latency, actual request timeout and backoff are bounded without inline retry storms", { timeout: 22000 }, async () => {
  const { meetClient } = await import("../services/meetVerificationService.js");
  for (const status of [429, 500, 503]) {
    let calls = 0;
    const client = meetClient({ token: "mock", refresh: async () => null, fetcher: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 50)); return Response.json({}, { status, headers: { "retry-after": "120" } }); } });
    await assert.rejects(client.get("conferenceRecords"), error => error.code === "API_BACKOFF" && error.retryMs === 120000);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const timeoutClient = meetClient({ token: "mock", refresh: async () => null, fetcher: (_url, { signal }) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); } });
  // Keep this test alive while the production AbortSignal's unref'd timeout fires.
  const keepAlive = setInterval(() => {}, 1000), start = performance.now();
  try { await assert.rejects(timeoutClient.get("conferenceRecords"), { code: "API_ERROR" }); }
  finally { clearInterval(keepAlive); }
  assert.equal(calls, 1); assert.ok(performance.now() - start >= 14500 && performance.now() - start < 19000);
  let refreshes = 0, requests = 0;
  const revoked = meetClient({ token: "mock", refresh: async () => { refreshes++; return "mock-refreshed"; }, fetcher: async () => { requests++; return Response.json({}, { status: 401 }); } });
  await assert.rejects(revoked.get("conferenceRecords"), { code: "RECONNECT_REQUIRED" });
  assert.equal(refreshes, 1); assert.equal(requests, 2);
});

test("actual backend entrypoint starts against guarded PostgreSQL and shuts down on SIGTERM", { timeout: 20000 }, async () => {
  const probe = net.createServer().listen(0, "127.0.0.1"); await new Promise(resolve => probe.once("listening", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = fork(new URL("../server.js", import.meta.url), [], {
    execArgv: ["--import", new URL("./setupDisposableDatabase.js", import.meta.url).href],
    env: { ...process.env, DATABASE_URL: "", PORT: String(port), CASHFREE_CLIENT_ID: "mock-only-client", CASHFREE_CLIENT_SECRET: "mock-only-client-secret", CASHFREE_ENVIRONMENT: "sandbox", CASHFREE_RETURN_URL: `http://127.0.0.1:${port}/test-return`, BACKEND_URL: `http://127.0.0.1:${port}`, FRONTEND_URL: "http://127.0.0.1:59999", DEBUG_DB: "0", DEBUG_ENV_LOAD: "0" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  let connected = false, shuttingDown = false;
  child.stdout.on("data", chunk => { const text = String(chunk); connected ||= text.includes("server.database_connected"); shuttingDown ||= text.includes("server.shutting_down"); });
  child.stderr.on("data", () => {});
  try {
    for (let attempt = 0; attempt < 50 && !connected; attempt++) {
      assert.equal(child.exitCode, null, "Backend exited during isolated startup"); await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(connected, "Backend completes schema checks and connects to the test database");
    assert.equal((await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) })).status, 200);
    const start = performance.now(); child.kill("SIGTERM");
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.ok(shuttingDown); assert.ok(performance.now() - start < 12000, "Graceful exit precedes the emergency shutdown deadline");
    await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }));
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
  }
});
