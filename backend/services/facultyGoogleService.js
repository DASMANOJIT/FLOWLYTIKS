import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import prisma from "../prisma/client.js";
import { OAuth2Client } from "google-auth-library";

export const GOOGLE_MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.readonly";
export const GOOGLE_CONNECTION_SCOPES = `openid ${GOOGLE_MEET_SCOPE}`;

export async function verifyGoogleIdentity(idToken, nonceHash, clientId, verifier = new OAuth2Client(clientId)) {
  try {
    if (typeof idToken !== "string" || !nonceHash) throw new Error();
    const ticket = await verifier.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload || !["accounts.google.com", "https://accounts.google.com"].includes(payload.iss) || payload.aud !== clientId || (payload.azp && payload.azp !== clientId) || !Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now() || typeof payload.sub !== "string" || !/^[a-zA-Z0-9_-]{1,255}$/.test(payload.sub) || typeof payload.nonce !== "string") throw new Error();
    const expected = Buffer.from(nonceHash, "hex"), actual = Buffer.from(hash(payload.nonce), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
    return payload.sub;
  } catch { fail("Google account identity could not be verified. Reconnect Google.", 409); }
}
const TTL = 10 * 60 * 1000;
const hash = value => createHash("sha256").update(value).digest("hex");
const random = () => randomBytes(32).toString("base64url");
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const opaque = value => typeof value === "string" && /^[a-zA-Z0-9_-]{43}$/.test(value);

