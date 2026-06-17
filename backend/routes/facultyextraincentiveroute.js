import express from "express";
import {
  adjustMyIncentive,
  createIncentiveType,
  getAdminSummary,
  getMyIncentives,
  listIncentivePayments,
  listIncentiveTypes,
  payFacultyIncentives,
  updateIncentiveType,
} from "../controllers/facultyextraincentivecontrollers.js";
import { adminOnly, protect } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";

const router = express.Router();

const facultyOnly = (req, res, next) => {
  if (!req.user || req.userRole !== "faculty") {
    return res.status(403).json({ success: false, message: "Faculty access required." });
  }
  return next();
};

router.get("/types", protect, listIncentiveTypes);
router.post("/types", protect, adminOnly, adminWriteRateLimit, createIncentiveType);
router.patch("/types/:id", protect, adminOnly, adminWriteRateLimit, updateIncentiveType);

router.get("/admin/summary", protect, adminOnly, getAdminSummary);
router.post("/admin/pay/:facultyId", protect, adminOnly, adminWriteRateLimit, payFacultyIncentives);
router.get("/admin/payments", protect, adminOnly, listIncentivePayments);

router.get("/my", protect, facultyOnly, getMyIncentives);
router.post("/my/:incentiveTypeId/increment", protect, facultyOnly, adjustMyIncentive);
router.post("/my/:incentiveTypeId/decrement", protect, facultyOnly, adjustMyIncentive);
router.get("/my/payments", protect, facultyOnly, listIncentivePayments);

export default router;
