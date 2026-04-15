import express from "express";
import {
  getMyPayments,
  getAllPayments,
  markPaid,
  bulkUpdatePayments,
  getTotalRevenue,
  reversePayment,
} from "../controllers/paymentcontrollers.js";
import {
  createCashfreeHostedOrder,
  handleCashfreeWebhook,
  verifyCashfreePayment,
} from "../controllers/cashfreecontroller.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import {
  adminWriteRateLimit,
  paymentInitiationRateLimit,
} from "../middleware/security.js";
import {
  validateBody,
  validateQuery,
} from "../middleware/validation.js";
import {
  bulkUpdatePaymentsBodySchema,
  cashfreeCreateOrderBodySchema,
  markPaidBodySchema,
  paymentsQuerySchema,
  reversePaymentBodySchema,
  revenueQuerySchema,
} from "../validation/paymentSchemas.js";
import {
  initiatePhonePePayment,
  phonePeCallback,
  getPhonePePaymentStatus,
} from "../controllers/phonepecontroller.js";

const router = express.Router();

// STUDENT
router.get("/my", protect, getMyPayments);

// ADMIN
router.get("/all", protect, adminOnly, validateQuery(paymentsQuerySchema), getAllPayments);
router.post(
  "/mark-paid",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(markPaidBodySchema),
  markPaid
);
router.post(
  "/bulk-update",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(bulkUpdatePaymentsBodySchema),
  bulkUpdatePayments
);
router.post(
  "/reverse",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(reversePaymentBodySchema),
  reversePayment
);
router.get("/revenue", protect, adminOnly, validateQuery(revenueQuerySchema), getTotalRevenue);

// PHONEPE
router.post("/phonepe/initiate", protect, initiatePhonePePayment);
router.post("/phonepe/callback", phonePeCallback);
router.get("/phonepe/status/:transactionId", protect, getPhonePePaymentStatus);

// CASHFREE
router.post(
  "/cashfree/create-order",
  protect,
  paymentInitiationRateLimit,
  validateBody(cashfreeCreateOrderBodySchema),
  createCashfreeHostedOrder
);
router.get("/cashfree/verify", protect, verifyCashfreePayment);
router.post("/cashfree/verify", protect, verifyCashfreePayment);
router.post("/cashfree/webhook", handleCashfreeWebhook);

export default router;
