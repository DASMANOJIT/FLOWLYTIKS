import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client.js";
import { logInfo, logWarn } from "../utils/appLogger.js";
import {
  isWhatsAppConfigured,
  sendWhatsAppTextMessage,
} from "../services/whatsappservice.js";

const OTP_EXPIRY_MS = 5 * 60 * 1000;
const RESEND_COOLDOWN_MS = 15 * 1000;
const MAX_ATTEMPTS = 5;

const normalizePhone = (value) => String(value || "").replace(/\D/g, "");

const authResponse = (res, status, payload) =>
  res.status(status).json({
    success: status < 400,
    ...payload,
  });

const issueFacultyToken = (faculty) =>
  jwt.sign({ id: faculty.id, role: "faculty" }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    algorithm: "HS256",
  });

const generateOtp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

const maskPhone = (phone) => {
  const value = normalizePhone(phone);
  if (value.length <= 4) return value || "";
  return `${"*".repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
};

export const loginFaculty = async (req, res) => {
  try {
    const phone = req.body.phone ? normalizePhone(req.body.phone) : null;
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
    let faculty = null;
    if (phone) {
      faculty = await prisma.faculty.findUnique({
        where: { phone },
        select: { id: true, facultyId: true, username: true, fullName: true, phone: true, email: true, status: true, passwordHash: true },
      });
    } else if (email) {
      faculty = await prisma.faculty.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, facultyId: true, username: true, fullName: true, phone: true, email: true, status: true, passwordHash: true },
      });
    }

    const isMatch = faculty
      ? await bcrypt.compare(req.body.password, faculty.passwordHash)
      : false;
    if (!faculty || !isMatch) {
      logWarn("faculty.login_failed", { phone: maskPhone(phone) });
      return authResponse(res, 401, { message: "Invalid email/phone or password." });
    }
    if (faculty.status !== "ACTIVE") {
      return authResponse(res, 403, { message: "Faculty account is inactive." });
    }

    const token = issueFacultyToken(faculty);
    logInfo("faculty.login_success", { facultyId: faculty.id });
    return authResponse(res, 200, {
      token,
      role: "faculty",
      name: faculty.fullName,
      faculty: {
        id: faculty.id,
        facultyId: faculty.facultyId,
        fullName: faculty.fullName,
        email: faculty.email || null,
        phone: faculty.phone || null,
      },
    });
  } catch (error) {
    console.error("Faculty login error:", error?.message || error);
    return authResponse(res, 500, { message: "Faculty login failed. Please try again." });
  }
};

export const sendFacultyPasswordOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const faculty = await prisma.faculty.findUnique({
      where: { phone },
      select: { id: true, phone: true },
    });
    if (!faculty) {
      return authResponse(res, 404, { message: "No faculty account found for this phone number." });
    }

    const existing = await prisma.facultyPasswordOtp.findUnique({
      where: {
        FacultyPasswordOtp_phone_purpose_key: {
          phone,
          purpose: "reset",
        },
      },
    });
    if (existing?.updatedAt) {
      const elapsedMs = Date.now() - existing.updatedAt.getTime();
      if (elapsedMs < RESEND_COOLDOWN_MS) {
        return authResponse(res, 429, {
          message: "Please wait 15 seconds before resending OTP.",
          retryAfter: Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000),
        });
      }
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    await prisma.facultyPasswordOtp.upsert({
      where: {
        FacultyPasswordOtp_phone_purpose_key: {
          phone,
          purpose: "reset",
        },
      },
      update: {
        otpHash,
        resetToken: null,
        attempts: 0,
        lockedUntil: null,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      },
      create: {
        phone,
        purpose: "reset",
        otpHash,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      },
    });

    if (isWhatsAppConfigured()) {
      await sendWhatsAppTextMessage({
        to: phone,
        message: `Your Flowlytiks faculty password reset OTP is ${otp}. It expires in 5 minutes.`,
      });
    }
    return authResponse(res, 200, {
      message: "OTP sent to the registered phone number.",
      maskedPhone: maskPhone(phone),
    });
  } catch (error) {
    console.error("Faculty OTP send error:", error?.message || error);
    return authResponse(res, 500, { message: "Failed to send OTP. Please try again." });
  }
};

export const verifyFacultyPasswordOtp = async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const record = await prisma.facultyPasswordOtp.findUnique({
      where: {
        FacultyPasswordOtp_phone_purpose_key: {
          phone,
          purpose: "reset",
        },
      },
    });
    if (!record || record.expiresAt <= new Date()) {
      return authResponse(res, 400, { message: "OTP expired. Please request a new OTP." });
    }
    if (record.lockedUntil && record.lockedUntil > new Date()) {
      return authResponse(res, 429, { message: "Too many OTP attempts. Please try later." });
    }

    const valid = await bcrypt.compare(req.body.otp, record.otpHash);
    if (!valid) {
      const attempts = record.attempts + 1;
      await prisma.facultyPasswordOtp.update({
        where: { id: record.id },
        data: {
          attempts,
          lockedUntil: attempts >= MAX_ATTEMPTS ? new Date(Date.now() + 10 * 60 * 1000) : null,
        },
      });
      return authResponse(res, 400, { message: "Invalid OTP." });
    }

    const resetToken = crypto.randomBytes(24).toString("hex");
    await prisma.facultyPasswordOtp.update({
      where: { id: record.id },
      data: {
        resetToken,
        attempts: 0,
        expiresAt: new Date(Date.now() + OTP_EXPIRY_MS),
      },
    });
    return authResponse(res, 200, { resetToken, message: "OTP verified." });
  } catch (error) {
    console.error("Faculty OTP verify error:", error?.message || error);
    return authResponse(res, 500, { message: "Failed to verify OTP. Please try again." });
  }
};

export const resetFacultyPassword = async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const record = await prisma.facultyPasswordOtp.findUnique({
      where: {
        FacultyPasswordOtp_phone_purpose_key: {
          phone,
          purpose: "reset",
        },
      },
    });
    if (!record || record.expiresAt <= new Date() || record.resetToken !== req.body.resetToken) {
      return authResponse(res, 400, { message: "Password reset session expired. Please verify OTP again." });
    }

    const passwordHash = await bcrypt.hash(req.body.password, 10);
    await prisma.$transaction([
      prisma.faculty.update({
        where: { phone },
        data: { passwordHash },
      }),
      prisma.facultyPasswordOtp.delete({ where: { id: record.id } }),
    ]);
    return authResponse(res, 200, { message: "Password reset successfully." });
  } catch (error) {
    console.error("Faculty password reset error:", error?.message || error);
    return authResponse(res, 500, { message: "Failed to reset password. Please try again." });
  }
};
