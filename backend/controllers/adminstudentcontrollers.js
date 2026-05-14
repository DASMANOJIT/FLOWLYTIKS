import bcrypt from "bcryptjs";
import prisma from "../prisma/client.js";
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

const ADMIN_CREATE_STUDENT_OTP_PURPOSE = "admin_create_student";

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

const isUniqueConstraintError = (err) => err?.code === "P2002";

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
  if (!isValidPhone(normalizedPhone)) return "Please enter a valid WhatsApp number.";
  if (!isValidEmail(normalizedEmail)) return "Please provide a valid email address.";
  if (!String(password || "").trim()) return "Password is required.";
  if (!isStrongPassword(password)) {
    return "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";
  }

  return null;
};

const buildStudentDraft = ({
  name,
  email,
  phone,
  password,
  school,
  customSchool,
  class: studentClass,
}) => {
  const validationError = getSignupValidationError({
    name,
    school,
    customSchool,
    studentClass,
    phone,
    email,
    password,
  });

  if (validationError) {
    const err = new Error(validationError);
    err.status = 400;
    throw err;
  }

  return {
    normalizedName: normalizeName(name),
    normalizedEmail: normalizeEmail(email),
    normalizedPhone: normalizePhone(phone),
    password: String(password || ""),
    finalSchool: resolveSchoolValue({ school, customSchool }),
    classNum: parseStudentClass(studentClass),
  };
};

const findExistingAccountByEmail = async (email) => {
  const [student, admin] = await Promise.all([
    prisma.student.findUnique({ where: { email }, select: { id: true } }),
    prisma.admin.findUnique({ where: { email }, select: { id: true } }),
  ]);

  return student || admin;
};

const ensureStudentAccountAvailable = async ({ normalizedEmail, normalizedPhone }) => {
  const existingByEmail = await findExistingAccountByEmail(normalizedEmail);
  if (existingByEmail) {
    const err = new Error("Email is already registered.");
    err.status = 400;
    throw err;
  }

  const phoneCandidates = getPhoneSearchCandidates(normalizedPhone);
  const existingByPhone = await prisma.student.findFirst({
    where: {
      OR: phoneCandidates.map((value) => ({ phone: value })),
    },
    select: { id: true },
  });

  if (existingByPhone) {
    const err = new Error("WhatsApp number is already registered.");
    err.status = 400;
    throw err;
  }
};

export const sendAdminCreateStudentOtp = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return authError(res, 403, "Forbidden: Admins only");
    }

    const draft = buildStudentDraft(req.body);
    await ensureStudentAccountAvailable(draft);

    const result = await sendEmailOtp({
      email: draft.normalizedEmail,
      purpose: ADMIN_CREATE_STUDENT_OTP_PURPOSE,
    });

    return authSuccess(res, {
      message: "OTP sent successfully",
      maskedEmail: result.maskedEmail,
    });
  } catch (err) {
    if (err?.status) {
      return authError(
        res,
        err.status,
        err.message,
        err.retryAfter ? { retryAfter: err.retryAfter } : {}
      );
    }
    if (isDbUnavailableError(err)) {
      console.error("ADMIN CREATE STUDENT OTP ERROR: Database unavailable");
      return authError(res, 503, "Database unavailable");
    }
    console.error("ADMIN CREATE STUDENT OTP ERROR:", err?.message || err);
    return authError(res, 500, "Failed to send OTP");
  }
};

export const verifyAdminCreateStudentOtp = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return authError(res, 403, "Forbidden: Admins only");
    }

    const { otp } = req.body;
    if (!isValidOtp(otp)) {
      return authError(res, 400, "Please enter the 6-digit OTP.");
    }

    const draft = buildStudentDraft(req.body);
    await ensureStudentAccountAvailable(draft);

    await verifyEmailOtp({
      email: draft.normalizedEmail,
      purpose: ADMIN_CREATE_STUDENT_OTP_PURPOSE,
      code: normalizeOtp(otp),
    });

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      return authError(res, 500, "App settings not found");
    }

    const hashedPassword = await bcrypt.hash(draft.password, 10);

    let student;
    try {
      student = await prisma.student.create({
        data: {
          name: draft.normalizedName,
          email: draft.normalizedEmail,
          phone: draft.normalizedPhone,
          password: hashedPassword,
          school: draft.finalSchool,
          class: String(draft.classNum),
          adminId: Number(req.user?.id || 0) || null,
          monthlyFee: settings.monthlyFee,
          isVerified: true,
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return authError(
          res,
          400,
          "Student account already exists with this email or WhatsApp number."
        );
      }
      throw err;
    }

    const safeStudent = { ...student };
    delete safeStudent.password;

    return authSuccess(
      res,
      {
        message: "Student account created successfully.",
        student: safeStudent,
      },
      201
    );
  } catch (err) {
    if (err?.status) {
      return authError(
        res,
        err.status,
        err.message,
        err.retryAfter ? { retryAfter: err.retryAfter } : {}
      );
    }
    if (isDbUnavailableError(err)) {
      console.error("ADMIN CREATE STUDENT VERIFY ERROR: Database unavailable");
      return authError(res, 503, "Database unavailable");
    }
    console.error("ADMIN CREATE STUDENT VERIFY ERROR:", err?.message || err);
    return authError(res, 500, "Student creation failed");
  }
};
