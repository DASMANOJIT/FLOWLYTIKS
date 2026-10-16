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
  saveMyCopySet,
  deleteMyCopySet,
  getIncentiveCopySets,
} from "../controllers/facultyextraincentivecontrollers.js";
import { adminOnly, protect } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { getMyOnlineClasses, getAdminOnlineClasses, saveMyOnlineClass, changeMyOnlineClass, deleteMyOnlineClass, downloadOnlineAttendance, adminOnlineClassSummary, getOnlineDirectory, writeOnlineDirectory, deleteOnlineDirectoryBatch, manageAdminOnlineClass } from "../controllers/facultyonlineclasscontrollers.js";

const router = express.Router();

const facultyOnly = (req, res, next) => {
  if (!req.user || req.userRole !== "faculty") {
    return res.status(403).json({ success: false, message: "Faculty access required." });
  }
  return next();
};

const attendanceReaderOnly = (req, res, next) => {
  if (!req.user || !["faculty", "admin"].includes(req.userRole)) {
    return res.status(403).json({ success: false, message: "Faculty or Admin access required." });
  }
  return next();
};

router.get("/types", protect, listIncentiveTypes);
router.post("/types", protect, adminOnly, adminWriteRateLimit, createIncentiveType);
router.patch("/types/:id", protect, adminOnly, adminWriteRateLimit, updateIncentiveType);

router.get("/admin/summary", protect, adminOnly, getAdminSummary);
router.post("/admin/pay/:facultyId", protect, adminOnly, adminWriteRateLimit, payFacultyIncentives);
router.get("/admin/payments", protect, adminOnly, listIncentivePayments);
router.get("/admin/:facultyId/sets/:incentiveTypeId", protect, adminOnly, getIncentiveCopySets);
router.get("/admin/online-classes", protect, adminOnly, getAdminOnlineClasses);
router.get("/admin/online-class-summary", protect, adminOnly, adminOnlineClassSummary);
router.get("/online-class-directory", protect, attendanceReaderOnly, getOnlineDirectory);
router.post("/admin/online-class-directory/:kind", protect, adminOnly, adminWriteRateLimit, writeOnlineDirectory);
router.patch("/admin/online-class-directory/:kind/:id", protect, adminOnly, adminWriteRateLimit, writeOnlineDirectory);
router.delete("/admin/online-class-directory/batch/:id", protect, adminOnly, adminWriteRateLimit, deleteOnlineDirectoryBatch);
router.patch("/admin/online-classes/:id", protect, adminOnly, adminWriteRateLimit, manageAdminOnlineClass);
router.delete("/admin/online-classes/:id", protect, adminOnly, adminWriteRateLimit, manageAdminOnlineClass);
router.post("/admin/online-classes/:id/:action", protect, adminOnly, adminWriteRateLimit, manageAdminOnlineClass);
router.get("/online-classes/:id/attendance.pdf", protect, attendanceReaderOnly, downloadOnlineAttendance);

router.get("/my/online-classes", protect, facultyOnly, getMyOnlineClasses);
router.post("/my/online-classes", protect, facultyOnly, adminWriteRateLimit, saveMyOnlineClass);
router.patch("/my/online-classes/:id", protect, facultyOnly, adminWriteRateLimit, saveMyOnlineClass);
router.delete("/my/online-classes/:id", protect, facultyOnly, adminWriteRateLimit, deleteMyOnlineClass);
router.post("/my/online-classes/:id/:action", protect, facultyOnly, adminWriteRateLimit, changeMyOnlineClass);

router.get("/my", protect, facultyOnly, getMyIncentives);
router.get("/my/:incentiveTypeId/sets", protect, facultyOnly, getIncentiveCopySets);
router.post("/my/:incentiveTypeId/sets", protect, facultyOnly, adminWriteRateLimit, saveMyCopySet);
router.patch("/my/:incentiveTypeId/sets/:entryId", protect, facultyOnly, adminWriteRateLimit, saveMyCopySet);
router.delete("/my/:incentiveTypeId/sets/:entryId", protect, facultyOnly, adminWriteRateLimit, deleteMyCopySet);
router.patch("/my/:incentiveTypeId/pending-count", protect, facultyOnly, adjustMyIncentive);
router.post("/my/:incentiveTypeId/increment", protect, facultyOnly, adjustMyIncentive);
router.post("/my/:incentiveTypeId/decrement", protect, facultyOnly, adjustMyIncentive);
router.get("/my/payments", protect, facultyOnly, listIncentivePayments);

export default router;
