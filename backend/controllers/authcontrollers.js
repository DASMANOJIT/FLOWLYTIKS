import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client.js";
import {
  addSession,
  clearUserSessions,
  getActiveSessionCount,
  removeSession,
} from "../utils/sessionStore.js";
import { formatIndianPhone } from "../utils/phone.js";
import { sendEmailOtp, verifyEmailOtp } from "../services/emailOtpService.js";

const MAX_DEVICES_PER_ACCOUNT = 2;

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

const isMissingColumnError = (err, columnName) => {
  const message = String(err?.message || "");
  return (
    /does not exist/i.test(message) &&
    (message.includes(`Student.${columnName}`) ||
      message.includes(`"${columnName}"`) ||
      message.includes(`\`${columnName}\``))
  );
};

const selectStudentAuthFields = {
  id: true,
  name: true,
  email: true,
  password: true,
  phone: true,
  isVerified: true,
  isTwoFactorEnabled: true,
};

const selectStudentAuthFieldsFallback = {
  id: true,
  name: true,
  email: true,
  password: true,
  phone: true,
};

const isStrongPassword = (password) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(
    String(password || "")
  );

const isValidPhone = (phone) =>
  /^\+?\d{10,15}$/.test(String(phone || "").trim());

const isValidEmail = (value) => {
  const normalized = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
};

