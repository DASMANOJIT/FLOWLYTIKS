import express from "express";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { getAdminHealthCheck } from "../controllers/admincontrollers.js";

const router = express.Router();

router.get("/health-check", protect, adminOnly, getAdminHealthCheck);

export default router;
