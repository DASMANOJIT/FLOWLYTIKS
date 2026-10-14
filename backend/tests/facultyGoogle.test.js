import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { GOOGLE_MEET_SCOPE, GOOGLE_CONNECTION_SCOPES, googleConfig, encryptGoogleSecret, decryptGoogleSecret, startGoogleConnection, prepareGoogleConnection, launchGoogleConnection, finishGoogleConnection as finish, googleConnectionStatus, disconnectGoogle, getFacultyGoogleAccessToken } from "../services/facultyGoogleService.js";

let oidcNonce;
// Provider fixtures are mocked here; signature validation has separate cryptographic regression coverage.
const finishGoogleConnection = (request, options) => finish(request, { ...options, idTokenVerifier: { verifyIdToken: async ({ idToken }) => ({ getPayload: () => JSON.parse(idToken) }) } });

const env = { GOOGLE_CLIENT_ID: "controlled-client", GOOGLE_CLIENT_SECRET: "controlled-secret", GOOGLE_REDIRECT_URI: "http://localhost:5000/api/faculty/google/callback", FRONTEND_URL: "http://localhost:3001", GOOGLE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), NODE_ENV: "test" };
const key = Buffer.from(env.GOOGLE_TOKEN_ENCRYPTION_KEY, "base64");

