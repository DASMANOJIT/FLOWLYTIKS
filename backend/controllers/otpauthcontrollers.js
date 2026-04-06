import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client.js";
import {
  addSession,
  getActiveSessionCount,
} from "../utils/sessionStore.js";
import { sendEmailOtp, verifyEmailOtp } from "../services/emailOtpService.js";
import {
  getPhoneSearchCandidates,
  isStrongPassword,
  isValidEmail,
  isValidName,
  isValidOtp,
  isValidPhone,
  isValidSchoolText,
  isValidStudentClass,
  normalizeEmail,
  normalizeName,
  normalizeOtp,
  normalizePhone,
  parseStudentClass,
  resolveSchoolValue,
} from "../utils/authValidation.js";

const MAX_DEVICES_PER_ACCOUNT = 2;
const validPurposes = new Set(["signup", "login", "reset", "2fa"]);

const authError = (res, status, error, extra = {}) =>
  res.status(status).json({
    success: false,
    error,
    message: error,
    ...extra,
  });

const authSuccess = (res, payload = {}, status = 200) =>
  res.status(status).json({
    success: true,
    ...payload,
  });

const getSignupValidationError = ({
  name,
  school,
  customSchool,
  studentClass,
  phone,
  email,
  password,
}) => {
  const normalizedName = normalizeName(name);
  const normalizedSchool = resolveSchoolValue({ school, customSchool });
  const classNum = parseStudentClass(studentClass);
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);

  if (!isValidName(normalizedName)) return "Full name is required.";
  if (!isValidSchoolText(normalizedSchool)) return "School is required.";
  if (!isValidStudentClass(classNum)) {
    return "Please select a valid class (3 to 12).";
  }
  if (!isValidPhone(normalizedPhone)) return "Please enter a valid phone number.";
  if (!isValidEmail(normalizedEmail)) return "Please provide a valid email address.";
  if (!String(password || "").trim()) return "Password is required.";
  if (!isStrongPassword(password)) {
    return "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";
  }

  return null;
};

