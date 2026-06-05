import express from "express";
import { handleCashfreePayoutWebhook } from "../controllers/facultypayoutcontrollers.js";

const router = express.Router();

router.post("/cashfree/payouts", handleCashfreePayoutWebhook);

export default router;