test("incomplete configuration exposes a simple message and logs only missing names", t => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  assert.throws(() => googleConfig({ ...env, GOOGLE_CLIENT_SECRET: "", GOOGLE_TOKEN_ENCRYPTION_KEY: "" }), { status: 503, message: "Google connection is unavailable. Please contact admin." });
  assert.deepEqual(warnings, [["faculty.google.configuration_missing", { missing: ["GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_ENCRYPTION_KEY"] }]]);
  assert.equal(googleConfig(env).key.length, 32);
  assert.equal(googleConfig(env).key.toString("base64"), env.GOOGLE_TOKEN_ENCRYPTION_KEY);
});
const sha = value => createHash("sha256").update(value).digest("hex");
const matches = (row, where) => Object.entries(where).every(([key, value]) => value && typeof value === "object" && "gt" in value ? row[key] > value.gt : row[key] === value);
function fixture() {
  const states = [], connections = [];
  let queue = Promise.resolve();
  const db = {
    states, connections,
    $queryRaw: async () => [],
    faculty: { findUnique: async () => ({ status: "ACTIVE" }) },
    facultyOnlineClass: { updateMany: async ({ where, data }) => { assert.equal(where.facultyId, "faculty-one"); assert.equal(where.status, "COMPLETED"); assert.equal(where.verificationStatus, "TEACHER_IDENTITY_REVIEW"); assert.equal(where.incentiveEntryId, null); assert.equal(where.trackingEnabled, true); assert.ok(data.nextCheckAt instanceof Date); return { count: 0 }; } },
    facultyGoogleOAuthState: {
      create: async ({ data }) => { const row = { id: `state-${states.length}`, stateHash: null, browserNonceHash: null, consumedAt: null, cancelledAt: null, launchedAt: null, codeVerifierEncrypted: null, ...data }; states.push(row); return row; },
      findUnique: async ({ where }) => { const row = states.find(row => matches(row, where)); return row ? { ...row } : null; },
      updateMany: async ({ where, data }) => { const rows = states.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
    },
    facultyGoogleConnection: {
      findUnique: async ({ where }) => { const row = connections.find(row => matches(row, where)); return row ? { ...row } : null; },
      upsert: async ({ where, create, update }) => { const row = connections.find(row => matches(row, where)); if (row) Object.assign(row, update); else connections.push({ ...create }); },
      update: async ({ where, data }) => Object.assign(connections.find(row => matches(row, where)), data),
      updateMany: async ({ where, data }) => { const rows = connections.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
      deleteMany: async ({ where }) => { for (let index = connections.length - 1; index >= 0; index--) if (matches(connections[index], where)) connections.splice(index, 1); },
    },
    $transaction: work => { const next = queue.then(() => work(db)); queue = next.catch(() => {}); return next; },
  };
  return db;
}
const ok = (refresh = "controlled-refresh") => ({ access_token: "controlled-access", refresh_token: refresh, expires_in: 3600, scope: GOOGLE_CONNECTION_SCOPES, id_token: JSON.stringify({ iss: "https://accounts.google.com", aud: env.GOOGLE_CLIENT_ID, sub: "teacher-id", exp: Math.floor(Date.now() / 1000) + 3600, nonce: oidcNonce }) });

test("token refresh shares one request without holding a transaction and cannot resurrect disconnected credentials", async () => {
  const db = fixture();
  db.connections.push({ facultyId: "faculty-one", status: "CONNECTED", connectedAt: new Date(), expiresAt: new Date(0), accessTokenEncrypted: encryptGoogleSecret("old", key, "faculty-one:access"), refreshTokenEncrypted: encryptGoogleSecret("refresh", key, "faculty-one:refresh") });
  db.$transaction = () => assert.fail("No DB transaction may wait for Google refresh");
  let calls = 0, release;
  const fetcher = async () => { calls++; await new Promise(resolve => { release = resolve; }); return { ok: true, json: async () => ok() }; };
  const first = getFacultyGoogleAccessToken("faculty-one", { db, env, fetcher });
  const second = getFacultyGoogleAccessToken("faculty-one", { db, env, fetcher });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); release();
  assert.deepEqual(await Promise.all([first, second]), ["controlled-access", "controlled-access"]);
  db.connections[0].expiresAt = new Date(0);
  const reconnectRace = getFacultyGoogleAccessToken("faculty-one", { db, env, fetcher });
  await new Promise(resolve => setImmediate(resolve));
  db.connections.length = 0; release();
  assert.equal(await reconnectRace, null); assert.equal(db.connections.length, 0);
});
const provider = data => async () => ({ ok: true, json: async () => data });
async function launched(db, facultyId = "faculty-one") {
  const { startUrl } = await startGoogleConnection(facultyId, { db, env });
  const ticket = new URL(startUrl).searchParams.get("ticket");
  const { nonce } = await prepareGoogleConnection(facultyId, ticket, { db, env });
  const launch = await launchGoogleConnection(ticket, nonce, { db, env });
  oidcNonce = new URL(launch.url).searchParams.get("nonce");
  return { ...launch, ticket, state: new URL(launch.url).searchParams.get("state"), code: "controlled-code" };
}

test("dedicated key validation and faculty-bound authenticated encryption", () => {
  assert.throws(() => googleConfig({ ...env, GOOGLE_TOKEN_ENCRYPTION_KEY: "" }), { status: 503 });
  assert.throws(() => googleConfig({ ...env, GOOGLE_REDIRECT_URI: "http://localhost:5000/wrong" }), { status: 503 });
  assert.throws(() => googleConfig({ ...env, NODE_ENV: "production" }), { status: 503 });
  const first = encryptGoogleSecret("controlled-token", key, "faculty-one:refresh");
  assert.notEqual(first, encryptGoogleSecret("controlled-token", key, "faculty-one:refresh"));
  assert.equal(decryptGoogleSecret(first, key, "faculty-one:refresh"), "controlled-token");
  assert.throws(() => decryptGoogleSecret(first, key, "faculty-two:refresh"), { status: 409 });
  assert.throws(() => decryptGoogleSecret(first, randomBytes(32), "faculty-one:refresh"), { status: 409 });
});

test("launch requests only the required scope/offline access; state and tickets are hashed and single-use", async () => {
  const db = fixture(), launch = await launched(db), url = new URL(launch.url);
  assert.equal(url.searchParams.get("scope"), GOOGLE_CONNECTION_SCOPES);
  assert.equal(db.states[0].oidcNonceHash, sha(url.searchParams.get("nonce")));
  assert.equal(url.searchParams.get("access_type"), "offline"); assert.equal(url.searchParams.get("include_granted_scopes"), "false");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(db.states[0].stateHash, sha(launch.state)); assert.equal(db.states[0].launchTokenHash, sha(launch.ticket));
  assert.ok(!JSON.stringify(db.states).includes(launch.nonce));
  await assert.rejects(launchGoogleConnection(launch.ticket, launch.nonce, { db, env }), { status: 400 });
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(createHash("sha256").update(options.body.get("code_verifier")).digest("base64url"), new URL(launch.url).searchParams.get("code_challenge"));
    return { ok: true, json: async () => ok() };
  };
  const results = await Promise.allSettled([finishGoogleConnection(launch, { db, env, fetcher }), finishGoogleConnection(launch, { db, env, fetcher })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1); assert.equal(calls, 1); assert.equal(db.connections.length, 1);
  assert.equal(db.connections[0].facultyId, "faculty-one"); assert.equal(db.states[0].codeVerifierEncrypted, null);
  assert.ok(!JSON.stringify(db.connections).includes("controlled-access")); assert.ok(!JSON.stringify(db.connections).includes("controlled-refresh"));
});

test("invalid, missing, expired and replayed states never exchange codes; denial creates no credentials", async () => {
  for (const scenario of ["missing-nonce", "wrong-nonce", "expired", "denied", "cancelled"]) {
    const db = fixture(), launch = await launched(db); let calls = 0;
    const fetcher = async () => { calls++; throw new Error("Must not exchange"); };
    if (scenario === "expired") db.states[0].expiresAt = new Date(0);
    if (scenario === "cancelled") db.states[0].cancelledAt = new Date();
    if (scenario === "denied") assert.equal((await finishGoogleConnection({ ...launch, denied: true }, { db, env, fetcher })).result, "denied");
    else await assert.rejects(finishGoogleConnection({ ...launch, nonce: scenario === "missing-nonce" ? "" : scenario === "wrong-nonce" ? randomBytes(32).toString("base64url") : launch.nonce }, { db, env, fetcher }), { status: 400 });
    assert.equal(calls, 0); assert.equal(db.connections.length, 0);
  }
});

test("reconnection preserves omitted refresh tokens, refresh revocation requires reconnect, status never exposes tokens", async () => {
  const db = fixture();
  await finishGoogleConnection(await launched(db), { db, env, fetcher: provider(ok()) });
  const original = db.connections[0].refreshTokenEncrypted;
  // Explicitly omit refresh token in the reconnect response.
  const withoutRefresh = ok(); delete withoutRefresh.refresh_token;
  const reconnect = await launched(db);
  withoutRefresh.id_token = ok().id_token;
  await finishGoogleConnection(reconnect, { db, env, fetcher: provider(withoutRefresh) });
  assert.equal(db.connections[0].refreshTokenEncrypted, original);
  const status = await googleConnectionStatus("faculty-one", { db, env });
  assert.deepEqual(Object.keys(status).sort(), ["connectedAt", "status"]);
  assert.equal(status.status, "CONNECTED");
  const revoked = await googleConnectionStatus("faculty-one", { db, env, forceRefresh: true, fetcher: async () => ({ ok: false, json: async () => ({ error: "invalid_grant" }) }) });
  assert.equal(revoked.status, "RECONNECT_REQUIRED"); assert.equal(db.connections[0].refreshTokenEncrypted, null); assert.equal(db.connections[0].accessTokenEncrypted, null);
});

test("disconnect removes credentials and cancels an in-flight exchange without resurrection", async () => {
  const db = fixture(), launch = await launched(db);
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  const completion = finishGoogleConnection(launch, { db, env, fetcher: async () => { started(); await paused; return { ok: true, json: async () => ok() }; } });
  await ready;
  await disconnectGoogle("faculty-one", { db, env }); release();
  await assert.rejects(completion, { status: 409 }); assert.equal(db.connections.length, 0);
  await finishGoogleConnection(await launched(db), { db, env, fetcher: provider(ok()) });
  const result = await disconnectGoogle("faculty-one", { db, env, fetcher: async () => { throw new Error("Provider unavailable"); } });
  assert.equal(result.revocationConfirmed, false); assert.equal(db.connections.length, 0);
  assert.equal((await googleConnectionStatus("faculty-one", { db, env })).status, "NOT_CONNECTED");
});

test("failed provider requests are connection errors, not Flowlytiks authentication 401s", async () => {
  const db = fixture();
  await assert.rejects(finishGoogleConnection(await launched(db), { db, env, fetcher: async () => { throw new Error("Network failure"); } }), { status: 503 });
  const launch = await launched(db);
  await assert.rejects(finishGoogleConnection(launch, { db, env, fetcher: provider({ ...ok(), scope: "" }) }), { status: 409 });
  assert.equal(db.connections.length, 0);
  await assert.rejects(finishGoogleConnection(await launched(db), { db, env, fetcher: provider({ access_token: "controlled-access", expires_in: 3600, scope: GOOGLE_MEET_SCOPE }) }), { status: 409 });
});

test("legacy connections require verified reconnection and an account switch cannot reuse another account's refresh token", async () => {
  const db = fixture();
  await finishGoogleConnection(await launched(db), { db, env, fetcher: provider(ok()) });
  const original = { ...db.connections[0] };
  delete db.connections[0].googleSubject;
  assert.equal((await googleConnectionStatus("faculty-one", { db, env })).status, "RECONNECT_REQUIRED");
  Object.assign(db.connections[0], original);
  const launch = await launched(db);
  const switched = ok(); delete switched.refresh_token;
  const claims = JSON.parse(switched.id_token); claims.sub = "another-account"; switched.id_token = JSON.stringify(claims);
  await assert.rejects(finishGoogleConnection(launch, { db, env, fetcher: provider(switched) }), { status: 409 });
  assert.equal(db.connections[0].googleSubject, original.googleSubject);
  assert.equal(db.connections[0].refreshTokenEncrypted, original.refreshTokenEncrypted);
});

test("authenticated connection endpoints are faculty-only; callback and launch use state instead of JWT URLs", async () => {
  const { default: router } = await import("../routes/facultygoogleroute.js");
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  for (const path of ["/connect", "/prepare", "/disconnect", "/status"]) {
    const route = router.stack.find(layer => layer.route?.path === path).route;
    assert.equal(route.stack[0].handle.name, "protect");
    const unauthenticated = response(); await route.stack[0].handle({ headers: {} }, unauthenticated, () => assert.fail()); assert.equal(unauthenticated.statusCode, 401);
    for (const userRole of ["admin", "staff", "student"]) {
      const res = response(); route.stack[1].handle({ userRole }, res, () => assert.fail()); assert.equal(res.statusCode, 403);
    }
  }
  assert.equal(router.stack.find(layer => layer.route?.path === "/callback").route.methods.get, true);
});

test("a forwarded launch ticket cannot pass browser/faculty preparation", async () => {
  const db = fixture(); const { startUrl } = await startGoogleConnection("faculty-one", { db, env });
  const ticket = new URL(startUrl).searchParams.get("ticket");
  await assert.rejects(prepareGoogleConnection("faculty-two", ticket, { db, env }), { status: 400 });
  await assert.rejects(launchGoogleConnection(ticket, "", { db, env }), { status: 400 });
  const { nonce } = await prepareGoogleConnection("faculty-one", ticket, { db, env });
  await assert.rejects(launchGoogleConnection(ticket, randomBytes(32).toString("base64url"), { db, env }), { status: 400 });
  await launchGoogleConnection(ticket, nonce, { db, env });
});
