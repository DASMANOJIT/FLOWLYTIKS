import bcrypt from "bcryptjs";
import crypto from "crypto";
import prisma from "../prisma/client.js";
import { sendOtpEmail } from "./emailService.js";

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const LOCK_DURATION_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

const rateLimitMap = new Map();

const maskEmail = (email) => {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  return `${local[0]}***@${domain}`;
};

const enforceCooldown = (email, purpose) => {
  const key = `${email}:${purpose}:cooldown`;
  const now = Date.now();
  const last = rateLimitMap.get(key) || 0;
  if (now - last < RESEND_COOLDOWN_MS) {
    const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (now - last)) / 1000);
    const err = new Error("Please wait before requesting another OTP.");
    err.status = 429;
    err.retryAfter = retryAfter;
    throw err;
  }
  rateLimitMap.set(key, now);
};

const generateOtp = () => {
  const num = crypto.randomInt(0, 1_000_000);
  return String(num).padStart(6, "0");
};

export const sendEmailOtp = async ({ email, purpose = "login" }) => {
  const trimmed = String(email || "").trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) {
    const err = new Error("Invalid email address.");
    err.status = 400;
    throw err;
  }

  enforceCooldown(trimmed, purpose);
  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

  await prisma.emailOtp.upsert({
    where: {
      EmailOtp_email_purpose_key: {
        email: trimmed,
        purpose,
      },
    },
    update: {
      otpHash,
      expiresAt,
      attempts: 0,
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

  await sendOtpEmail(trimmed, otp);
  console.log("OTP sent for", maskEmail(trimmed), "purpose:", purpose);
  return { maskedEmail: maskEmail(trimmed) };
};

export const verifyEmailOtp = async ({ email, purpose = "login", code }) => {
  const trimmed = String(email || "").trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) {
    const err = new Error("Invalid email address.");
    err.status = 400;
    throw err;
  }

  const record = await prisma.emailOtp.findUnique({
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
    const err = new Error(`Too many attempts. Try again after ${wait} seconds.`);
    err.status = 429;
    err.retryAfter = wait;
    throw err;
  }

  if (record.expiresAt < now) {
    await prisma.emailOtp.delete({
      where: { id: record.id },
    });
    const err = new Error("OTP expired");
    err.status = 410;
    throw err;
  }

  const valid = await bcrypt.compare(String(code || "").trim(), record.otpHash);
  if (!valid) {
    const attempts = record.attempts + 1;
    const data = { attempts };
    if (attempts >= MAX_ATTEMPTS) {
      data.lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
    }
    await prisma.emailOtp.update({
      where: { id: record.id },
      data,
    });
    const err = new Error(attempts >= MAX_ATTEMPTS ? "Too many attempts" : "Invalid OTP");
    err.status = 400;
    throw err;
  }

  await prisma.emailOtp.delete({
    where: { id: record.id },
  });
  console.log("OTP verified for", maskEmail(trimmed), "purpose:", purpose);
  return { success: true };
};
