import bcrypt from "bcryptjs";
import crypto from "crypto";
import prisma from "../prisma/client.js";
import { sendOtpEmail } from "./emailService.js";
import { isStrongPassword, isValidEmail, isValidName, normalizeEmail, normalizeName } from "../utils/authValidation.js";

export const staffSelect = { id: true, name: true, email: true, role: true, isActive: true, verifiedAt: true, createdAt: true };
const EXPIRY_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 15 * 1000;
const MAX_ATTEMPTS = 5;
const failure = (message, status = 400, retryAfter, code = "STAFF_VALIDATION_FAILED") => Object.assign(new Error(message), { status, retryAfter, code });

export async function existingAccount(db, email) {
  const where = { email: { equals: email, mode: "insensitive" } };
  const query = { where, select: { id: true } };
  const matches = await Promise.all([db.admin.findFirst(query), db.student.findFirst(query), db.faculty.findFirst(query), db.staff.findFirst(query)]);
  return matches.some(Boolean);
}

// Serializable transactions also keep verification attempts and one-time consumption atomic.
async function transaction(db, work) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await db.$transaction(work, { isolationLevel: "Serializable", timeout: 15000 }); }
    catch (error) { if (error.code !== "P2034" || attempt === 2) throw error; }
  }
}

export function createStaffAuthService(db = prisma, deliver = sendOtpEmail) {
  async function sendCode(adminId, details, requestId = null) {
    let name, email, passwordHash;
    if (!requestId) {
      name = normalizeName(details.name);
      email = normalizeEmail(details.email);
      if (!isValidName(name) || name.length > 120) throw failure("Please enter a valid staff name.");
      if (!isValidEmail(email) || email.length > 254) throw failure("Please enter a valid email address.");
      if (typeof details.password !== "string" || Buffer.byteLength(details.password) > 72 || !isStrongPassword(details.password)) throw failure("Password must include uppercase, lowercase, number and special character, with at least 8 characters and at most 72 bytes.");
      if (details.password !== details.confirmPassword) throw failure("Passwords do not match.");
      passwordHash = await bcrypt.hash(details.password, 10);
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const otpHash = await bcrypt.hash(code, 10);
    const request = await transaction(db, async (tx) => {
      const now = new Date();
      const previous = requestId
        ? await tx.staffCreationRequest.findUnique({ where: { id: requestId } })
        : await tx.staffCreationRequest.findUnique({ where: { email } });
      if (requestId && (!previous || previous.adminId !== adminId || previous.consumedAt)) throw failure("Creation request is no longer valid. Start again.");
      if (previous && !previous.consumedAt) {
        if (previous.adminId !== adminId && previous.expiresAt > now) throw failure("A verification request already exists for this email.", 409);
        const remaining = COOLDOWN_MS - (now - previous.lastSentAt);
        if (remaining > 0) throw failure("Please wait before resending the code.", 429, Math.ceil(remaining / 1000));
        if (previous.attempts >= MAX_ATTEMPTS && now - previous.lastSentAt < 10 * 60 * 1000) throw failure("Too many verification attempts. Try again after 10 minutes.", 429);
      }
      if (requestId) { name = previous.name; email = previous.email; passwordHash = previous.passwordHash; }
      if (await existingAccount(tx, email)) throw failure("Email is already associated with an existing account.", 409);
      const data = { adminId, name, email, passwordHash, otpHash, expiresAt: new Date(now.getTime() + EXPIRY_MS), lastSentAt: now, attempts: previous?.expiresAt > now ? previous.attempts : 0, consumedAt: null };
      return tx.staffCreationRequest.upsert({ where: { email }, create: data, update: data });
    });
    try { await deliver(request.email, code); }
    catch (error) {
      await db.staffCreationRequest.updateMany({ where: { id: request.id, otpHash }, data: { expiresAt: new Date(0) } });
      throw failure("Verification email could not be delivered. Please resend the code.", error.status || 503);
    }
    return { requestId: request.id, email: request.email, cooldown: COOLDOWN_MS / 1000 };
  }

  async function verify(adminId, requestId, code) {
    if (typeof requestId !== "string" || !requestId.trim()) throw failure("Creation request required. Start again.", 400, undefined, "STAFF_CHALLENGE_REQUIRED");
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw failure("Enter the 6-digit verification code.", 400, undefined, "STAFF_CODE_FORMAT_INVALID");
    const result = await transaction(db, async (tx) => {
      const request = await tx.staffCreationRequest.findUnique({ where: { id: requestId } });
      if (!request || request.adminId !== adminId) return { error: failure("Creation request is no longer valid. Start again.", 400, undefined, "STAFF_CHALLENGE_INVALID") };
      if (request.consumedAt) return { error: failure("Creation request is no longer valid. Start again.", 400, undefined, "STAFF_CHALLENGE_CONSUMED") };
      if (request.attempts >= MAX_ATTEMPTS) return { error: failure("Too many verification attempts. Request a new code later.", 429) };
      if (request.expiresAt <= new Date()) return { error: failure("Verification code expired. Please resend.", 410, undefined, "STAFF_CHALLENGE_EXPIRED") };
      if (!await bcrypt.compare(String(code), request.otpHash)) {
        await tx.staffCreationRequest.update({ where: { id: request.id }, data: { attempts: { increment: 1 } } });
        return { error: failure("Incorrect verification code.", 400, undefined, "STAFF_CODE_INVALID") };
      }
      if (await existingAccount(tx, request.email)) return { error: failure("Email is already associated with an existing account.", 409) };
      const staff = await tx.staff.create({ data: { name: request.name, email: request.email, passwordHash: request.passwordHash, verifiedAt: new Date(), createdByAdminId: adminId }, select: staffSelect });
      await tx.staffCreationRequest.update({ where: { id: request.id }, data: { consumedAt: new Date(), otpHash: "", passwordHash: "" } });
      return { staff };
    });
    if (result.error) throw result.error;
    return result.staff;
  }
  return { sendCode, verify };
}

export const staffAuthService = createStaffAuthService();
