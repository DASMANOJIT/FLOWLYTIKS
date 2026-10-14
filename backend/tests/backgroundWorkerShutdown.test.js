import test from "node:test";
import assert from "node:assert/strict";

// No database/environment load: pause the real dispatcher's first query.
let release;
const db = { $queryRaw: async () => new Promise(resolve => { release = () => resolve([{ acquired: false }]); }) };
db.$transaction = async work => work(db);
globalThis.__flowlytiksPrisma = db;
const { startBackgroundJobWorker } = await import("../services/backgroundJobService.js");

test("background worker stop waits for active dispatch before database disconnect", async () => {
  const stop = startBackgroundJobWorker();
  assert.equal(typeof release, "function");
  const stopping = stop();
  try {
    assert.equal(typeof stopping?.then, "function", "shutdown must return an awaitable drain");
    let drained = false; stopping.then(() => { drained = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(drained, false);
    release(); await stopping;
    assert.equal(drained, true);
    await stop();
  } finally { release(); await stopping; }
});
