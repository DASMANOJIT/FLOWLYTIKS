import express from "express";
import {
  getCashfreePayoutWebhookHealth,
  handleCashfreePayoutWebhook,
} from "../controllers/facultypayoutcontrollers.js";

const router = express.Router();

router.get("/cashfree/payouts/health", getCashfreePayoutWebhookHealth);
router.post("/cashfree/payouts", handleCashfreePayoutWebhook);

export default router;
