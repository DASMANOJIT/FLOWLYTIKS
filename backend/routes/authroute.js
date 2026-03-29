import express from "express";
import {
  loginUser,
  registerUser,
  resetPassword,
  logoutUser,
} from "../controllers/authcontrollers.js";
import {
  sendOtp,
  verifyOtp,
  signupWithOtp,
  verifyTwoFactor,
} from "../controllers/otpauthcontrollers.js";
import { protect } from "../middleware/authmiddleware.js";

const router = express.Router();

router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/signup", signupWithOtp);
router.post("/2fa/verify", verifyTwoFactor);

router.post("/login", loginUser);
router.post("/register", registerUser);
router.post("/reset-password", resetPassword);
router.post("/logout", protect, logoutUser);

export default router;
