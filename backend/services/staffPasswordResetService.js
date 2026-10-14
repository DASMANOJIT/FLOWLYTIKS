import crypto from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../prisma/client.js";
import { sendEmailOtp, verifyEmailOtp } from "./emailOtpService.js";
import { sendOtpEmail } from "./emailService.js";
import { normalizeEmail, isValidEmail, isStrongPassword } from "../utils/authValidation.js";
import { clearUserSessions } from "../utils/sessionStore.js";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const emailValue = value => { const email = normalizeEmail(value); if (!isValidEmail(email)) throw fail("Enter a valid email address."); return email; };
const purposeFor = (staff, grant = false) => `staff_password_reset${grant ? "_grant" : ""}:${staff ? `${staff.id}:${hash(staff.passwordHash)}` : "unavailable"}`;
const otpWhere = (email, purpose) => ({ EmailOtp_email_purpose_key: { email, purpose } });
const account = async (db, email) => db.staff.findFirst({ where: { email: { equals: email, mode: "insensitive" }, role: "STAFF", isActive: true }, select: { id: true, passwordHash: true } });
async function atomic(db, work) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: "Serializable", timeout: 15000 }); }
    catch (error) { if (error.code !== "P2034" || attempt === 2) throw error; }
  }
}

export function createStaffPasswordResetService(db = prisma, deliver = sendOtpEmail) {
  async function send(emailInput) {
    const email = emailValue(emailInput);
    let delivery;
    const saved = await atomic(db, async tx => {
      const staff = await account(tx, email), purpose = purposeFor(staff);
      const old = await tx.emailOtp.findUnique({ where: otpWhere(email, purpose) });
      if (old?.lockedUntil > new Date()) throw fail("Too many verification attempts. Please try again later.", 429);
      const grant = !old && await tx.emailOtp.findUnique({ where: otpWhere(email, purposeFor(staff, true)) });
      if (grant && Date.now() - grant.updatedAt.getTime() < 15000) throw fail("Please wait before requesting another code.", 429);
      await sendEmailOtp({ email, purpose, db: tx, preserveAttempts: true, quiet: true, deliver: async (to, code) => { delivery = { to, code }; } });
      await tx.emailOtp.deleteMany({ where: { email, purpose: purposeFor(staff, true) } });
      const record = await tx.emailOtp.findUnique({ where: otpWhere(email, purpose) });
      return { staff, purpose, otpHash: record.otpHash };
    });
    if (saved.staff) {
      try { await deliver(delivery.to, delivery.code); }
      catch (error) {
        await db.emailOtp.deleteMany({ where: { email, purpose: saved.purpose, otpHash: saved.otpHash } });
        throw fail("Verification email could not be delivered. Please try again.", error.status || 503);
      }
    }
    return { success: true, message: "If an eligible Staff account exists, a verification code has been sent.", cooldown: 15 };
  }
  async function verify(emailInput, code) {
    const email = emailValue(emailInput);
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw fail("Enter the six-digit verification code.");
    const result = await atomic(db, async tx => {
      const staff = await account(tx, email);
      if (!staff) return { error: fail("Invalid verification code or reset request.") };
      const purpose = purposeFor(staff);
      const record = await tx.emailOtp.findUnique({ where: otpWhere(email, purpose) });
      // Catch validation errors inside the transaction so failed-attempt updates commit.
      try { await verifyEmailOtp({ email, purpose, code, db: tx, quiet: true }); }
      catch (error) { if (error.status) return { error }; throw error; }
      const resetToken = crypto.randomBytes(32).toString("hex");
      const data = { otpHash: hash(resetToken), expiresAt: record.expiresAt, attempts: 0, lockedUntil: null };
      await tx.emailOtp.upsert({ where: otpWhere(email, purposeFor(staff, true)), create: { email, purpose: purposeFor(staff, true), ...data }, update: data });
      return { success: true, resetToken, message: "Code verified. Enter your new password." };
    });
    if (result.error) throw result.error;
    return result;
  }
  async function save(body) {
    const email = emailValue(body?.email);
    if (typeof body.newPassword !== "string" || Buffer.byteLength(body.newPassword) > 72 || !isStrongPassword(body.newPassword)) throw fail("Password must have 8-72 characters including uppercase, lowercase, number and special character (at most 72 bytes).");
    if (body.newPassword !== body.confirmPassword) throw fail("Passwords do not match.");
    if (typeof body.resetToken !== "string" || !/^[a-f0-9]{64}$/.test(body.resetToken)) throw fail("Verify the reset code first.");
    const passwordHash = await bcrypt.hash(body.newPassword, 10);
    await atomic(db, async tx => {
      const staff = await account(tx, email);
      if (!staff) throw fail("Password reset request is invalid or expired.");
      const purpose = purposeFor(staff, true);
      const grant = await tx.emailOtp.findUnique({ where: otpWhere(email, purpose) });
      if (!grant || grant.expiresAt <= new Date() || grant.otpHash !== hash(body.resetToken)) throw fail("Password reset request is invalid or expired.");
      await tx.staff.update({ where: { id: staff.id }, data: { passwordHash } });
      await tx.emailOtp.delete({ where: { id: grant.id } });
      await clearUserSessions("staff", staff.id, "PASSWORD_CHANGED", tx);
    });
    return { success: true, message: "Password reset successful. Please login as Staff." };
  }
  return { send, verify, save };
}
export const staffPasswordResetService = createStaffPasswordResetService();
