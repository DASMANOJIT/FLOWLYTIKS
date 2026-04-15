import express from "express";
import { setMonthlyFee } from "../controllers/settingscontrollers.js";
import { adminOnly, protect } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody } from "../middleware/validation.js";
import { monthlyFeeBodySchema } from "../validation/paymentSchemas.js";

const router = express.Router();

router.post("/monthly-fee", protect, adminOnly, adminWriteRateLimit, validateBody(monthlyFeeBodySchema), setMonthlyFee);

export default router;
