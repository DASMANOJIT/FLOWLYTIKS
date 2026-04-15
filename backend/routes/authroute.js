import express from "express";
import {
  heartbeatSession,
  loginUser,
  markTabClosing,
  registerUser,
  resetPassword,
  logoutUser,
  verifyTwoFactor,
} from "../controllers/authcontrollers.js";
import { sendOtp, verifyOtp, signupWithOtp } from "../controllers/otpauthcontrollers.js";
import { protect } from "../middleware/authmiddleware.js";
import {
  authNoStore,
  loginRateLimit,
  otpSendRateLimit,
  otpVerifyRateLimit,
  passwordResetRateLimit,
  signupRateLimit,
} from "../middleware/security.js";
import { validateBody } from "../middleware/validation.js";
import {
  loginBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  sendOtpBodySchema,
  signupBodySchema,
  twoFactorBodySchema,
  verifyOtpBodySchema,
} from "../validation/authSchemas.js";

const router = express.Router();

router.use(authNoStore);

router.post("/send-otp", otpSendRateLimit, validateBody(sendOtpBodySchema), sendOtp);
router.post("/verify-otp", otpVerifyRateLimit, validateBody(verifyOtpBodySchema), verifyOtp);
router.post("/signup", signupRateLimit, validateBody(signupBodySchema), signupWithOtp);
router.post("/2fa/verify", otpVerifyRateLimit, validateBody(twoFactorBodySchema), verifyTwoFactor);

router.post("/login", loginRateLimit, validateBody(loginBodySchema), loginUser);
router.post("/register", signupRateLimit, validateBody(registerBodySchema), registerUser);
router.post("/reset-password", passwordResetRateLimit, validateBody(resetPasswordBodySchema), resetPassword);
router.post("/heartbeat", protect, heartbeatSession);
router.post("/tab-close", protect, markTabClosing);
router.post("/logout", protect, logoutUser);

export default router;
