import bcrypt from "bcryptjs";
import crypto from "crypto";
import prisma from "../prisma/client.js";
import { sendOtpEmail } from "./emailService.js";
import { isValidEmail, isValidOtp, normalizeEmail, normalizeOtp } from "../utils/authValidation.js";

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const LOCK_DURATION_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 15 * 1000;

const maskEmail = (email) => {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  return `${local[0]}***@${domain}`;
};

const generateOtp = () => {
  const num = crypto.randomInt(0, 1_000_000);
  return String(num).padStart(6, "0");
};

export const sendEmailOtp = async ({ email, purpose = "login", db = prisma, deliver = sendOtpEmail, preserveAttempts = false, quiet = false }) => {
  const trimmed = normalizeEmail(email);
  if (!isValidEmail(trimmed)) {
    const err = new Error("Invalid email address.");
    err.status = 400;
    throw err;
  }

  const now = new Date();
  const existing = await db.emailOtp.findUnique({
    where: {
      EmailOtp_email_purpose_key: {
        email: trimmed,
        purpose,
      },
    },
  });

  if (existing?.updatedAt) {
    const elapsedMs = now.getTime() - existing.updatedAt.getTime();
    if (elapsedMs < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000);
      const err = new Error("Please wait 15 seconds before resending OTP.");
      err.status = 429;
      err.retryAfter = retryAfter;
      throw err;
    }
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

  await db.emailOtp.upsert({
    where: {
      EmailOtp_email_purpose_key: {
        email: trimmed,
        purpose,
      },
    },
    update: {
      otpHash,
      expiresAt,
      attempts: preserveAttempts && existing?.expiresAt > now ? existing.attempts : 0,
      lockedUntil: null,
    },
    create: {
      email: trimmed,
      purpose,
      otpHash,
      expiresAt,
      attempts: 0,
      lockedUntil: null,
    },
  });

  try {
    await deliver(trimmed, otp);
  } catch (err) {
    await db.emailOtp
      .deleteMany({
        where: {
          email: trimmed, purpose, otpHash,
        },
      })
      .catch(() => {});
    throw err;
  }

  if (!quiet && (process.env.NODE_ENV !== "production" || process.env.DEBUG_AUTH === "1")) {
    console.log("OTP sent for", maskEmail(trimmed), "purpose:", purpose);
  }
  return { maskedEmail: maskEmail(trimmed) };
};

export const verifyEmailOtp = async ({ email, purpose = "login", code, db = prisma, quiet = false }) => {
  const trimmed = normalizeEmail(email);
  if (!isValidEmail(trimmed)) {
    const err = new Error("Invalid email address.");
    err.status = 400;
    throw err;
  }

  if (!isValidOtp(code)) {
    const err = new Error("Invalid OTP.");
    err.status = 400;
    throw err;
  }

  const record = await db.emailOtp.findUnique({
    where: {
      EmailOtp_email_purpose_key: {
        email: trimmed,
        purpose,
      },
    },
  });

  const now = new Date();
  if (!record) {
    const err = new Error("Invalid OTP.");
    err.status = 400;
    throw err;
  }

  if (record.lockedUntil && record.lockedUntil > now) {
    const wait = Math.ceil((record.lockedUntil - now) / 1000);
    const err = new Error(
      "Too many OTP verification attempts for this email. Please try again after 10 minutes."
    );
    err.status = 429;
    err.retryAfter = wait;
    throw err;
  }

  if (record.expiresAt <= now) {
    await db.emailOtp.deleteMany({
      where: { id: record.id, otpHash: record.otpHash },
    });
    const err = new Error("OTP expired");
    err.status = 410;
    throw err;
  }

  const valid = await bcrypt.compare(normalizeOtp(code), record.otpHash);
  if (!valid) {
    const changed = await db.emailOtp.updateMany({
      where: { id: record.id, otpHash: record.otpHash, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    const current = await db.emailOtp.findUnique({ where: { id: record.id } });
    let status = 400;
    let message = "Invalid OTP";
    if (current?.otpHash === record.otpHash && current.attempts >= MAX_ATTEMPTS) {
      await db.emailOtp.updateMany({
        where: { id: record.id, otpHash: record.otpHash, attempts: { gte: MAX_ATTEMPTS }, lockedUntil: null },
        data: { lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS) },
      });
      status = 429;
      message =
        "Too many OTP verification attempts for this email. Please try again after 10 minutes.";
    }
    const err = new Error(changed.count || status === 429 ? message : "Invalid OTP.");
    err.status = status;
    if (status === 429) {
      err.retryAfter = Math.ceil(LOCK_DURATION_MS / 1000);
    }
    throw err;
  }

  const consumed = await db.emailOtp.deleteMany({
    where: { id: record.id, otpHash: record.otpHash, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }] },
  });
  if (!consumed.count) throw Object.assign(new Error("Invalid OTP or verification request already consumed."), { status: 400 });
  if (!quiet && (process.env.NODE_ENV !== "production" || process.env.DEBUG_AUTH === "1")) {
    console.log("OTP verified for", maskEmail(trimmed), "purpose:", purpose);
  }
  return { success: true };
};

export const purgeExpiredEmailOtps = async (db = prisma) => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.emailOtp.deleteMany({
    where: {
      OR: [
        {
          expiresAt: {
            lt: new Date(),
          },
        },
        {
          updatedAt: {
            lt: cutoff,
          },
        },
      ],
    },
  });
};
