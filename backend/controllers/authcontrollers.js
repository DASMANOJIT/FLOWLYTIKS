import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client.js";
import {
  addSession,
  clearUserSessions,
  getActiveSessionCount,
  removeSession,
} from "../utils/sessionStore.js";
import {
  formatIndianPhone,
  sendOTP as sendVerifyOTP,
  verifyOTP as verifyVerifyOTP,
} from "../services/twilioVerifyService.js";

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
    const { email, password, phone, otp } = req.body;

    // =========================
    // OTP LOGIN (PASSWORDLESS)
    // =========================
    if (phone && otp) {
      const normalizedPhone = formatIndianPhone(phone);
      const code = String(otp || "").trim();
      try {
        const result = await verifyVerifyOTP(normalizedPhone, code);
        if (!result?.ok) {
          return res.status(400).json({ message: "Invalid OTP." });
        }
      } catch (err) {
        const status = err?.status || 400;
        return res
          .status(status)
          .json({ message: err.message || "OTP verification failed." });
      }

      let student = null;
      try {
        student = await prisma.student.findFirst({
          where: { phone: normalizedPhone },
          select: selectStudentAuthFields,
        });
      } catch (err) {
        if (
          isMissingColumnError(err, "isVerified") ||
          isMissingColumnError(err, "isTwoFactorEnabled")
        ) {
          console.warn("DB schema mismatch: student auth flags missing");
          student = await prisma.student.findFirst({
            where: { phone: normalizedPhone },
            select: selectStudentAuthFieldsFallback,
          });
          if (student) {
            student.isVerified = false;
            student.isTwoFactorEnabled = false;
          }
        } else {
          throw err;
        }
      }
      if (!student) {
        return res.status(404).json({ message: "User not found" });
      }

      if (typeof student.isVerified === "undefined") {
        console.warn("isVerified column missing in DB");
        student.isVerified = false;
      }

      try {
        await prisma.student.update({
          where: { id: student.id },
          data: { isVerified: true },
        });
      } catch (err) {
        if (!isMissingColumnError(err, "isVerified")) throw err;
        console.warn("Skipping isVerified update: column missing in DB");
      }

      const currentActive = getActiveSessionCount("student", student.id);
      if (currentActive >= MAX_DEVICES_PER_ACCOUNT) {
        return res.status(403).json({
          message:
            "Login limit reached (2 devices). Logout from another device first.",
        });
      }

      const token = jwt.sign(
        { id: student.id, role: "student" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
      const decoded = jwt.decode(token);
      const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 86400000;
      addSession("student", student.id, token, expMs);

      return res.json({
        token,
        role: "student",
        name: student.name,
      });
    }

    // =========================
    // ADMIN LOGIN
    // =========================
    const admin = await prisma.admin.findUnique({ where: { email } });

    if (admin) {
      const isMatch = await bcrypt.compare(password, admin.password);
      if (!isMatch) {
        return res.status(400).json({ message: "Incorrect password" });
      }

      const currentActive = getActiveSessionCount("admin", admin.id);
      if (currentActive >= MAX_DEVICES_PER_ACCOUNT) {
        return res.status(403).json({
          message:
            "Login limit reached (2 devices). Logout from another device first.",
        });
      }

      const token = jwt.sign(
        { id: admin.id, role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
      const decoded = jwt.decode(token);
      const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 86400000;
      addSession("admin", admin.id, token, expMs);

      return res.json({
        token,
        role: "admin",
        name: admin.name,
      });
    }

    // =========================
    // STUDENT LOGIN
    // =========================
    let student = null;
    try {
      student = await prisma.student.findFirst({
        where: { email },
        select: selectStudentAuthFields,
      });
    } catch (err) {
      if (
        isMissingColumnError(err, "isVerified") ||
        isMissingColumnError(err, "isTwoFactorEnabled")
      ) {
        console.warn("DB schema mismatch: student auth flags missing");
        student = await prisma.student.findFirst({
          where: { email },
          select: selectStudentAuthFieldsFallback,
        });
        if (student) {
          student.isVerified = false;
          student.isTwoFactorEnabled = false;
        }
      } else {
        throw err;
      }
    }

    if (!student) {
      return res.status(404).json({ message: "User not found" });
    }

    if (typeof student.isVerified === "undefined") {
      console.warn("isVerified column missing in DB");
      student.isVerified = false;
    }

    const isMatch = await bcrypt.compare(password, student.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect password" });
    }

    // =========================
    // STUDENT 2FA (OTP STEP)
    // =========================
    if (student.isTwoFactorEnabled && student.phone) {
      try {
        await sendVerifyOTP(student.phone);
      } catch (err) {
        const status = err?.status || 500;
        return res
          .status(status)
          .json({ message: err.message || "Failed to send 2FA OTP." });
      }

      return res.json({
        requires2fa: true,
        role: "student",
        email: student.email,
      });
    }

    const currentActive = getActiveSessionCount("student", student.id);
    if (currentActive >= MAX_DEVICES_PER_ACCOUNT) {
      return res.status(403).json({
        message:
          "Login limit reached (2 devices). Logout from another device first.",
      });
    }

    const token = jwt.sign(
      { id: student.id, role: "student" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    const decoded = jwt.decode(token);
    const expMs = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 86400000;
    addSession("student", student.id, token, expMs);

    return res.json({
      token,
      role: "student",
      name: student.name,
    });

  } catch (err) {
    if (isDbUnavailableError(err)) {
      console.error("LOGIN ERROR: Database unavailable");
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }
    console.error("LOGIN ERROR:", err?.message || err);
    return res.status(500).json({ message: "Login failed" });
  }
};


// =====================================================
// RESET PASSWORD (ADMIN / STUDENT)
// =====================================================
export const resetPassword = async (req, res) => {
  try {
    const { email, phone, otp, newPassword } = req.body;

    // =========================
    // OTP RESET (STUDENT)
    // =========================
    if (phone && otp) {
      const normalizedPhone = formatIndianPhone(phone);
      const code = String(otp || "").trim();
      if (!isValidPhone(normalizedPhone)) {
        return res.status(400).json({ message: "Please enter a valid phone number." });
      }

      if (!isStrongPassword(newPassword)) {
        return res.status(400).json({
          message:
            "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
        });
      }

      let student = null;
      try {
        student = await prisma.student.findFirst({
          where: { phone: normalizedPhone },
          select: selectStudentAuthFieldsFallback,
        });
      } catch (err) {
        throw err;
      }
      if (!student) {
        return res.status(404).json({ message: "User not found" });
      }

      try {
        const result = await verifyVerifyOTP(normalizedPhone, code);
        if (!result?.ok) {
          return res.status(400).json({ message: "Invalid OTP." });
        }
      } catch (err) {
        const status = err?.status || 400;
        return res
          .status(status)
          .json({ message: err.message || "OTP verification failed." });
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

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // ADMIN
    const admin = await prisma.admin.findUnique({ where: { email } });
    if (admin) {
      await prisma.admin.update({
        where: { email },
        data: { password: hashedPassword },
      });
      clearUserSessions("admin", admin.id);
      return res.json({ message: "Admin password reset successful" });
    }

    // STUDENT
    const student = await prisma.student.findFirst({ where: { email } });
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
    return res.status(500).json({ message: "Reset password failed" });
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
