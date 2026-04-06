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

export const sendEmailOtp = async ({ email, purpose = "login" }) => {
  const trimmed = normalizeEmail(email);
  if (!isValidEmail(trimmed)) {
    const err = new Error("Invalid email address.");
    err.status = 400;
    throw err;
  }

  const now = new Date();
  const existing = await prisma.emailOtp.findUnique({
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

  try {
    await sendOtpEmail(trimmed, otp);
  } catch (err) {
    await prisma.emailOtp
      .delete({
        where: {
          EmailOtp_email_purpose_key: {
            email: trimmed,
            purpose,
          },
        },
      })
      .catch(() => {});
    throw err;
  }

  if (process.env.NODE_ENV !== "production" || process.env.DEBUG_AUTH === "1") {
    console.log("OTP sent for", maskEmail(trimmed), "purpose:", purpose);
  }
  return { maskedEmail: maskEmail(trimmed) };
};

export const verifyEmailOtp = async ({ email, purpose = "login", code }) => {
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
    const err = new Error(
      "Too many OTP verification attempts for this email. Please try again after 10 minutes."
    );
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

  const valid = await bcrypt.compare(normalizeOtp(code), record.otpHash);
  if (!valid) {
    const attempts = record.attempts + 1;
    const data = { attempts };
    let status = 400;
    let message = "Invalid OTP";
    if (attempts >= MAX_ATTEMPTS) {
      data.lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
      status = 429;
      message =
        "Too many OTP verification attempts for this email. Please try again after 10 minutes.";
    }
    await prisma.emailOtp.update({
      where: { id: record.id },
      data,
    });
    const err = new Error(message);
    err.status = status;
    if (status === 429) {
      err.retryAfter = Math.ceil(LOCK_DURATION_MS / 1000);
    }
    throw err;
  }

  await prisma.emailOtp.delete({
    where: { id: record.id },
  });
  if (process.env.NODE_ENV !== "production" || process.env.DEBUG_AUTH === "1") {
    console.log("OTP verified for", maskEmail(trimmed), "purpose:", purpose);
  }
  return { success: true };
};

export const purgeExpiredEmailOtps = async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await prisma.emailOtp.deleteMany({
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
