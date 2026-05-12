import express from "express";
import { logWhatsAppReminder } from "../controllers/remindercontrollers.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody } from "../middleware/validation.js";
import { whatsappReminderLogBodySchema } from "../validation/reminderSchemas.js";

const router = express.Router();

router.post(
  "/whatsapp/log",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(whatsappReminderLogBodySchema),
  logWhatsAppReminder
);

export default router;