const maskEmail = (email) => {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "";
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}***${local.slice(-1)}@${domain}`;
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

// =====================================================
// REGISTER (ADMIN / STUDENT)
// =====================================================
export const registerUser = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      password,
      school,
      class: studentClass,
      role,
    } = req.body;

    // =========================
    // ADMIN REGISTRATION
    // =========================
    if (role === "admin") {
      return res.status(403).json({
        message: "Admin self-registration is disabled. Contact system owner.",
      });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
      });
    }

    const normalizedPhone = formatIndianPhone(phone);
    if (!isValidPhone(normalizedPhone)) {
      return res.status(400).json({
        message: "Please enter a valid phone number.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // =========================
    // STUDENT REGISTRATION
    // =========================
    const exists = await prisma.student.findFirst({ where: { email } });
    if (exists) {
      return res.status(400).json({ message: "Student already exists" });
    }

    const existsPhone = await prisma.student.findFirst({
      where: { phone: normalizedPhone },
    });
    if (existsPhone) {
      return res.status(400).json({ message: "Phone number is already registered" });
    }

    // 🔥 FETCH GLOBAL MONTHLY FEE
    const settings = await prisma.appSettings.findUnique({
      where: { id: 1 },
    });

    if (!settings) {
      return res.status(500).json({ message: "App settings not found" });
    }

    const student = await prisma.student.create({
      data: {
        name,
        email,
        phone: normalizedPhone,
        password: hashedPassword,
        school,
        class: studentClass,
        monthlyFee: settings.monthlyFee, // ✅ CORRECT SOURCE
      },
    });

    const safeStudent = { ...student };
    delete safeStudent.password;
    res.json({ message: "Student registered", student: safeStudent });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// =====================================================
// LOGIN (ADMIN FIRST → STUDENT)
// =====================================================
// =====================================================
// LOGIN (ADMIN FIRST → STUDENT)
// =====================================================
export const loginUser = async (req, res) => {
  try {
    const { email, password, otp } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (email && !password && !otp) {
      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({ message: "Please provide a valid email." });
      }
      const result = await sendEmailOtp({ email: normalizedEmail, purpose: "login" });
      return res.status(200).json({
        success: true,
        message: "OTP sent successfully",
        maskedEmail: result.maskedEmail,
      });
    }

    if (email && otp) {
      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({ message: "Please provide a valid email." });
      }
      await verifyEmailOtp({ email: normalizedEmail, purpose: "login", code: otp });
      const student = await prisma.student.findFirst({
        where: { email: normalizedEmail },
        select: selectStudentAuthFields,
      });
      if (!student) {
        return res.status(404).json({ message: "User not found" });
      }
      const token = issueToken({ role: "student", id: student.id });
      return res.json({
        token,
        role: "student",
        name: student.name,
      });
    }

    if (email && password) {
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const admin = await prisma.admin.findUnique({ where: { email: normalizedEmail } });
      if (admin) {
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
          return res.status(400).json({ message: "Incorrect password" });
        }
        const token = issueToken({ role: "admin", id: admin.id });
        return res.json({
          token,
          role: "admin",
          name: admin.name,
        });
      }

      let student = null;
      try {
        student = await prisma.student.findFirst({
          where: { email: normalizedEmail },
          select: selectStudentAuthFields,
        });
      } catch (err) {
        if (
          isMissingColumnError(err, "isVerified") ||
          isMissingColumnError(err, "isTwoFactorEnabled")
        ) {
          console.warn("DB schema mismatch: student auth flags missing");
          student = await prisma.student.findFirst({
            where: { email: normalizedEmail },
            select: selectStudentAuthFieldsFallback,
          });
        } else {
          throw err;
        }
      }

      if (!student) {
        return res.status(404).json({ message: "User not found" });
      }

      const isMatch = await bcrypt.compare(password, student.password);
      if (!isMatch) {
        return res.status(400).json({ message: "Incorrect password" });
      }

      if (student.isTwoFactorEnabled && student.email) {
        await sendEmailOtp({ email: student.email, purpose: "2fa" });
        return res.json({
          requires2fa: true,
          role: "student",
          email: student.email,
        });
      }

      const token = issueToken({ role: "student", id: student.id });
      return res.json({
        token,
        role: "student",
        name: student.name,
      });
    }

    return res.status(400).json({ message: "Provide email (with OTP or password)." });
  } catch (err) {
    if (err?.status) {
      const payload = { message: err.message };
      if (err.retryAfter) {
        payload.retryAfter = err.retryAfter;
      }
      return res.status(err.status).json(payload);
    }
    if (isDbUnavailableError(err)) {
      console.error("LOGIN ERROR: Database unavailable");
      return res.status(503).json({
        success: false,
        message: "Database unavailable",
      });
    }
    console.error("LOGIN ERROR:", err?.message || err);
    return res.status(500).json({ message: "Login failed" });
  }
};

export const verifyTwoFactor = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ message: "Please provide a valid email." });
    }
    await verifyEmailOtp({ email: normalizedEmail, purpose: "2fa", code: otp });
    const student = await prisma.student.findFirst({
      where: { email: normalizedEmail },
      select: selectStudentAuthFields,
    });
    if (!student) {
      return res.status(404).json({ message: "User not found" });
    }
    const token = issueToken({ role: "student", id: student.id });
    return res.json({
      token,
      role: "student",
      name: student.name,
    });
  } catch (err) {
    if (err?.status) {
      const payload = { message: err.message };
      if (err.retryAfter) {
        payload.retryAfter = err.retryAfter;
      }
      return res.status(err.status).json(payload);
    }
    if (isDbUnavailableError(err)) {
      console.error("2FA ERROR: Database unavailable");
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }
    console.error("2FA ERROR:", err?.message || err);
    return res.status(500).json({ message: "2FA verification failed" });
  }
};


// =====================================================
// RESET PASSWORD (ADMIN / STUDENT)
// =====================================================
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
      });
    }

    if (email && otp) {
      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({ message: "Please enter a valid email address." });
      }
      await verifyEmailOtp({ email: normalizedEmail, purpose: "reset", code: otp });
      const student = await prisma.student.findFirst({
        where: { email: normalizedEmail },
        select: selectStudentAuthFieldsFallback,
      });
      if (!student) {
        return res.status(404).json({ message: "User not found" });
      }
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      try {
        await prisma.student.update({
          where: { id: student.id },
          data: { password: hashedPassword, isVerified: true },
        });
      } catch (err) {
        if (!isMissingColumnError(err, "isVerified")) throw err;
        await prisma.student.update({
          where: { id: student.id },
          data: { password: hashedPassword },
        });
      }
      clearUserSessions("student", student.id);
      return res.json({ message: "Student password reset successful" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const admin = await prisma.admin.findUnique({ where: { email: normalizedEmail } });
    if (admin) {
      await prisma.admin.update({
        where: { email: normalizedEmail },
        data: { password: hashedPassword },
      });
      clearUserSessions("admin", admin.id);
      return res.json({ message: "Admin password reset successful" });
    }

    const student = await prisma.student.findFirst({ where: { email: normalizedEmail } });
    if (!student) {
      return res.status(404).json({ message: "User not found" });
    }

    await prisma.student.update({
      where: { id: student.id },
      data: { password: hashedPassword },
    });
    clearUserSessions("student", student.id);
    return res.json({ message: "Student password reset successful" });
  } catch (err) {
    if (isDbUnavailableError(err)) {
      console.error("RESET PASSWORD ERROR: Database unavailable");
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }
    console.error("RESET PASSWORD ERROR:", err?.message || err);
    return res.status(500).json({ message: err?.message || "Reset password failed" });
  }
};

// =====================================================
// LOGOUT (ADMIN / STUDENT)
// =====================================================
export const logoutUser = async (req, res) => {
  try {
    if (!req.user || !req.userRole || !req.token) {
      return res.status(400).json({ message: "Invalid logout request" });
    }

    removeSession(req.userRole, req.user.id, req.token);
    return res.json({ message: "Logged out successfully" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
