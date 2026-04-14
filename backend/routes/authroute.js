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

const router = express.Router();

router.use(authNoStore);

router.post("/send-otp", otpSendRateLimit, sendOtp);
router.post("/verify-otp", otpVerifyRateLimit, verifyOtp);
router.post("/signup", signupRateLimit, signupWithOtp);
router.post("/2fa/verify", otpVerifyRateLimit, verifyTwoFactor);

router.post("/login", loginRateLimit, loginUser);
router.post("/register", signupRateLimit, registerUser);
router.post("/reset-password", passwordResetRateLimit, resetPassword);
router.post("/heartbeat", protect, heartbeatSession);
router.post("/tab-close", protect, markTabClosing);
router.post("/logout", protect, logoutUser);

export default router;
