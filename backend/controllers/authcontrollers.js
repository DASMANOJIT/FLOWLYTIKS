import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client.js";
import {
  addSession,
  clearUserSessions,
  getActiveSessionCount,
  removeSession,
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
const INVALID_CREDENTIALS_MESSAGE = "Invalid credentials.";

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

const getStudentRegistrationValidationError = ({
  name,
  school,
  studentClass,
  phone,
  email,
  password,
}) => {
  if (!isValidName(name)) return "Full name is required.";
  if (!isValidSchoolText(school)) return "School is required.";
  if (!isValidStudentClass(studentClass)) {
    return "Please select a valid class (3 to 12).";
  }
  if (!isValidPhone(phone)) return "Please enter a valid phone number.";
  if (!isValidEmail(email)) return "Please enter a valid email address.";
  if (!isStrongPassword(password)) {
    return "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";
  }
  return null;
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
    algorithm: "HS256",
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
      return authError(res, 403, "Admin self-registration is disabled. Contact system owner.");
    }

    const normalizedName = normalizeName(name);
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);
    const normalizedSchool = resolveSchoolValue({ school });
    const classNum = parseStudentClass(studentClass);
    const validationError = getStudentRegistrationValidationError({
      name: normalizedName,
      school: normalizedSchool,
      studentClass: classNum,
      phone: normalizedPhone,
      email: normalizedEmail,
      password,
    });
    if (validationError) {
      return authError(res, 400, validationError);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // =========================
    // STUDENT REGISTRATION
    // =========================
    const exists = await prisma.student.findFirst({ where: { email: normalizedEmail } });
    if (exists) {
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

    // 🔥 FETCH GLOBAL MONTHLY FEE
    const settings = await prisma.appSettings.findUnique({
      where: { id: 1 },
    });

    if (!settings) {
      return authError(res, 500, "App settings not found");
    }

    const student = await prisma.student.create({
      data: {
        name: normalizedName,
        email: normalizedEmail,
        phone: normalizedPhone,
        password: hashedPassword,
        school: normalizedSchool,
        class: String(classNum),
        monthlyFee: settings.monthlyFee, // ✅ CORRECT SOURCE
      },
    });

    const safeStudent = { ...student };
    delete safeStudent.password;
    return authSuccess(res, { message: "Student registered", student: safeStudent });

  } catch (err) {
    console.error("REGISTER ERROR:", err?.message || err);
    return authError(res, 500, "Registration failed");
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
    const normalizedEmail = normalizeEmail(email);

    if (email && !password && !otp) {
      if (!isValidEmail(normalizedEmail)) {
        return authError(res, 400, "Please provide a valid email.");
      }
      const result = await sendEmailOtp({ email: normalizedEmail, purpose: "login" });
      return authSuccess(res, {
        message: "OTP sent successfully",
        maskedEmail: result.maskedEmail,
      });
    }

    if (email && otp) {
      if (!isValidEmail(normalizedEmail)) {
        return authError(res, 400, "Please provide a valid email.");
      }
      if (!isValidOtp(otp)) {
        return authError(res, 400, "Please enter the 6-digit OTP.");
      }
      await verifyEmailOtp({ email: normalizedEmail, purpose: "login", code: normalizeOtp(otp) });
      const student = await prisma.student.findFirst({
        where: { email: normalizedEmail },
        select: selectStudentAuthFields,
      });
      if (!student) {
        return authError(res, 401, INVALID_CREDENTIALS_MESSAGE);
      }
      const token = issueToken({ role: "student", id: student.id });
      return authSuccess(res, {
        token,
        role: "student",
        name: student.name,
      });
    }

    if (email && password) {
      const admin = await prisma.admin.findUnique({ where: { email: normalizedEmail } });
      if (admin) {
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
          return authError(res, 401, INVALID_CREDENTIALS_MESSAGE);
        }
        const token = issueToken({ role: "admin", id: admin.id });
        return authSuccess(res, {
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
        return authError(res, 401, INVALID_CREDENTIALS_MESSAGE);
      }

      const isMatch = await bcrypt.compare(password, student.password);
      if (!isMatch) {
        return authError(res, 401, INVALID_CREDENTIALS_MESSAGE);
      }

      if (student.isTwoFactorEnabled && student.email) {
        await sendEmailOtp({ email: student.email, purpose: "2fa" });
        return authSuccess(res, {
          requires2fa: true,
          role: "student",
          email: student.email,
        });
      }

      const token = issueToken({ role: "student", id: student.id });
      return authSuccess(res, {
        token,
        role: "student",
        name: student.name,
      });
    }

    return authError(res, 400, "Provide email (with OTP or password).");
  } catch (err) {
    if (err?.status) {
      return authError(res, err.status, err.message, err.retryAfter ? { retryAfter: err.retryAfter } : {});
    }
    if (isDbUnavailableError(err)) {
      console.error("LOGIN ERROR: Database unavailable");
      return authError(res, 503, "Database unavailable");
    }
    console.error("LOGIN ERROR:", err?.message || err);
    return authError(res, 500, "Login failed");
  }
};

export const verifyTwoFactor = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      return authError(res, 400, "Please provide a valid email.");
    }
    if (!isValidOtp(otp)) {
      return authError(res, 400, "Please enter the 6-digit OTP.");
    }
    await verifyEmailOtp({ email: normalizedEmail, purpose: "2fa", code: normalizeOtp(otp) });
    const student = await prisma.student.findFirst({
      where: { email: normalizedEmail },
      select: selectStudentAuthFields,
    });
    if (!student) {
      return authError(res, 401, INVALID_CREDENTIALS_MESSAGE);
    }
    const token = issueToken({ role: "student", id: student.id });
    return authSuccess(res, {
      token,
      role: "student",
      name: student.name,
    });
  } catch (err) {
    if (err?.status) {
      return authError(res, err.status, err.message, err.retryAfter ? { retryAfter: err.retryAfter } : {});
    }
    if (isDbUnavailableError(err)) {
      console.error("2FA ERROR: Database unavailable");
      return authError(res, 503, "Database unavailable");
    }
    console.error("2FA ERROR:", err?.message || err);
    return authError(res, 500, "2FA verification failed");
  }
};


