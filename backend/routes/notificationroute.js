import express from "express";
import { getAdminNotificationLogs } from "../controllers/notificationcontrollers.js";
import { adminOnly, protect } from "../middleware/authmiddleware.js";

const router = express.Router();

router.get("/admin", protect, adminOnly, getAdminNotificationLogs);

export default router;
