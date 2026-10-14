import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const staff = [];
const requests = [];
const accounts = { admin: [], student: [], faculty: [] };
let serial = Promise.resolve();
const match = (row, where) => Object.entries(where).every(([key, value]) => typeof value === "object" && value?.equals ? row[key]?.toLowerCase() === value.equals.toLowerCase() : row[key] === value);
const db = {
  ...Object.fromEntries(Object.keys(accounts).map((role) => [role, { findFirst: async ({ where }) => accounts[role].find((row) => match(row, where)) || null, findUnique: async ({ where }) => accounts[role].find((row) => match(row, where)) || null }])),
  staff: {
    findMany: async () => staff,
    findFirst: async ({ where }) => staff.find((row) => match(row, where)) || null,
    findUnique: async ({ where }) => staff.find((row) => match(row, where)) || null,
    create: async ({ data }) => { if (staff.some((row) => row.email === data.email)) throw Object.assign(new Error("Duplicate"), { code: "P2002" }); const row = { id: `staff-${staff.length}`, role: "STAFF", isActive: true, ...data }; staff.push(row); return row; },
  },
  staffCreationRequest: {
    findUnique: async ({ where }) => requests.find((row) => match(row, where)) || null,
    upsert: async ({ where, create, update }) => { let row = requests.find((row) => match(row, where)); if (row) Object.assign(row, update); else { row = { id: `request-${requests.length}`, ...create }; requests.push(row); } return { ...row }; },
    update: async ({ where, data }) => { const row = requests.find((row) => match(row, where)); for (const [key, value] of Object.entries(data)) row[key] = value?.increment ? row[key] + value.increment : value; return row; },
    updateMany: async ({ where, data }) => { const rows = requests.filter((row) => match(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length }; },
  },
  userSession: {
    findUnique: async () => ({ role: "staff", userId: "staff-0", isActive: true, revokedAt: null, expiresAt: new Date(Date.now() + 60000), lastSeenAt: new Date(), updatedAt: new Date() }),
    updateMany: async () => ({ count: 0 }),
    findMany: async () => [],
    create: async ({ data }) => { db.lastSession = data; return data; },
  },
  $transaction: (work) => { const pending = serial.then(() => work(db)); serial = pending.catch(() => {}); return pending; },
};
globalThis.__flowlytiksPrisma = db;
process.env.JWT_SECRET = "staff-unit-test-secret-not-used-outside-tests";
const { createStaffAuthService } = await import("../services/staffAuthService.js");
const { protect, adminOnly } = await import("../middleware/authmiddleware.js");
const { default: staffRoutes } = await import("../routes/staffroute.js");
let deliveredCode;
const service = createStaffAuthService(db, async (_email, code) => { deliveredCode = code; });
const details = (email) => ({ name: "Reception Staff", email, password: "StrongPass!9", confirmPassword: "StrongPass!9" });
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });

