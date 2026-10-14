import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("OTP concurrent wrong attempts cannot exceed/bypass budget; consumption is single-use", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { verifyEmailOtp } = await import("../services/emailOtpService.js");
  const email = `${randomUUID()}@example.invalid`, code = "012345";
  const data = { email, purpose: "login", otpHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + 300000) };
  try {
    await db.emailOtp.create({ data });
    const wrong = await Promise.allSettled(Array.from({ length: 12 }, () => verifyEmailOtp({ email, purpose: "login", code: "999999", quiet: true })));
    assert.ok(wrong.every(result => result.status === "rejected"));
    const saved = await db.emailOtp.findUniqueOrThrow({ where: { EmailOtp_email_purpose_key: { email, purpose: "login" } } });
    assert.equal(saved.attempts, 10);
    assert.ok(saved.lockedUntil > new Date());
    await assert.rejects(verifyEmailOtp({ email, purpose: "login", code, quiet: true }), { status: 429 });
    await db.emailOtp.update({ where: { id: saved.id }, data: { attempts: 0, lockedUntil: null } });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => verifyEmailOtp({ email, purpose: "login", code, quiet: true })));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.ok(results.filter(result => result.status === "rejected").every(result => result.reason.status === 400));
    assert.equal(await db.emailOtp.count({ where: { email } }), 0);
    await db.emailOtp.create({ data: { ...data, expiresAt: new Date(Date.now() - 1) } });
    await assert.rejects(verifyEmailOtp({ email, purpose: "login", code, quiet: true }), { status: 410 });
    await db.emailOtp.create({ data });
    await assert.rejects(verifyEmailOtp({ email, purpose: "signup", code, quiet: true }), { status: 400 });
    const replacement = "654321";
    await db.emailOtp.updateMany({ where: { email }, data: { otpHash: await bcrypt.hash(replacement, 10) } });
    await assert.rejects(verifyEmailOtp({ email, purpose: "login", code, quiet: true }), { status: 400 });
    await verifyEmailOtp({ email, purpose: "login", code: replacement, quiet: true });
    await assert.rejects(verifyEmailOtp({ email, purpose: "login", code: replacement, quiet: true }), { status: 400 });
  } finally { await db.emailOtp.deleteMany({ where: { email } }); await db.$disconnect(); }
});