// =====================================================
// RESET PASSWORD (ADMIN / STUDENT)
// =====================================================
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!isValidEmail(normalizedEmail)) {
      return authError(res, 400, "Please enter a valid email address.");
    }

    if (!isStrongPassword(newPassword)) {
      return authError(
        res,
        400,
        "Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
      );
    }

    if (!otp) {
      return authError(res, 400, "OTP verification is required to reset password.");
    }

    if (!isValidOtp(otp)) {
      return authError(res, 400, "Please enter the 6-digit OTP.");
    }

    await verifyEmailOtp({ email: normalizedEmail, purpose: "reset", code: normalizeOtp(otp) });
    const student = await prisma.student.findFirst({
      where: { email: normalizedEmail },
      select: selectStudentAuthFieldsFallback,
    });
    if (!student) {
      return authError(res, 400, "Reset password failed");
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
    return authSuccess(res, { message: "Student password reset successful" });
  } catch (err) {
    if (isDbUnavailableError(err)) {
      console.error("RESET PASSWORD ERROR: Database unavailable");
      return authError(res, 503, "Database unavailable");
    }
    if (err?.status) {
      return authError(res, err.status, err.message, err.retryAfter ? { retryAfter: err.retryAfter } : {});
    }
    console.error("RESET PASSWORD ERROR:", err?.message || err);
    return authError(res, 500, "Reset password failed");
  }
};

// =====================================================
// LOGOUT (ADMIN / STUDENT)
// =====================================================
export const logoutUser = async (req, res) => {
  try {
    if (!req.user || !req.userRole || !req.token) {
      return authError(res, 400, "Invalid logout request");
    }

    removeSession(req.userRole, req.user.id, req.token);
    return authSuccess(res, { message: "Logged out successfully" });
  } catch (err) {
    console.error("LOGOUT ERROR:", err?.message || err);
    return authError(res, 500, "Logout failed");
  }
};
