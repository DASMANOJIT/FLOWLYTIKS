import express from "express";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import {
  adminAssistantChat,
  getAdminAssistantJobStatus,
} from "../controllers/adminassistantcontroller.js";

const router = express.Router();

router.post("/chat", protect, adminOnly, adminAssistantChat);
router.get("/jobs/:jobId", protect, adminOnly, getAdminAssistantJobStatus);

export default router;
