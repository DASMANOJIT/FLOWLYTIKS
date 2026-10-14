import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { createStaffPasswordResetService } from "../services/staffPasswordResetService.js";

async function fixture() {
  const state = { staff: { id: "staff-test", passwordHash: await bcrypt.hash("OriginalPass!9", 10) }, rows: [], sessions: [{ role: "staff", userId: "staff-test", isActive: true }, { role: "admin", userId: "1", isActive: true }] };
  const find = where => where.id ? state.rows.find(row => row.id === where.id) : state.rows.find(row => row.email === where.EmailOtp_email_purpose_key.email && row.purpose === where.EmailOtp_email_purpose_key.purpose);
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(option => matches(row, option));
    if (value && typeof value === "object") return Object.entries(value).every(([operator, limit]) => operator === "lt" ? row[key] < limit : operator === "gte" ? row[key] >= limit : operator === "gt" ? row[key] > limit : operator === "lte" ? row[key] <= limit : false);
    return row[key] === value;
  });
  const db = {
    staff: { findFirst: async q => q.where.email.equals === "staff@example.com" ? { ...state.staff } : null, update: async ({ where, data }) => { assert.equal(where.id, "staff-test"); Object.assign(state.staff, data); } },
    emailOtp: {
      findUnique: async ({ where }) => find(where) || null,
      upsert: async ({ where, create, update }) => { let row = find(where); if (row) Object.assign(row, update); else { row = { id: `otp-${state.rows.length}-${crypto.randomUUID()}`, createdAt: new Date(), ...create }; state.rows.push(row); } row.updatedAt = new Date(); return row; },
      update: async ({ where, data }) => { const row = find(where); Object.assign(row, { ...data, ...(data.attempts?.increment ? { attempts: row.attempts + data.attempts.increment } : {}) }); return row; },
      delete: async ({ where }) => { state.rows = state.rows.filter(row => row.id !== where.id); },
      updateMany: async ({ where, data }) => { const rows = state.rows.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, { ...data, ...(data.attempts?.increment ? { attempts: row.attempts + data.attempts.increment } : {}) })); return { count: rows.length }; },
      deleteMany: async ({ where }) => { const before = state.rows.length; state.rows = state.rows.filter(row => !matches(row, where)); return { count: before - state.rows.length }; },
    },
    userSession: { updateMany: async ({ where, data }) => { assert.equal(where.role, "staff"); for (const row of state.sessions) if (row.role === where.role && row.userId === where.userId) Object.assign(row, data); } },
    $transaction: async work => { const previous = structuredClone(state); try { return await work(db); } catch (error) { Object.assign(state, previous); throw error; } },
  };
  const deliveries = [];
  const service = createStaffPasswordResetService(db, async (email, code) => deliveries.push({ email, code }));
  const send = async value => { const original = crypto.randomInt; crypto.randomInt = () => value; try { return await service.send(" Staff@Example.com "); } finally { crypto.randomInt = original; } };
  return { state, db, service, deliveries, send };
}

test("Staff reset preserves leading zeros and atomically updates password/revokes only Staff sessions", async () => {
  const f = await fixture();
  await f.send(12345);
  assert.equal(f.deliveries[0].code.length, 6); assert.ok(f.deliveries[0].code.startsWith("0"));
  const grant = await f.service.verify("staff@example.com", f.deliveries[0].code);
  await assert.rejects(f.service.verify("staff@example.com", f.deliveries[0].code), { status: 400 });
  const body = { email: "staff@example.com", resetToken: grant.resetToken, newPassword: "ReplacementPass!8", confirmPassword: "ReplacementPass!8" };
  await assert.rejects(f.service.save({ ...body, confirmPassword: "DifferentPass!8" }), /Passwords do not match/);
  assert.equal((await f.service.save(body)).success, true);
  assert.equal(await bcrypt.compare("OriginalPass!9", f.state.staff.passwordHash), false);
  assert.equal(await bcrypt.compare(body.newPassword, f.state.staff.passwordHash), true);
  assert.equal(f.state.sessions[0].isActive, false); assert.equal(f.state.sessions[0].revokedReason, "PASSWORD_CHANGED");
  assert.equal(f.state.sessions[1].isActive, true);
  await assert.rejects(f.service.save(body), { status: 400 });
});