test("Staff verification and authentication", async (t) => {
  await t.test("actual email payload and stored hash agree for leading-zero and nonzero codes", async () => {
    const crypto = (await import("node:crypto")).default;
    const { sendOtpEmail } = await import("../services/emailService.js");
    const { verifyEmailOtp } = await import("../services/emailOtpService.js");
    const originalRandom = crypto.randomInt;
    const originalFetch = globalThis.fetch;
    const previousEnv = { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM };
    process.env.RESEND_API_KEY = "test-key-never-sent";
    process.env.EMAIL_FROM = "test@example.com";
    let payload;
    globalThis.fetch = async (_url, options) => {
      payload = JSON.parse(options.body);
      return { ok: true, json: async () => ({ id: "test-delivery" }) };
    };
    try {
      const pipeline = createStaffAuthService(db, sendOtpEmail);
      for (const number of [12345, 123456]) {
        crypto.randomInt = () => number;
        const sent = await pipeline.sendCode(1, details(`pipeline-${number}@example.com`));
        const row = requests.find((item) => item.id === sent.requestId);
        const emailed = payload.text.match(/code is (\d{6})\./)[1];
        assert.equal(emailed.length, 6, "Email code must remain six characters");
        assert.equal(payload.html.includes(`<strong>${emailed}</strong>`), true, "HTML and text must agree");
        assert.equal(await bcrypt.compare(emailed, row.otpHash), true, "Stored hash must match the emailed representation");
        db.emailOtp = {
          findUnique: async () => ({ id: "comparison", otpHash: row.otpHash, expiresAt: row.expiresAt, attempts: 0 }),
          deleteMany: async () => ({ count: 1 }),
        };
        assert.equal((await verifyEmailOtp({ email: row.email, code: emailed })).success, true);
        const submitted = JSON.parse(JSON.stringify({ requestId: sent.requestId, code: emailed }));
        const created = await pipeline.verify(1, submitted.requestId, submitted.code);
        assert.ok(created.verifiedAt);
        await assert.rejects(pipeline.verify(1, submitted.requestId, submitted.code), { code: "STAFF_CHALLENGE_CONSUMED" });
        staff.splice(staff.indexOf(created), 1);
      }
    } finally {
      crypto.randomInt = originalRandom;
      globalThis.fetch = originalFetch;
      delete db.emailOtp;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
  await t.test("resending invalidates old code and preserves leading-zero strings", async () => {
    const crypto = (await import("node:crypto")).default;
    const original = crypto.randomInt;
    try {
      crypto.randomInt = () => 12;
      const sent = await service.sendCode(1, details("resend@example.com"));
      const oldCode = deliveredCode;
      const row = requests.find((item) => item.id === sent.requestId);
      row.lastSentAt = new Date(Date.now() - 16000);
      crypto.randomInt = () => 34;
      await service.sendCode(1, {}, sent.requestId);
      await assert.rejects(service.verify(1, sent.requestId, oldCode), { code: "STAFF_CODE_INVALID" });
      await assert.rejects(service.verify(1, sent.requestId, 34), { code: "STAFF_CODE_FORMAT_INVALID" });
      assert.equal(deliveredCode.length, 6);
      const created = await service.verify(1, sent.requestId, deliveredCode);
      assert.equal(created.email, "resend@example.com");
      staff.splice(staff.indexOf(created), 1);
    } finally { crypto.randomInt = original; }
  });
  await t.test("expired Admin JWT is distinct from a database authentication failure", async () => {
    const token = jwt.sign({ id: 1, role: "admin" }, process.env.JWT_SECRET, { expiresIn: -1 });
    const res = response();
    await protect({ headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/staff/creation/verify" }, res, () => assert.fail("Must not continue"));
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, "ADMIN_AUTH_INVALID");
    const original = db.admin.findUnique;
    db.admin.findUnique = async () => { throw new Error("Database unavailable"); };
    try {
      const valid = jwt.sign({ id: 1, role: "admin" }, process.env.JWT_SECRET);
      const res = response();
      await protect({ headers: { authorization: `Bearer ${valid}` }, originalUrl: "/api/staff/creation/verify" }, res, () => assert.fail("Must not continue"));
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.code, "AUTH_SERVICE_UNAVAILABLE");
    } finally { db.admin.findUnique = original; }
  });
  await t.test("existing email in every account model is rejected", async () => {
    for (const role of Object.keys(accounts)) { accounts[role].push({ id: 1, email: `${role}@example.com` }); await assert.rejects(service.sendCode(1, details(`${role}@example.com`)), /existing account/); }
  });
  const sent = await service.sendCode(1, details("staff@example.com"));
  const code = deliveredCode;
  const pending = requests.find((row) => row.id === sent.requestId);
  await t.test("send stores only hashes and no active account", () => { assert.equal(staff.length, 0); assert.notEqual(pending.otpHash, code); assert.notEqual(pending.passwordHash, details("").password); });
  await t.test("another admin cannot verify the creation request", async () => { await assert.rejects(service.verify(2, sent.requestId, code), /no longer valid/); });
  await t.test("incorrect code fails and attempt is persisted", async () => { await assert.rejects(service.verify(1, sent.requestId, code === "000000" ? "111111" : "000000"), /Incorrect/); assert.equal(pending.attempts, 1); });
  await t.test("resend cooldown enforced", async () => { await assert.rejects(service.sendCode(1, {}, sent.requestId), /wait/); });
  await t.test("concurrent verification creates exactly one account", async () => { const results = await Promise.allSettled([service.verify(1, sent.requestId, code), service.verify(1, sent.requestId, code)]); assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); assert.equal(staff.length, 1); });
  await t.test("reused code and duplicate account rejected", async () => { await assert.rejects(service.verify(1, sent.requestId, code), /no longer valid/); await assert.rejects(service.sendCode(1, details("staff@example.com")), /existing account/); });
  await t.test("expired code fails", async () => { const sent = await service.sendCode(1, details("expired@example.com")); requests.find((row) => row.id === sent.requestId).expiresAt = new Date(0); await assert.rejects(service.verify(1, sent.requestId, deliveredCode), /expired/); });
  await t.test("attempt limit enforced", async () => { const sent = await service.sendCode(1, details("limited@example.com")); const row = requests.find((row) => row.id === sent.requestId); row.attempts = 5; await assert.rejects(service.verify(1, sent.requestId, deliveredCode), /Too many/); });
  await t.test("email failure invalidates code and creates no account", async () => { const failed = createStaffAuthService(db, async () => { throw new Error("Email unavailable"); }); await assert.rejects(failed.sendCode(1, details("failure@example.com")), /could not be delivered/); assert.equal(requests.find((row) => row.email === "failure@example.com").expiresAt.getTime(), 0); assert.equal(staff.length, 1); });
  await t.test("password hash accepts chosen password and rejects wrong password", async () => { assert.equal(await bcrypt.compare("StrongPass!9", staff[0].passwordHash), true); assert.equal(await bcrypt.compare("Wrong!9", staff[0].passwordHash), false); });
  await t.test("unauthenticated creation is rejected", async () => { const res = response(); await protect({ headers: {} }, res, () => assert.fail("Must not continue")); assert.equal(res.statusCode, 401); });
  await t.test("staff blocked from admin and faculty APIs", async () => {
    const token = jwt.sign({ id: "staff-0", role: "staff" }, process.env.JWT_SECRET, { jwtid: "unit-session" });
    for (const url of ["/api/admin/class-school-groups", "/api/faculty/dashboard", "/api/work-ledger", "/api/payments/revenue"]) { const res = response(); await protect({ headers: { authorization: `Bearer ${token}` }, originalUrl: url }, res, () => assert.fail("Must not continue")); assert.equal(res.statusCode, 403); }
    const res = response(); adminOnly({ user: staff[0], userRole: "staff" }, res, () => assert.fail("Must not continue")); assert.equal(res.statusCode, 403);
  });
  await t.test("staff own authenticated route is accepted", async () => { const token = jwt.sign({ id: "staff-0", role: "staff" }, process.env.JWT_SECRET, { jwtid: "unit-session" }); let continued = false; await protect({ headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/staff/me" }, response(), () => { continued = true; }); assert.equal(continued, true); });
  await t.test("login handler rejects wrong password", async () => { const handler = staffRoutes.stack.find((layer) => layer.route?.path === "/login").route.stack.at(-1).handle; const res = response(); await handler({ body: { email: "staff@example.com", password: "Wrong!9" } }, res); assert.equal(res.statusCode, 401); });
  await t.test("valid staff login issues a signed token and hashed session", async () => {
    const handler = staffRoutes.stack.find((layer) => layer.route?.path === "/login").route.stack.at(-1).handle;
    const res = response();
    await handler({ body: { email: "staff@example.com", password: "StrongPass!9" }, headers: {}, ip: "127.0.0.1" }, res);
    assert.equal(res.statusCode, 200);
    const payload = jwt.verify(res.body.token, process.env.JWT_SECRET);
    assert.equal(payload.role, "staff"); assert.equal(payload.id, staff[0].id);
    assert.equal(db.lastSession.role, "staff"); assert.notEqual(db.lastSession.sessionTokenHash, payload.jti);
    assert.equal(res.body.passwordHash, undefined);
  });
  await t.test("inactive staff login fails", async () => {
    staff[0].isActive = false;
    const handler = staffRoutes.stack.find((layer) => layer.route?.path === "/login").route.stack.at(-1).handle;
    const res = response(); await handler({ body: { email: "staff@example.com", password: "StrongPass!9" } }, res);
    assert.equal(res.statusCode, 403); staff[0].isActive = true;
  });
  await t.test("existing admin, faculty and student authentication still pass", async () => {
    const original = db.userSession.findUnique;
    accounts.faculty[0].status = "ACTIVE";
    for (const role of ["admin", "faculty", "student"]) {
      db.userSession.findUnique = async () => ({ role, userId: "1", isActive: true, revokedAt: null, expiresAt: new Date(Date.now() + 60000), lastSeenAt: new Date() });
      const token = jwt.sign({ id: 1, role }, process.env.JWT_SECRET, { jwtid: "legacy-session" });
      let continued = false;
      await protect({ headers: { authorization: `Bearer ${token}` }, originalUrl: "/api/auth/heartbeat" }, response(), () => { continued = true; });
      assert.equal(continued, true);
    }
    db.userSession.findUnique = original;
  });
  await t.test("missing Staff tables return actionable 503 for both routes", async () => {
    const originalFindMany = db.staff.findMany;
    const originalFindRequest = db.staffCreationRequest.findUnique;
    const missingTable = async () => { throw Object.assign(new Error("Database internals must not appear in response"), { code: "P2021", name: "PrismaClientKnownRequestError" }); };
    db.staff.findMany = missingTable;
    db.staffCreationRequest.findUnique = missingTable;
    try {
      for (const path of ["/members", "/creation/send-code"]) {
        const handler = staffRoutes.stack.find((layer) => layer.route?.path === path).route.stack.at(-1).handle;
        const res = response();
        await handler({ body: details("not-ready@example.com"), user: { id: 1 }, method: path === "/members" ? "GET" : "POST", route: { path } }, res);
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.code, "STAFF_DATABASE_NOT_READY");
        assert.match(res.body.message, /migration/);
        assert.doesNotMatch(res.body.message, /internals/);
      }
    } finally { db.staff.findMany = originalFindMany; db.staffCreationRequest.findUnique = originalFindRequest; }
  });
  await t.test("unexpected Staff errors return 500 rather than a misleading 503", async () => {
    const original = db.staff.findMany;
    db.staff.findMany = async () => { throw new Error("Private debug details"); };
    try {
      const handler = staffRoutes.stack.find((layer) => layer.route?.path === "/members").route.stack.at(-1).handle;
      const res = response(); await handler({ method: "GET", route: { path: "/members" } }, res);
      assert.equal(res.statusCode, 500); assert.doesNotMatch(res.body.message, /Private/);
    } finally { db.staff.findMany = original; }
  });
});
