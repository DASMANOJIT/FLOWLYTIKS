import express from "express";
import {
  loginFaculty,
  resetFacultyPassword,
  sendFacultyPasswordOtp,
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
  facultyLoginBodySchema,
  facultyResetPasswordBodySchema,
  facultyVerifyOtpBodySchema,
} from "../validation/facultySchemas.js";

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
  "/forgot-password/reset",
  passwordResetRateLimit,
  validateBody(facultyResetPasswordBodySchema),
  resetFacultyPassword
);

export default router;
