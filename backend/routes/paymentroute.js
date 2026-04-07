import express from "express";
import {
  getMyPayments,
  getAllPayments,
  markPaid,
  getTotalRevenue,
} from "../controllers/paymentcontrollers.js";
import {
  createCashfreeHostedOrder,
  handleCashfreeWebhook,
  verifyCashfreePayment,
} from "../controllers/cashfreecontroller.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import {
  initiatePhonePePayment,
  phonePeCallback,
  getPhonePePaymentStatus,
} from "../controllers/phonepecontroller.js";

const router = express.Router();

// STUDENT
router.get("/my", protect, getMyPayments);

// ADMIN
router.get("/all", protect, adminOnly, getAllPayments);
router.post("/mark-paid", protect, adminOnly, markPaid);
router.get("/revenue", protect, adminOnly, getTotalRevenue);

// PHONEPE
router.post("/phonepe/initiate", protect, initiatePhonePePayment);
router.post("/phonepe/callback", phonePeCallback);
router.get("/phonepe/status/:transactionId", protect, getPhonePePaymentStatus);

// CASHFREE
router.post("/cashfree/create-order", protect, createCashfreeHostedOrder);
router.get("/cashfree/verify", protect, verifyCashfreePayment);
router.post("/cashfree/verify", protect, verifyCashfreePayment);
router.post("/cashfree/webhook", handleCashfreeWebhook);

export default router;
