import express from "express";
import {
  loginFaculty,
  resetFacultyPassword,
  sendFacultyPasswordOtp,
  verifyFacultyEmailResetPassword,
  verifyFacultyPasswordOtp,
} from "../controllers/facultyauthcontrollers.js";
import {
  loginRateLimit,
  otpSendRateLimit,
  otpVerifyRateLimit,
  passwordResetRateLimit,
} from "../middleware/security.js";
import { validateBody } from "../middleware/validation.js";
import {
  facultyForgotPasswordBodySchema,
  facultyEmailResetPasswordBodySchema,
  facultyLoginBodySchema,
  facultyResetPasswordBodySchema,
  facultyVerifyOtpBodySchema,
} from "../validation/facultySchemas.js";
import { auditAction } from "../services/auditLogService.js";

const router = express.Router();

router.post("/login", loginRateLimit, validateBody(facultyLoginBodySchema), loginFaculty);
router.post(
  "/forgot-password/send-otp",
  otpSendRateLimit,
  validateBody(facultyForgotPasswordBodySchema),
  sendFacultyPasswordOtp
);
router.post(
  "/forgot-password/verify-otp",
  otpVerifyRateLimit,
  validateBody(facultyVerifyOtpBodySchema),
  verifyFacultyPasswordOtp
);
router.post(
  "/forgot-password/verify-reset",
  passwordResetRateLimit,
  validateBody(facultyEmailResetPasswordBodySchema),
  auditAction({ action: "FACULTY_PASSWORD_RESET", entityType: "Faculty", metadata: (req) => ({ email: req.body?.email }) }),
  verifyFacultyEmailResetPassword
);
router.post(
  "/forgot-password/reset",
  passwordResetRateLimit,
  validateBody(facultyResetPasswordBodySchema),
  auditAction({ action: "FACULTY_PASSWORD_RESET", entityType: "Faculty", metadata: (req) => ({ phone: req.body?.phone }) }),
  resetFacultyPassword
);

export default router;
