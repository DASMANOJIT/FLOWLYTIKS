import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client.js";
import {
  addSession,
  getActiveSessionCount,
} from "../utils/sessionStore.js";
import {
  formatIndianPhone,
  sendOTP as sendVerifyOTP,
  verifyOTP as verifyVerifyOTP,
} from "../services/twilioVerifyService.js";

const MAX_DEVICES_PER_ACCOUNT = 2;

const isStrongPassword = (password) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(
    String(password || "")
  );

const isValidPhone = (phone) => /^\+91\d{10}$/.test(String(phone || "").trim());

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
    const { phone, purpose } = req.body;
    const normalizedPhone = formatIndianPhone(phone);
    const debug = process.env.DEBUG_OTP === "1";
    let dbSuccess = true;
    const masked =
      normalizedPhone && normalizedPhone.length >= 6
        ? `${normalizedPhone.slice(0, 3)}***${normalizedPhone.slice(-2)}`
        : "***";

    if (debug) {
      console.log("🔥 SEND OTP HIT");
      console.log("STEP 1: Request received");
      console.log("send-otp: request", {
        purpose: String(purpose || ""),
        phone: masked,
        twilioSidExists: !!process.env.TWILIO_ACCOUNT_SID,
      });
      console.log("STEP 2: Phone normalized:", masked);
    }

    if (!isValidPhone(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid Indian phone number (10 digits).",
      });
    }

    if (!["signup", "login", "reset", "2fa"].includes(String(purpose))) {
      return res.status(400).json({ success: false, message: "Invalid OTP purpose." });
    }

    if (purpose === "signup") {
      try {
        const existingByPhone = await prisma.student.findFirst({
          where: { phone: normalizedPhone },
        });
        if (existingByPhone) {
          return res.status(400).json({
            success: false,
            message: "Phone number is already registered.",
          });
        }
      } catch (err) {
        dbSuccess = false;
        console.error("❌ DB ERROR:", err?.message || err);
      }
    } else if (purpose === "login" || purpose === "reset" || purpose === "2fa") {
      try {
        const student = await prisma.student.findFirst({
          where: { phone: normalizedPhone },
        });
        if (!student) {
          return res.status(404).json({ success: false, message: "User not found." });
        }
      } catch (err) {
        dbSuccess = false;
        console.error("❌ DB ERROR:", err?.message || err);
      }
    }

    if (!dbSuccess) {
      return res.status(503).json({ success: false, message: "Database unavailable" });
    }

    if (debug) console.log("STEP 3: Sending OTP via Twilio Verify");
    const twilio = await sendVerifyOTP(normalizedPhone);
    if (debug) console.log("STEP 4: OTP request accepted by Twilio Verify");

    return res.status(200).json({
      success: true,
      message: "OTP sent successfully",
      ...(debug ? { twilioStatus: twilio?.status } : {}),
    });
  } catch (err) {
    const safeErr = {
      name: err?.name,
      message: err?.message,
      status: err?.status,
      code: err?.code,
    };
    try {
      console.error("SEND OTP ERROR:", JSON.stringify(safeErr, null, 2));
    } catch {
      console.error("SEND OTP ERROR:", safeErr?.message || "Unknown error");
    }
    if (!res.headersSent) {
      const status = err?.status || 500;
      return res.status(status).json({
        success: false,
        message: err?.message || "Failed to send OTP",
      });
    }
  }

  // Failsafe: ensure request doesn't hang.
  if (!res.headersSent) {
    return res.status(500).json({ success: false, message: "Unexpected error" });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { phone, otp, purpose } = req.body;
    const normalizedPhone = formatIndianPhone(phone);
    const code = String(otp || "").trim();
    const debug = process.env.DEBUG_TWILIO_VERIFY === "1" || process.env.DEBUG_OTP === "1";

    if (!["signup", "login", "reset", "2fa"].includes(String(purpose))) {
      return res.status(400).json({ message: "Invalid OTP purpose." });
    }

    const result = await verifyVerifyOTP(normalizedPhone, code);
    if (!result?.ok) {
      return res.status(400).json({
        ok: false,
        message: "Invalid OTP.",
        ...(debug ? { twilioStatus: result?.status } : {}),
      });
    }
    return res.json({ ok: true, ...(debug ? { twilioStatus: result?.status } : {}) });
  } catch (err) {
    console.error("verifyOtp error:", err?.message || err);
    const status = err?.status || 400;
    return res.status(status).json({
      success: false,
      message: err?.message || "OTP verification failed.",
    });
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
    const normalizedPhone = formatIndianPhone(phone);
    const code = String(otp || "").trim();
    const debug = process.env.NODE_ENV !== "production" || process.env.DEBUG_SIGNUP === "1";

    if (debug) {
      const masked =
        normalizedPhone && normalizedPhone.length >= 6
          ? `${normalizedPhone.slice(0, 3)}***${normalizedPhone.slice(-2)}`
          : "***";
      console.log("Signup request body:", {
        name: name ? "<present>" : "<missing>",
        email: email ? "<present>" : "<missing>",
        phone: masked,
        school: school ? "<present>" : "<missing>",
        class: studentClass ? "<present>" : "<missing>",
        password: password ? `<len:${String(password).length}>` : "<missing>",
        otp: code ? `<len:${code.length}>` : "<missing>",
      });
    }

    if (!isValidPhone(normalizedPhone)) {
      return res.status(400).json({ message: "Please enter a valid phone number." });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        message:
          "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
      });
    }

    const finalSchool =
      String(school || "").trim() === "other"
        ? String(customSchool || "").trim()
        : String(school || "").trim();
    if (!finalSchool) {
      return res.status(400).json({ message: "School is required." });
    }

    const classNum = parseInt(String(studentClass || "").trim(), 10);
    if (!Number.isInteger(classNum) || classNum < 3 || classNum > 12) {
      return res.status(400).json({ message: "Please select a valid class (3 to 12)." });
    }
    const classValue = String(classNum);

    const existsEmail = email
      ? await prisma.student.findFirst({ where: { email } })
      : null;
    if (existsEmail) {
      return res.status(400).json({ message: "Student already exists" });
    }

    const existsPhone = await prisma.student.findUnique({ where: { phone: normalizedPhone } });
    if (existsPhone) {
      return res.status(400).json({ message: "Phone number is already registered." });
    }

    const result = await verifyVerifyOTP(normalizedPhone, code);
    if (!result?.ok) {
      return res.status(400).json({ message: "Invalid OTP." });
    }

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      return res.status(500).json({ message: "App settings not found" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    let student = null;
    try {
      student = await prisma.student.create({
        data: {
          name,
          email,
          phone: normalizedPhone,
          password: hashedPassword,
          school: finalSchool,
          class: classValue,
          monthlyFee: settings.monthlyFee,
          isVerified: true,
        },
      });
    } catch (err) {
      if (isDbUnavailableError(err)) {
        console.error("SIGNUP ERROR: Database unavailable");
        return res.status(503).json({ success: false, message: "Database unavailable" });
      }

      if (isMissingColumnError(err, "isVerified")) {
        console.warn("DB schema mismatch: Student.isVerified missing; creating without it");
        student = await prisma.student.create({
          data: {
            name,
            email,
            phone: normalizedPhone,
            password: hashedPassword,
            school: finalSchool,
            class: classValue,
            monthlyFee: settings.monthlyFee,
          },
        });
      } else if (err?.code === "P2002") {
        return res.status(400).json({ message: "Account already exists." });
      } else {
        console.error("Signup Error:", err);
        throw err;
      }
    }

    const token = issueToken({ role: "student", id: student.id });

    return res.json({
      token,
      role: "student",
      name: student.name,
    });
  } catch (err) {
    console.error("signupWithOtp error:", err);
    const status = err?.status || 500;
    return res.status(status).json({ message: err.message || "Signup failed." });
  }
};

export const verifyTwoFactor = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const student = await prisma.student.findFirst({ where: { email } });
    if (!student) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!student.isTwoFactorEnabled) {
      return res.status(400).json({ message: "Two-factor authentication is not enabled." });
    }

    if (!student.phone) {
      return res.status(400).json({ message: "Phone number is missing for this account." });
    }

    const result = await verifyVerifyOTP(student.phone, otp);
    if (!result?.ok) {
      return res.status(400).json({ message: "Invalid OTP." });
    }
    const token = issueToken({ role: "student", id: student.id });

    return res.json({
      token,
      role: "student",
      name: student.name,
    });
  } catch (err) {
    console.error("verifyTwoFactor error:", err?.message || err);
    const status = err?.status || 400;
    return res.status(status).json({ message: err.message || "2FA verification failed." });
  }
};
