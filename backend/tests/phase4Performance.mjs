import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { requireDisposableDatabase } from "./disposableDatabase.js";

requireDisposableDatabase();
const output = process.env.PHASE4_OUTPUT;
assert.ok(output?.startsWith("/tmp/flowlytiks-phase4-"), "Use a task-owned /tmp output directory");
await mkdir(output, { recursive: true });
const child = fork(fileURLToPath(new URL("./phase4ApiServer.js", import.meta.url)), [], { execArgv: [], env: { ...process.env, DATABASE_URL: "" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
child.stderr.on("data", data => process.stderr.write(data));
let sequence = 0;
const rpc = kind => new Promise((resolve, reject) => {
  const request = ++sequence;
  const timer = setTimeout(() => { child.off("message", listener); reject(new Error(`IPC timeout: ${kind}`)); }, 30000);
  const listener = value => { if (value.request === request) { clearTimeout(timer); child.off("message", listener); value.error ? reject(new Error(value.error)) : resolve(value); } };
  child.on("message", listener); child.send({ kind, request });
});
let shutdown;
const stopChild = () => shutdown ||= (async () => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  try { if (child.connected) await rpc("stop"); }
  finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
  }
})();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void stopChild().finally(() => process.exit(1)); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : null;
const summarize = rows => ({ n: rows.length, p50: percentile(rows.map(r => r.ms), .5), p95: percentile(rows.map(r => r.ms), .95), p99: percentile(rows.map(r => r.ms), .99), statuses: rows.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {}), maxBytes: Math.max(0, ...rows.map(r => r.bytes)) });
const report = { environment: { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length, model: os.cpus()[0].model, ramGB: os.totalmem() / 1073741824, poolLimit: 5 }, phases: [], baseline: [] };
const persist = () => writeFile(`${output}/measurements.json`, JSON.stringify(report, null, 2));
try {
  const fixture = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Isolated API startup timed out")), 60000);
    child.on("message", value => { if (value.ready) { clearTimeout(timer); resolve(value); } });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Fixture server exited ${code}`)); });
  });
  report.marker = fixture.marker; report.dataset = fixture.dataset; report.databaseTotals = fixture.totals;
  if (process.env.PHASE4_BROWSER_ONLY === "true") {
    report.browser = await (await import("../../frontend/tests/phase4Browser.mjs")).measureBrowser(fixture, output);
  } else {
  const endpoints = [
    ["heartbeat", "admin", "/api/auth/heartbeat"],
    ["admin-dashboard", "admin", "/api/admin/dashboard-summary?month=October&academicYear=2026"],
    ["student-dashboard", "student", "/api/students/me"],
    ["student-payments", "student", "/api/payments/my"],
    ["faculty-dashboard", "faculty", "/api/faculty/dashboard-summary"],
    ["staff-dashboard", "staff", "/api/staff/students?month=October&academicYear=2026&pageSize=20"],
    ["students-search", "admin", `/api/students?search=${fixture.marker}&page=1&limit=20`],
    ["staff-filter", "staff", `/api/staff/students?search=${fixture.marker}&class=8&status=paid&month=October&academicYear=2026`],
    ["follow-up-timeline", "staff", `/api/staff/students/${fixture.users.student.id}/timeline`],
    ["online-history", "faculty", "/api/faculty-extra-incentives/my/online-classes?historyFilters=true"],
    ["admin-online-history", "admin", "/api/faculty-extra-incentives/admin/online-classes"],
    ["batch-search", "admin", `/api/faculty-extra-incentives/online-class-directory?search=${fixture.marker}`],
    ["attendance", "faculty", `/api/faculty/attendance/week?weekStart=${fixture.week}`],
    ["incentives", "faculty", "/api/faculty-extra-incentives/my"],
    ["ledger-export", "admin", `/api/work-ledger/export.json?week=${fixture.week}`],
  ];
  async function request(endpoint, options = {}) {
    const [name, role, path] = endpoint, started = performance.now();
    try {
      const response = await fetch(fixture.base + path, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${fixture.tokens[role]}` }, signal: AbortSignal.timeout(10000) });
      const body = await response.arrayBuffer();
      return { name, ms: performance.now() - started, status: response.status, bytes: body.byteLength };
    } catch (error) { return { name, ms: performance.now() - started, status: error.name, bytes: 0 }; }
  }
  if (process.env.PHASE4_SOAK_ONLY !== "true") {
  for (const endpoint of endpoints) {
    const before = await rpc("metrics"); const cold = await request(endpoint); const rows = [];
    for (let i = 0; i < 12; i++) rows.push(await request(endpoint));
    const after = await rpc("metrics");
    const result = { name: endpoint[0], cold, warm: summarize(rows), queriesPerRequest: (after.queries - before.queries - 1) / 13 };
    report.baseline.push(result); console.log(JSON.stringify(result));
    assert.equal(cold.status, 200, `${endpoint[0]} must succeed before load`);
    assert.ok(rows.every(row => row.status === 200), `${endpoint[0]} warm baseline must succeed`);
  }
  // Exercise the real save route without completing a conference or crediting an incentive.
  const scheduling = [];
  for (let i = 0; i < 8; i++) scheduling.push(await request(["scheduling", "faculty", "/api/faculty-extra-incentives/my/online-classes"], { method: "POST", body: JSON.stringify({ requestId: `${fixture.marker}_schedule_${i}`, incentiveTypeId: fixture.typeId, topic: "Synthetic scheduling measurement", batchIds: [fixture.batchId], date: "2027-01-20", startTime: "10:00", endTime: "11:00", meetUrl: "https://meet.google.com/abc-defg-hij" }) }));
  report.scheduling = summarize(scheduling); assert.ok(scheduling.every(r => [200, 201].includes(r.status)));
  }
  await rpc("worker");
  const run = async (name, concurrency, durationMs, thinkMs) => {
    const before = await rpc("metrics"), started = performance.now(), rows = [], samples = []; let stopped = false;
    let monitoring = Promise.resolve(), stopReason;
    const monitor = setInterval(() => {
      monitoring = monitoring.then(async () => {
        try {
          const m = await rpc("metrics"), elapsedSeconds = (performance.now() - started) / 1000;
          const gap = elapsedSeconds - (samples.at(-1)?.elapsedSeconds || 0);
          samples.push({ elapsedSeconds, ...m });
          if (gap > 20) stopReason = "Sampling interruption exceeded 20 seconds";
          if (m.rssMB > 1000 || m.loopP99Ms > 2000) stopReason = "Resource stop threshold reached";
          if (stopReason) stopped = true;
          report.inProgress = { name, concurrency, elapsedSeconds, requests: rows.length, samples, stopReason };
          await persist();
        } catch (error) { stopped = true; stopReason = `Monitoring failed: ${error.message}`; }
      });
    }, 10000);
    try {
      await Promise.all(Array.from({ length: concurrency }, async (_, user) => {
        let iteration = user;
        while (!stopped && performance.now() - started < durationMs) {
          // Deterministic spread, one export per 45 requests; read-only workload.
          const index = iteration++ % 45;
          const row = await request(endpoints[index === 44 ? 14 : index % 14]); rows.push(row);
          if (rows.length > 100 && rows.filter(r => Number(r.status) >= 500 || typeof r.status !== "number").length / rows.length > .02) stopped = true;
          await sleep(thinkMs + user * 7 % 150);
        }
      }));
    } finally { clearInterval(monitor); await monitoring; }
    const elapsed = (performance.now() - started) / 1000, after = await rpc("metrics");
    const result = { name, concurrency, thinkMs, elapsed, stopped, stopReason, throughput: rows.length / elapsed, summary: summarize(rows), unexpected: rows.filter(r => r.status !== 200 && r.status !== 429).length, queries: after.queries - before.queries, before, after, samples, byEndpoint: Object.fromEntries(endpoints.map(([key]) => [key, summarize(rows.filter(r => r.name === key))])) };
    delete report.inProgress;
    report.phases.push(result); await persist(); console.log(JSON.stringify({ phase: name, ...result.summary, throughput: result.throughput, unexpected: result.unexpected, stopped }));
    assert.equal(stopped, false, "Automatic resource/error stop reached"); assert.equal(result.unexpected, 0);
  };
  await persist();
  if (process.env.PHASE4_SMOKE !== "true") {
    if (process.env.PHASE4_SOAK_ONLY !== "true") for (const concurrency of [10, 25, 50]) await run(`load-${concurrency}`, concurrency, 45000, 450);
    // Browser build/page measurements run concurrently with the bounded low-load soak.
    const browser = process.env.PHASE4_BROWSER === "true" ? import("../../frontend/tests/phase4Browser.mjs").then(module => module.measureBrowser(fixture, output)).then(result => { report.browser = result; }).catch(error => { report.browser = { error: error.message }; }) : Promise.resolve();
    await run("soak", 10, 20 * 60000, 1800);
    await browser;
    await sleep(15000); report.recovered = await rpc("metrics");
  }
  }
  await persist();
} catch (error) { report.failure = error.message; await persist(); throw error; }
finally { await stopChild(); }
