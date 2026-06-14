import express from "express";
import {
  getWeeklyPaymentRecord,
  getWeeklyPaymentStatus,
  listWeeklyPaymentRecords,
  payWeeklyCash,
  payWeeklyOnline,
} from "../controllers/facultyweeklypaymentcontrollers.js";
import {
  getCashfreePayoutWebhookHealth,
  handleCashfreePayoutWebhook,
} from "../controllers/facultypayoutcontrollers.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { auditAction } from "../services/auditLogService.js";

const router = express.Router();

router.get("/cashfree/webhook/health", getCashfreePayoutWebhookHealth);
router.post("/cashfree/webhook", handleCashfreePayoutWebhook);
router.get("/status", protect, adminOnly, getWeeklyPaymentStatus);
router.post(
  "/pay-online",
  protect,
  adminOnly,
  adminWriteRateLimit,
  auditAction({ action: "FACULTY_WEEKLY_PAYMENT_ONLINE_INITIATED", entityType: "WeeklyFacultyPaymentRecord", metadata: (req) => req.body }),
  payWeeklyOnline
);
router.post(
  "/pay-cash",
  protect,
  adminOnly,
  adminWriteRateLimit,
  auditAction({ action: "FACULTY_WEEKLY_PAYMENT_CASH_PAID", entityType: "WeeklyFacultyPaymentRecord", metadata: (req) => req.body }),
  payWeeklyCash
);
router.get("/records", protect, adminOnly, listWeeklyPaymentRecords);
router.get("/records/:id", protect, adminOnly, getWeeklyPaymentRecord);

export default router;