export function googleConfig(env = process.env) {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REDIRECT_URI: redirectUri } = env;
  const rawKey = String(env.GOOGLE_TOKEN_ENCRYPTION_KEY || "").trim();
  const key = Buffer.from(rawKey, "base64");
  const missing = [!clientId && "GOOGLE_CLIENT_ID", !clientSecret && "GOOGLE_CLIENT_SECRET", !redirectUri && "GOOGLE_REDIRECT_URI", !rawKey && "GOOGLE_TOKEN_ENCRYPTION_KEY", !(env.FRONTEND_URL || String(env.CORS_ORIGIN || "").split(",")[0].trim()) && "FRONTEND_URL or CORS_ORIGIN"].filter(Boolean);
  if (missing.length) {
    console.warn("faculty.google.configuration_missing", { missing });
    fail("Google connection is unavailable. Please contact admin.", 503);
  }
  if (key.length !== 32 || key.toString("base64") !== rawKey) fail("Google connection is unavailable. Please contact admin.", 503);
  let callback, frontend;
  try {
    callback = new URL(redirectUri);
    frontend = new URL(env.FRONTEND_URL || String(env.CORS_ORIGIN || "").split(",")[0].trim());
  } catch { fail("Google connection is unavailable. Please contact admin.", 503); }
  const safe = url => !url.username && !url.password && (url.protocol === "https:" || (env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
  if (!safe(callback) || !safe(frontend) || callback.pathname !== "/api/faculty/google/callback" || callback.search || callback.hash) fail("Google connection is unavailable. Please contact admin.", 503);
  return { clientId, clientSecret, redirectUri, key, callbackOrigin: callback.origin, frontendOrigin: frontend.origin };
}

export function encryptGoogleSecret(value, key, context) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptGoogleSecret(value, key, context) {
  try {
    const [version, iv, tag, ciphertext, extra] = value.split(".");
    if (version !== "v1" || extra || !iv || !tag || !ciphertext) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch { fail("Google credentials could not be read. Reconnect Google.", 409); }
}

async function lockFaculty(tx, facultyId) {
  await tx.$queryRaw`SELECT "id" FROM "Faculty" WHERE "id" = ${facultyId} FOR UPDATE`;
  const faculty = await tx.faculty.findUnique({ where: { id: facultyId }, select: { status: true } });
  if (faculty?.status !== "ACTIVE") fail("Faculty account is unavailable.", 403);
}

export async function startGoogleConnection(facultyId, { db = prisma, env = process.env } = {}) {
  const config = googleConfig(env), ticket = random();
  await db.$transaction(async tx => {
    await lockFaculty(tx, facultyId);
    await tx.facultyGoogleOAuthState.updateMany({ where: { facultyId, cancelledAt: null }, data: { cancelledAt: new Date(), codeVerifierEncrypted: null } });
    await tx.facultyGoogleOAuthState.create({ data: { facultyId, launchTokenHash: hash(ticket), expiresAt: new Date(Date.now() + TTL) } });
  });
  return { startUrl: `${config.callbackOrigin}/api/faculty/google/authorize?ticket=${ticket}` };
}

export async function prepareGoogleConnection(facultyId, ticket, { db = prisma, env = process.env } = {}) {
  const config = googleConfig(env), nonce = random();
  if (!opaque(ticket)) fail("Google connection request is invalid or expired.");
  await db.$transaction(async tx => {
    await lockFaculty(tx, facultyId);
    const prepared = await tx.facultyGoogleOAuthState.updateMany({ where: { facultyId, launchTokenHash: hash(ticket), browserNonceHash: null, launchedAt: null, consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, data: { browserNonceHash: hash(nonce) } });
    if (!prepared.count) fail("Google connection request is invalid or expired.");
  });
  return { nonce, secure: new URL(config.redirectUri).protocol === "https:" };
}

export async function launchGoogleConnection(ticket, nonce, { db = prisma, env = process.env } = {}) {
  const config = googleConfig(env);
  if (!opaque(ticket) || !opaque(nonce)) fail("Google connection browser check failed. Start again and allow the backend connection cookie.");
  const state = random(), verifier = random(), oidcNonce = random();
  await db.$transaction(async tx => {
    const row = await tx.facultyGoogleOAuthState.findUnique({ where: { launchTokenHash: hash(ticket) } });
    if (!row || row.browserNonceHash !== hash(nonce)) fail("Google connection browser check failed. Start again and allow the backend connection cookie.");
    await lockFaculty(tx, row.facultyId);
    const claimed = await tx.facultyGoogleOAuthState.updateMany({ where: { id: row.id, launchedAt: null, consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, data: {
      launchedAt: new Date(), stateHash: hash(state), oidcNonceHash: hash(oidcNonce), codeVerifierEncrypted: encryptGoogleSecret(verifier, config.key, `${row.facultyId}:pkce`),
    } });
    if (!claimed.count) fail("Google connection request is invalid or expired.");
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: GOOGLE_CONNECTION_SCOPES, nonce: oidcNonce,
    access_type: "offline", prompt: "consent select_account", include_granted_scopes: "false", state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return { url: url.toString(), nonce, secure: new URL(config.redirectUri).protocol === "https:" };
}

async function requestTokens(parameters, fetcher) {
  let response, data;
  try {
    response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(parameters), signal: AbortSignal.timeout(10000) });
    data = await response.json();
  } catch { fail("Google is temporarily unavailable. Please reconnect and try again.", 503); }
  if (!response.ok || data.error) {
    const error = Object.assign(new Error(data.error === "invalid_grant" ? "Google access has expired or been revoked. Reconnect Google." : "Google authorization failed. Please reconnect and try again."), { status: 409, providerCode: data.error === "invalid_grant" ? "invalid_grant" : "authorization_failed" });
    throw error;
  }
  if (typeof data.access_token !== "string" || !data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 0) fail("Google returned an incomplete authorization. Reconnect Google.", 409);
  if (data.scope !== undefined && (typeof data.scope !== "string" || !data.scope.split(" ").includes(GOOGLE_MEET_SCOPE))) fail("The required Google Meet permission was not granted. Reconnect Google.", 409);
  return data;
}

export async function finishGoogleConnection({ state, nonce, code, denied }, { db = prisma, env = process.env, fetcher = fetch, idTokenVerifier } = {}) {
  const config = googleConfig(env);
  if (!opaque(state) || !opaque(nonce)) fail("Google authorization state is invalid or expired.");
  const row = await db.$transaction(async tx => {
    const record = await tx.facultyGoogleOAuthState.findUnique({ where: { stateHash: hash(state) } });
    if (!record || !record.browserNonceHash || !timingSafeEqual(Buffer.from(record.browserNonceHash), Buffer.from(hash(nonce)))) fail("Google authorization state is invalid or expired.");
    await lockFaculty(tx, record.facultyId);
    const consumed = await tx.facultyGoogleOAuthState.updateMany({ where: { id: record.id, consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date(), codeVerifierEncrypted: null } });
    if (!consumed.count) fail("Google authorization state is invalid or expired.");
    return record;
  });
  if (denied) return { result: "denied" };
  if (typeof code !== "string" || !code || code.length > 4096) fail("Google authorization code is missing.");
  const verifier = decryptGoogleSecret(row.codeVerifierEncrypted, config.key, `${row.facultyId}:pkce`);
  const tokens = await requestTokens({ code, code_verifier: verifier, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" }, fetcher);
  const googleSubject = await verifyGoogleIdentity(tokens.id_token, row.oidcNonceHash, config.clientId, idTokenVerifier);
  return db.$transaction(async tx => {
    await lockFaculty(tx, row.facultyId);
    const currentState = await tx.facultyGoogleOAuthState.findUnique({ where: { id: row.id } });
    if (!currentState || currentState.cancelledAt) fail("Google connection was cancelled. Start again.", 409);
    const previous = await tx.facultyGoogleConnection.findUnique({ where: { facultyId: row.facultyId } });
    const refreshTokenEncrypted = tokens.refresh_token ? encryptGoogleSecret(tokens.refresh_token, config.key, `${row.facultyId}:refresh`) : previous?.googleSubject === googleSubject ? previous.refreshTokenEncrypted : null;
    if (!refreshTokenEncrypted) fail("Google did not grant offline access. Reconnect and approve access again.", 409);
    const data = { accessTokenEncrypted: encryptGoogleSecret(tokens.access_token, config.key, `${row.facultyId}:access`), refreshTokenEncrypted,
      expiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1000), scope: tokens.scope || GOOGLE_CONNECTION_SCOPES, googleSubject, identityVerifiedAt: new Date(), status: "CONNECTED", connectedAt: new Date() };
    await tx.facultyGoogleConnection.upsert({ where: { facultyId: row.facultyId }, create: { facultyId: row.facultyId, ...data }, update: data });
    // A newly verified identity makes retained identity-review evidence eligible for rechecking.
    await tx.facultyOnlineClass.updateMany({ where: { facultyId: row.facultyId, status: "COMPLETED", verificationStatus: "TEACHER_IDENTITY_REVIEW", incentiveEntryId: null, trackingEnabled: true }, data: { nextCheckAt: new Date() } });
    return { result: "connected" };
  });
}

// Backend-only helper for future explicit Meet requests; no polling or Meet calls are registered.
const refreshes = new WeakMap();
export async function getFacultyGoogleAccessToken(facultyId, { db = prisma, env = process.env, fetcher = fetch, forceRefresh = false } = {}) {
  const config = googleConfig(env);
  let pending = refreshes.get(db);
  if (!pending) { pending = new Map(); refreshes.set(db, pending); }
  if (pending.has(facultyId)) return pending.get(facultyId);
  const work = (async () => {
    const connection = await db.facultyGoogleConnection.findUnique({ where: { facultyId } });
    if (!connection || connection.status !== "CONNECTED") return null;
    const where = { facultyId, status: "CONNECTED", connectedAt: connection.connectedAt, accessTokenEncrypted: connection.accessTokenEncrypted, refreshTokenEncrypted: connection.refreshTokenEncrypted };
    const currentToken = async () => {
      const current = await db.facultyGoogleConnection.findUnique({ where: { facultyId } });
      return current?.status === "CONNECTED" && current.expiresAt > new Date() ? decryptGoogleSecret(current.accessTokenEncrypted, config.key, `${facultyId}:access`) : null;
    };
    try {
      if (!forceRefresh && connection.expiresAt > new Date(Date.now() + 60000)) return decryptGoogleSecret(connection.accessTokenEncrypted, config.key, `${facultyId}:access`);
      if (!connection.refreshTokenEncrypted) throw Object.assign(new Error(), { status: 409 });
      // No transaction/row lock is held while waiting for Google. CAS preserves disconnect/reconnect races.
      const tokens = await requestTokens({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: decryptGoogleSecret(connection.refreshTokenEncrypted, config.key, `${facultyId}:refresh`) }, fetcher);
      const saved = await db.facultyGoogleConnection.updateMany({ where, data: { accessTokenEncrypted: encryptGoogleSecret(tokens.access_token, config.key, `${facultyId}:access`),
        ...(tokens.refresh_token ? { refreshTokenEncrypted: encryptGoogleSecret(tokens.refresh_token, config.key, `${facultyId}:refresh`) } : {}), expiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1000) } });
      return saved.count ? tokens.access_token : currentToken();
    } catch (error) {
      if (error.providerCode === "invalid_grant" || (error.status === 409 && !error.providerCode)) {
        const revoked = await db.facultyGoogleConnection.updateMany({ where, data: { status: "RECONNECT_REQUIRED", accessTokenEncrypted: null, refreshTokenEncrypted: null, expiresAt: null } });
        return revoked.count ? null : currentToken();
      }
      throw error;
    }
  })();
  pending.set(facultyId, work);
  try { return await work; } finally { if (pending.get(facultyId) === work) pending.delete(facultyId); }
}

export async function googleConnectionStatus(facultyId, options = {}) {
  const db = options.db || prisma;
  await getFacultyGoogleAccessToken(facultyId, options);
  const record = await db.facultyGoogleConnection.findUnique({ where: { facultyId }, select: { status: true, connectedAt: true, googleSubject: true, identityVerifiedAt: true } });
  return record ? { status: record.status === "CONNECTED" && (!record.googleSubject || !record.identityVerifiedAt) ? "RECONNECT_REQUIRED" : record.status, connectedAt: record.connectedAt } : { status: "NOT_CONNECTED", connectedAt: null };
}

export async function disconnectGoogle(facultyId, { db = prisma, env = process.env, fetcher = fetch } = {}) {
  let config;
  try { config = googleConfig(env); } catch { /* Missing configuration must not prevent removing stored credentials. */ }
  let revokeToken = null;
  let hadCredentials = false;
  await db.$transaction(async tx => {
    await lockFaculty(tx, facultyId);
    const connection = await tx.facultyGoogleConnection.findUnique({ where: { facultyId } });
    hadCredentials = Boolean(connection?.refreshTokenEncrypted || connection?.accessTokenEncrypted);
    try {
      if (config && connection?.refreshTokenEncrypted) revokeToken = decryptGoogleSecret(connection.refreshTokenEncrypted, config.key, `${facultyId}:refresh`);
      else if (config && connection?.accessTokenEncrypted) revokeToken = decryptGoogleSecret(connection.accessTokenEncrypted, config.key, `${facultyId}:access`);
    } catch { /* Local deletion remains possible after key rotation. */ }
    await tx.facultyGoogleOAuthState.updateMany({ where: { facultyId, cancelledAt: null }, data: { cancelledAt: new Date(), codeVerifierEncrypted: null } });
    await tx.facultyGoogleConnection.deleteMany({ where: { facultyId } });
  });
  let revocationConfirmed = !hadCredentials;
  if (revokeToken) {
    try {
      const response = await fetcher("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: revokeToken }), signal: AbortSignal.timeout(10000) });
      revocationConfirmed = response.ok;
    } catch { revocationConfirmed = false; }
  }
  return { status: "NOT_CONNECTED", revocationConfirmed };
}
