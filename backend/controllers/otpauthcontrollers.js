import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client.js";
import {
  addSession,
  getActiveSessionCount,
} from "../utils/sessionStore.js";
import { sendEmailOtp, verifyEmailOtp } from "../services/emailOtpService.js";

const MAX_DEVICES_PER_ACCOUNT = 2;
const validPurposes = new Set(["signup", "login", "reset", "2fa"]);

const isStrongPassword = (password) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(String(password || ""));

const isValidPhone = (phone) =>
  /^\+?\d{10,15}$/.test(String(phone || "").trim());

const isValidEmail = (value) => {
  const normalized = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
};

const getSignupValidationError = ({
  name,
  school,
  customSchool,
  studentClass,
  phone,
  email,
  password,
}) => {
  const normalizedName = String(name || "").trim();
  const normalizedSchool = String(school || "").trim();
  const normalizedCustomSchool = String(customSchool || "").trim();
  const normalizedClass = String(studentClass || "").trim();
  const normalizedPhone = String(phone || "").trim();

  if (!normalizedName) return "Full name is required.";
  if (!normalizedSchool) return "School is required.";
  if (normalizedSchool === "other" && !normalizedCustomSchool) {
    return "Please enter your school name.";
  }
  if (!normalizedClass) return "Class is required.";

  const classNum = parseInt(normalizedClass, 10);
  if (!Number.isInteger(classNum) || classNum < 3 || classNum > 12) {
    return "Please select a valid class (3 to 12).";
  }

  if (!normalizedPhone) return "Phone number is required.";
  if (!isValidPhone(normalizedPhone)) return "Please enter a valid phone number.";
  if (!isValidEmail(email)) return "Please provide a valid email address.";
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

const issueToken = ({ role, id }) => {
  const currentActive = getActiveSessionCount(role, id);
  if (currentActive >= MAX_DEVICES_PER_ACCOUNT) {
    const err = new Error(
      "Login limit reached (2 devices). Logout from another device first."
    );
    err.status = 403;
    throw err;
  }
  const token = jwt.sign({ id, role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
  const decoded = jwt.decode(token);
  const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 86400000;
  addSession(role, id, token, expMs);
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
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPurpose = String(purpose || "login").toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Please provide a valid email address." });
    }
    if (!validPurposes.has(normalizedPurpose)) {
      return res.status(400).json({ message: "Invalid OTP purpose." });
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
        return res.status(400).json({ message: validationError });
      }

      const existing = await prisma.student.findFirst({ where: { email: normalizedEmail } });
      if (existing) {
        return res.status(400).json({ message: "Email is already registered." });
      }

      const normalizedPhone = String(phone || "").trim();
      const existingPhone = await prisma.student.findFirst({
        where: { phone: normalizedPhone },
      });
      if (existingPhone) {
        return res.status(400).json({ message: "Phone number is already registered." });
      }
    } else {
      const student = await prisma.student.findFirst({ where: { email: normalizedEmail } });
      if (!student) {
        return res.status(404).json({ message: "User not found." });
      }
    }

    const result = await sendEmailOtp({ email: normalizedEmail, purpose: normalizedPurpose });
    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      maskedEmail: result.maskedEmail,
    });
  } catch (err) {
    if (err?.status) {
      const payload = { message: err.message };
      if (err.retryAfter) payload.retryAfter = err.retryAfter;
      return res.status(err.status).json(payload);
    }
    if (isDbUnavailableError(err)) {
      console.error("SEND OTP ERROR: Database unavailable");
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }
    console.error("SEND OTP ERROR:", err?.message || err);
    return res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { email, otp, purpose } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPurpose = String(purpose || "login").toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Please provide a valid email address." });
    }
    await verifyEmailOtp({ email: normalizedEmail, purpose: normalizedPurpose, code: otp });
    return res.json({ success: true });
  } catch (err) {
    if (err?.status) {
      const payload = { success: false, message: err.message };
      if (err.retryAfter) payload.retryAfter = err.retryAfter;
      return res.status(err.status).json(payload);
    }
    console.error("VERIFY OTP ERROR:", err?.message || err);
    return res.status(500).json({ success: false, message: "OTP verification failed" });
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
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedName = String(name || "").trim();
    const normalizedPhone = String(phone || "").trim();
    const code = String(otp || "").trim();
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
      return res.status(400).json({ message: validationError });
    }

    const finalSchool =
      String(school || "").trim() === "other"
        ? String(customSchool || "").trim()
        : String(school || "").trim();

    const classNum = parseInt(String(studentClass || "").trim(), 10);
    const existsEmail = await prisma.student.findFirst({ where: { email: normalizedEmail } });
    if (existsEmail) {
      return res.status(400).json({ message: "Email is already registered." });
    }

    const existsPhone = await prisma.student.findFirst({ where: { phone: normalizedPhone } });
    if (existsPhone) {
      return res.status(400).json({ message: "Phone number is already registered." });
    }

    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: "Please enter the 6-digit OTP." });
    }

    await verifyEmailOtp({ email: normalizedEmail, purpose: "signup", code });

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      return res.status(500).json({ message: "App settings not found" });
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

    const token = issueToken({ role: "student", id: student.id });
    return res.json({
      token,
      role: "student",
      name: student.name,
      ...(debug ? { maskedEmail: maskEmail(normalizedEmail) } : {}),
    });
  } catch (err) {
    if (isDbUnavailableError(err)) {
      console.error("SIGNUP OTP ERROR: Database unavailable");
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }
    console.error("SIGNUP OTP ERROR:", err?.message || err);
    return res.status(500).json({ message: err?.message || "Signup failed" });
  }
};
