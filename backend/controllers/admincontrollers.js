import bcrypt from "bcryptjs";
import prisma from "../prisma/client.js";
import { sendEmailOtp, verifyEmailOtp } from "../services/emailOtpService.js";
import { clearUserSessions } from "../utils/sessionStore.js";

const ADMIN_RESET_PURPOSE = "admin_reset";

const jsonResponse = (res, status, payload) =>
  res.status(status).json({ success: status < 400, ...payload });

export const getAdminHealthCheck = async (req, res) => {
  try {
    const [dbProbe, latestPayment] = await Promise.all([
      prisma.$queryRaw`SELECT 1 as ok`,
      prisma.payment.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
    ]);

    return res.json({
      success: true,
      dbStatus: Array.isArray(dbProbe) && dbProbe.length ? "connected" : "unknown",
      prismaStatus: "ok",
      lastPaymentUpdateAt: latestPayment?.updatedAt
        ? new Date(latestPayment.updatedAt).toISOString()
        : null,
      paymentTestMode: process.env.NODE_ENV === "development",
      serverTimeUtc: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      dbStatus: "unavailable",
      prismaStatus: "error",
      lastPaymentUpdateAt: null,
      paymentTestMode: process.env.NODE_ENV === "development",
      serverTimeUtc: new Date().toISOString(),
      message: "Health check failed",
    });
  }
};

export const sendAdminResetOtp = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const admin = await prisma.admin.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!admin) {
      return jsonResponse(res, 404, { message: "Admin account not found." });
    }

    await sendEmailOtp({ email, purpose: ADMIN_RESET_PURPOSE });
    return jsonResponse(res, 200, { message: "OTP sent successfully." });
  } catch (error) {
    if (error?.status) {
      return jsonResponse(res, error.status, {
        message: error.message,
        ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
      });
    }
    console.error("ADMIN RESET OTP ERROR:", error?.message || error);
    return jsonResponse(res, 500, { message: "Failed to send OTP. Please try again." });
  }
};

export const verifyAdminResetPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const { otp, newPassword, confirmPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return jsonResponse(res, 400, { message: "Password must be at least 8 characters." });
    }
    if (newPassword !== confirmPassword) {
      return jsonResponse(res, 400, { message: "Passwords must match." });
    }

    const admin = await prisma.admin.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!admin) {
      return jsonResponse(res, 404, { message: "Admin account not found." });
    }

    await verifyEmailOtp({ email, purpose: ADMIN_RESET_PURPOSE, code: otp });
    const password = await bcrypt.hash(newPassword, 10);
    await prisma.admin.update({
      where: { id: admin.id },
      data: { password },
    });
    await clearUserSessions("admin", admin.id);
    return jsonResponse(res, 200, { message: "Password reset successful. Please login again." });
  } catch (error) {
    if (error?.status) {
      return jsonResponse(res, error.status, {
        message: error.message,
        ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
      });
    }
    console.error("ADMIN RESET PASSWORD ERROR:", error?.message || error);
    return jsonResponse(res, 500, { message: "Password reset failed. Please try again." });
  }
};