test("Wrong/expired/numeric codes fail and attempts persist", async () => {
  const f = await fixture(); await f.send(123456);
  await assert.rejects(f.service.verify("staff@example.com", 123456), { status: 400 });
  await assert.rejects(f.service.verify("staff@example.com", "999999"), { status: 400 });
  assert.equal(f.state.rows[0].attempts, 1);
  f.state.rows[0].expiresAt = new Date(0);
  await assert.rejects(f.service.verify("staff@example.com", f.deliveries[0].code), { status: 410 });
});

test("Resend observes cooldown, rejects old code, retains attempts and accepts new code", async () => {
  const f = await fixture(); await f.send(123456);
  await assert.rejects(f.send(12345), { status: 429 });
  await assert.rejects(f.service.verify("staff@example.com", "999999"), { status: 400 });
  f.state.rows[0].updatedAt = new Date(Date.now() - 16000);
  await f.send(12345);
  assert.equal(f.state.rows[0].attempts, 1);
  await assert.rejects(f.service.verify("staff@example.com", f.deliveries[0].code), { status: 400 });
  assert.ok((await f.service.verify("staff@example.com", f.deliveries[1].code)).resetToken);
});

test("Attempt limit, reset-grant expiry and email failure are enforced", async () => {
  const f = await fixture(); await f.send(123456);
  f.state.rows[0].attempts = 9;
  await assert.rejects(f.service.verify("staff@example.com", "999999"), { status: 429 });
  await assert.rejects(f.service.verify("staff@example.com", f.deliveries[0].code), { status: 429 });
  await assert.rejects(f.send(123456), { status: 429 });
  const other = await fixture(); await other.send(123456); const grant = await other.service.verify("staff@example.com", other.deliveries[0].code);
  other.state.rows[0].expiresAt = new Date(0);
  await assert.rejects(other.service.save({ email: "staff@example.com", resetToken: grant.resetToken, newPassword: "ReplacementPass!8", confirmPassword: "ReplacementPass!8" }), { status: 400 });
  const failed = await fixture(); const service = createStaffPasswordResetService(failed.db, async () => { throw new Error("Unavailable"); });
  await assert.rejects(service.send("staff@example.com"), { status: 503 }); assert.equal(failed.state.rows.length, 0);
});

test("Generic response and Staff-only lookup cannot reset an Admin/Faculty/Student password", async () => {
  const f = await fixture();
  const unknown = await f.service.send("admin@example.com"), known = await f.send(123456);
  assert.deepEqual(unknown, known); assert.equal(f.deliveries.length, 1);
  await assert.rejects(f.service.verify("admin@example.com", "123456"), { status: 400 });
  await assert.rejects(f.service.save({ email: "admin@example.com", resetToken: "a".repeat(64), newPassword: "ReplacementPass!8", confirmPassword: "ReplacementPass!8" }), { status: 400 });
});

test("Failure revoking sessions rolls back password change and preserves the reset grant", async () => {
  const f = await fixture(); await f.send(123456); const grant = await f.service.verify("staff@example.com", f.deliveries[0].code);
  f.db.userSession.updateMany = async () => { throw new Error("Database unavailable"); };
  await assert.rejects(f.service.save({ email: "staff@example.com", resetToken: grant.resetToken, newPassword: "ReplacementPass!8", confirmPassword: "ReplacementPass!8" }), /Database unavailable/);
  assert.equal(await bcrypt.compare("OriginalPass!9", f.state.staff.passwordHash), true); assert.equal(f.state.rows.length, 1);
});

test("Resend after verification enforces cooldown and invalidates the previous reset grant", async () => {
  const f = await fixture(); await f.send(123456);
  const grant = await f.service.verify("staff@example.com", f.deliveries[0].code);
  await assert.rejects(f.send(12345), { status: 429 });
  f.state.rows[0].updatedAt = new Date(Date.now() - 16000);
  await f.send(12345);
  await assert.rejects(f.service.save({ email: "staff@example.com", resetToken: grant.resetToken, newPassword: "ReplacementPass!8", confirmPassword: "ReplacementPass!8" }), { status: 400 });
  assert.ok((await f.service.verify("staff@example.com", f.deliveries[1].code)).resetToken);
});
