import "./setupDisposableDatabase.js";
import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import http from "node:http";
import { fetchCashfreeOrder, fetchCashfreePaymentsForOrder } from "../services/cashfreeService.js";
import { getTransferStatus } from "../services/cashfreePayoutService.js";
import { sendOtpEmail } from "../services/emailService.js";

Object.assign(process.env, { CASHFREE_CLIENT_ID: "mock-only", CASHFREE_CLIENT_SECRET: "mock-only", CASHFREE_ENVIRONMENT: "sandbox", CASHFREE_PAYOUT_CLIENT_ID: "mock-only", CASHFREE_PAYOUT_CLIENT_SECRET: "mock-only", CASHFREE_PAYOUT_ENVIRONMENT: "sandbox", CASHFREE_PAYOUT_API_BASE_URL: "https://sandbox.cashfree.com/payout", ENABLE_CASHFREE_PAYOUT_SANDBOX: "true" });
const assertMockTarget = input => {
  const url = new URL(input);
  assert.ok(url.origin === "https://api.resend.com" && url.pathname === "/emails" || url.origin === "https://sandbox.cashfree.com" && /^\/(pg\/orders\/|payout\/transfers)/.test(url.pathname), "Unexpected provider request");
};

test("verification reads have a request bound and retain caller cancellation", async () => {
  const original = globalThis.fetch;
  const signal = new AbortController().signal;
  try {
    globalThis.fetch = async (url, options) => {
      assertMockTarget(url);
      assert.ok(options.signal instanceof AbortSignal, "Verification request has no timeout/cancellation bound");
      return Response.json({});
    };
    await fetchCashfreeOrder("synthetic-order");
    await fetchCashfreePaymentsForOrder("synthetic-order");
    globalThis.fetch = async (url, options) => { assertMockTarget(url); assert.equal(options.signal, signal); return Response.json({}); };
    await fetchCashfreeOrder("synthetic-order", { signal });
  } finally { globalThis.fetch = original; }
});

test("Cashfree and Resend latency/429/5xx fail without repeated provider requests", async () => {
  const original = globalThis.fetch;
  try {
    for (const invoke of [() => fetchCashfreeOrder("synthetic-order"), () => getTransferStatus("synthetic-transfer"), () => sendOtpEmail("synthetic@example.invalid", "000001")]) {
      for (const status of [429, 500, 503]) {
        let calls = 0;
        globalThis.fetch = async url => { assertMockTarget(url); calls++; await new Promise(resolve => setTimeout(resolve, 30)); return Response.json({ message: "Synthetic provider unavailable" }, { status }); };
        await assert.rejects(invoke()); assert.equal(calls, 1);
      }
    }
  } finally { globalThis.fetch = original; }
});

test("caller cancellation also bounds reading a stalled provider response body", { timeout: 5000 }, async () => {
  const original = globalThis.fetch, sockets = new Set();
  const server = http.createServer((_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.write("{"); }).listen(0, "127.0.0.1");
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try {
    globalThis.fetch = (url, options) => { assertMockTarget(url); return original(`http://127.0.0.1:${server.address().port}`, options); };
    await assert.rejects(fetchCashfreeOrder("synthetic-order", { signal: AbortSignal.timeout(100) }), error => ["AbortError", "TimeoutError"].includes(error.name));
  } finally {
    globalThis.fetch = original; for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  }
});

test("real Cashfree and Resend abort deadlines fire with stalled mocked transports", { timeout: 40000 }, async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (url, { signal }) => {
      assertMockTarget(url);
      assert.ok(signal instanceof AbortSignal); calls++;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    };
    const keepAlive = setInterval(() => {}, 1000);
    const start = performance.now();
    try {
      const outcomes = await Promise.allSettled([fetchCashfreeOrder("synthetic-order"), getTransferStatus("synthetic-transfer"), sendOtpEmail("synthetic@example.invalid", "000001")]);
      assert.ok(outcomes.every(result => result.status === "rejected"));
      assert.equal(calls, 3);
      assert.ok(performance.now() - start >= 29500 && performance.now() - start < 37000);
    } finally { clearInterval(keepAlive); }
  } finally { globalThis.fetch = original; }
});
