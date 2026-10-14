import assert from "node:assert/strict";
assert.equal(process.env.FLOWLYTIKS_BROWSER_ISOLATED, "true", "Server network fixture requires explicit isolated-test mode");
const fetchLocal = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (target.origin === "https://crm-p1o7.onrender.com" && target.pathname === "/api/status") return new Response(JSON.stringify({ status: "active" }), { headers: { "Content-Type": "application/json" } });
  if (["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) return fetchLocal(input, options);
  throw new Error("External server network access disabled in browser tests");
};
