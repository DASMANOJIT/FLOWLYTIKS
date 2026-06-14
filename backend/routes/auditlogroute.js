import express from "express";
import { getAuditLogs } from "../controllers/auditlogcontrollers.js";
import { adminOnly, protect } from "../middleware/authmiddleware.js";

const router = express.Router();

router.get("/", protect, adminOnly, getAuditLogs);

export default router;
