import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const unavailable = () => Object.assign(new Error("Database unavailable"), { name: "PrismaClientInitializationError" });
const db = {
  admin: { findUnique: async () => ({ id: 1, name: "Test Admin" }) },
  userSession: {
    findUnique: async () => ({ role: "admin", userId: "1", isActive: true, expiresAt: new Date(Date.now() + 60000), lastSeenAt: new Date(), updatedAt: new Date() }),
    updateMany: async () => ({ count: 1 }),
  },
};
globalThis.__flowlytiksPrisma = db;
process.env.JWT_SECRET = "session-regression-test-only";
const { protect } = await import("../middleware/authmiddleware.js");
const { heartbeatSession, loginUser, logoutUser } = await import("../controllers/authcontrollers.js");
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const request = () => ({ originalUrl: "/api/auth/heartbeat", headers: { authorization: `Bearer ${jwt.sign({ id: 1, role: "admin" }, process.env.JWT_SECRET, { jwtid: "test-session" })}` } });

test("authentication distinguishes database failures from invalid sessions", async (t) => {
  await t.test("a closed connection retries once and preserves the valid session", async () => {
    const original = db.admin.findUnique;
    let calls = 0;
    db.admin.findUnique = async () => { if (++calls === 1) throw Object.assign(new Error("Error in PostgreSQL connection: Error { kind: Closed, cause: None }"), { name: "PrismaClientUnknownRequestError" }); return original(); };
    try {
      let authorized = false;
      const res = response();
      await protect(request(), res, () => { authorized = true; });
      assert.equal(authorized, true); assert.equal(calls, 2); assert.equal(res.statusCode, 200);
    } finally { db.admin.findUnique = original; }
  });
  await t.test("persistent closed heartbeat connection returns 503 after one retry", async () => {
    const original = db.userSession.updateMany;
    let calls = 0;
    db.userSession.updateMany = async () => { calls++; throw Object.assign(new Error("Server has closed the connection"), { name: "PrismaClientKnownRequestError", code: "P1017" }); };
    try {
      const res = response();
      await heartbeatSession({ user: { id: 1 }, userRole: "admin", tokenId: "test-session" }, res);
      assert.equal(calls, 2); assert.equal(res.statusCode, 503); assert.equal(res.body.code, "AUTH_SERVICE_UNAVAILABLE");
    } finally { db.userSession.updateMany = original; }
  });
  for (const [model, method] of [["admin", "findUnique"], ["userSession", "findUnique"]]) {
    await t.test(`${model} lookup failure returns 503, not 401`, async () => {
      const original = db[model][method];
      db[model][method] = async () => { throw unavailable(); };
      try {
        const res = response();
        await protect(request(), res, () => assert.fail("Unavailable database must not authorize"));
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.code, "AUTH_SERVICE_UNAVAILABLE");
      } finally { db[model][method] = original; }
    });
  }
  await t.test("heartbeat write failure returns 503", async () => {
    const original = db.userSession.updateMany;
    db.userSession.updateMany = async () => { throw unavailable(); };
    try {
      const res = response();
      await heartbeatSession({ user: { id: 1 }, userRole: "admin", tokenId: "test-session" }, res);
      assert.equal(res.statusCode, 503);
    } finally { db.userSession.updateMany = original; }
  });
  await t.test("valid Admin session remains authorized", async () => {
    let authorized = false;
    await protect(request(), response(), () => { authorized = true; });
    assert.equal(authorized, true);
  });
  await t.test("invalid token is still rejected", async () => {
    const res = response();
    await protect({ originalUrl: "/api/auth/heartbeat", headers: { authorization: "Bearer invalid" } }, res, () => assert.fail("Invalid token"));
    assert.equal(res.statusCode, 401);
  });
});

test("Admin password login, subsequent requests and logout retain real verification rules", async () => {
  const originalAdmin = db.admin.findUnique;
  const originalSessions = { ...db.userSession };
  let session;
  db.admin.findUnique = async () => ({ id: 1, name: "Test Admin", email: "admin@example.com", password: await bcrypt.hash("ControlledTest!9", 4) });
  db.userSession.findMany = async () => [];
  db.userSession.create = async ({ data }) => { session = { ...data, updatedAt: new Date() }; return session; };
  db.userSession.findUnique = async () => session || null;
  db.userSession.updateMany = async ({ data }) => { if (session && data.revokedReason !== "EXPIRED") Object.assign(session, data); return { count: session ? 1 : 0 }; };
  try {
    const invalid = response();
    await loginUser({ body: { email: "admin@example.com", password: "WrongTest!9" }, headers: {} }, invalid);
    assert.equal(invalid.statusCode, 401);
    assert.equal(session, undefined);
    const valid = response();
    await loginUser({ body: { email: "admin@example.com", password: "ControlledTest!9" }, headers: {} }, valid);
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.body.role, "admin");
    assert.equal(jwt.verify(valid.body.token, process.env.JWT_SECRET).role, "admin");
    for (const path of ["/api/students", "/api/payments/revenue", "/api/auth/heartbeat"]) {
      let allowed = false;
      await protect({ originalUrl: path, headers: { authorization: `Bearer ${valid.body.token}` } }, response(), () => { allowed = true; });
      assert.equal(allowed, true);
    }
    const req = { originalUrl: "/api/auth/logout", headers: { authorization: `Bearer ${valid.body.token}` } };
    await protect(req, response(), () => {});
    const logout = response();
    await logoutUser(req, logout);
    assert.equal(logout.statusCode, 200);
    const reused = response();
    await protect(req, reused, () => assert.fail("Logged-out token must not authorize"));
    assert.equal(reused.statusCode, 401);
    db.userSession.create = async () => { throw unavailable(); };
    const failed = response();
    await loginUser({ body: { email: "admin@example.com", password: "ControlledTest!9" }, headers: {} }, failed);
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.body.token, undefined);
  } finally {
    db.admin.findUnique = originalAdmin;
    for (const key of Object.keys(db.userSession)) delete db.userSession[key];
    Object.assign(db.userSession, originalSessions);
  }
});