const maskEmail = (email) => {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local.slice(-1)}@${domain}`;
};

const isDbUnavailableError = (err) => {
  const message = String(err?.message || "");
  return (
    err?.name === "PrismaClientInitializationError" ||
    /Can't reach database server/i.test(message) ||
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Connection terminated|Connection timed out/i.test(
      message
    )
  );
};

const issueToken = async ({ role, id }) => {
  const currentActive = await getActiveSessionCount(role, id);
  if (currentActive >= MAX_DEVICES_PER_ACCOUNT) {
    const err = new Error(
      "Login limit reached (2 devices). Logout from another device first."
    );
    err.status = 403;
    throw err;
  }
  const tokenId = crypto.randomUUID();
  const token = jwt.sign({ id, role }, process.env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "7d",
    jwtid: tokenId,
  });
  const decoded = jwt.decode(token);
  const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 86400000;
  await addSession(role, id, tokenId, expMs);
  return token;
};

export const sendOtp = async (req, res) => {
  try {
    const {
      email,
      purpose,
      name,
      phone,
      password,
      school,
      customSchool,
      class: studentClass,
    } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedPurpose = String(purpose || "login").toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      return authError(res, 400, "Please provide a valid email address.");
    }
    if (!validPurposes.has(normalizedPurpose)) {
      return authError(res, 400, "Invalid OTP purpose.");
    }

    if (normalizedPurpose === "signup") {
      const validationError = getSignupValidationError({
        name,
        school,
        customSchool,
        studentClass,
        phone,
        email: normalizedEmail,
        password,
      });
      if (validationError) {
        return authError(res, 400, validationError);
      }

      const existing = await prisma.student.findUnique({ where: { email: normalizedEmail } });
      if (existing) {
        return authError(res, 400, "Email is already registered.");
      }

      const phoneCandidates = getPhoneSearchCandidates(phone);
      const existingPhone = await prisma.student.findFirst({
        where: {
          OR: phoneCandidates.map((value) => ({ phone: value })),
        },
      });
      if (existingPhone) {
        return authError(res, 400, "Phone number is already registered.");
      }
    } else {
      const student = await prisma.student.findUnique({ where: { email: normalizedEmail } });
      if (!student) {
        return authError(res, 404, "User not found.");
      }
    }

    const result = await sendEmailOtp({ email: normalizedEmail, purpose: normalizedPurpose });
    return authSuccess(res, {
      message: "OTP sent successfully",
      maskedEmail: result.maskedEmail,
    });
  } catch (err) {
    if (err?.status) {
      return authError(res, err.status, err.message, err.retryAfter ? { retryAfter: err.retryAfter } : {});
    }
    if (isDbUnavailableError(err)) {
      console.error("SEND OTP ERROR: Database unavailable");
      return authError(res, 503, "Database unavailable");
    }
    console.error("SEND OTP ERROR:", err?.message || err);
    return authError(res, 500, "Failed to send OTP");
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { email, otp, purpose } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedPurpose = String(purpose || "login").toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      return authError(res, 400, "Please provide a valid email address.");
    }
    if (!isValidOtp(otp)) {
      return authError(res, 400, "Please enter the 6-digit OTP.");
    }
    await verifyEmailOtp({
      email: normalizedEmail,
      purpose: normalizedPurpose,
      code: normalizeOtp(otp),
    });
    return authSuccess(res);
  } catch (err) {
    if (err?.status) {
      return authError(res, err.status, err.message, err.retryAfter ? { retryAfter: err.retryAfter } : {});
    }
    console.error("VERIFY OTP ERROR:", err?.message || err);
    return authError(res, 500, "OTP verification failed");
  }
};

export const signupWithOtp = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      school,
      customSchool,
      class: studentClass,
      otp,
    } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = normalizeName(name);
    const normalizedPhone = normalizePhone(phone);
    const code = normalizeOtp(otp);
    const debug = process.env.NODE_ENV !== "production" || process.env.DEBUG_SIGNUP === "1";

    const validationError = getSignupValidationError({
      name: normalizedName,
      school,
      customSchool,
      studentClass,
      phone: normalizedPhone,
      email: normalizedEmail,
      password,
    });
    if (validationError) {
      return authError(res, 400, validationError);
    }

    const finalSchool = resolveSchoolValue({ school, customSchool });

    const classNum = parseStudentClass(studentClass);
    const existsEmail = await prisma.student.findUnique({ where: { email: normalizedEmail } });
    if (existsEmail) {
      return authError(res, 400, "Email is already registered.");
    }

    const phoneCandidates = getPhoneSearchCandidates(phone);
    const existsPhone = await prisma.student.findFirst({
      where: {
        OR: phoneCandidates.map((value) => ({ phone: value })),
      },
    });
    if (existsPhone) {
      return authError(res, 400, "Phone number is already registered.");
    }

    if (!isValidOtp(code)) {
      return authError(res, 400, "Please enter the 6-digit OTP.");
    }

    await verifyEmailOtp({ email: normalizedEmail, purpose: "signup", code });

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      return authError(res, 500, "App settings not found");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const student = await prisma.student.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        password: hashedPassword,
        school: finalSchool,
        class: String(classNum),
        monthlyFee: settings.monthlyFee,
        isVerified: true,
      },
    });

    const token = await issueToken({ role: "student", id: student.id });
    return authSuccess(res, {
      token,
      role: "student",
      name: student.name,
      ...(debug ? { maskedEmail: maskEmail(normalizedEmail) } : {}),
    });
  } catch (err) {
    if (isDbUnavailableError(err)) {
      console.error("SIGNUP OTP ERROR: Database unavailable");
      return authError(res, 503, "Database unavailable");
    }
    if (err?.status) {
      return authError(res, err.status, err.message, err.retryAfter ? { retryAfter: err.retryAfter } : {});
    }
    console.error("SIGNUP OTP ERROR:", err?.message || err);
    return authError(res, 500, "Signup failed");
  }
};
