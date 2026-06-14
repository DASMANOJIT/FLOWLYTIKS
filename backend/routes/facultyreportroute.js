import express from "express";
import {
  exportFacultyReportCsv,
  exportFacultyReportPdf,
  getFailedFacultyPayoutReport,
  getFacultyEarningsReport,
  getFacultyPayoutReport,
  getFacultyReportSummary,
  getMonthlyFacultyReport,
  getUnpaidFacultyPayoutReport,
  getWeeklyFacultyReport,
} from "../controllers/facultyreportcontrollers.js";
import { adminOnly, protect } from "../middleware/authmiddleware.js";
import { exportRateLimit } from "../middleware/security.js";
import { auditAction } from "../services/auditLogService.js";

const router = express.Router();

router.get("/summary", protect, adminOnly, getFacultyReportSummary);
router.get("/weekly", protect, adminOnly, getWeeklyFacultyReport);
router.get("/monthly", protect, adminOnly, getMonthlyFacultyReport);
router.get("/faculty-earnings", protect, adminOnly, getFacultyEarningsReport);
router.get("/payouts", protect, adminOnly, getFacultyPayoutReport);
router.get("/unpaid", protect, adminOnly, getUnpaidFacultyPayoutReport);
router.get("/failed", protect, adminOnly, getFailedFacultyPayoutReport);
router.get("/export/csv", protect, adminOnly, exportRateLimit, auditAction({ action: "FACULTY_REPORT_CSV_EXPORTED", entityType: "FacultyReport", metadata: (req) => req.query }), exportFacultyReportCsv);
router.get("/export/pdf", protect, adminOnly, exportRateLimit, auditAction({ action: "FACULTY_REPORT_PDF_EXPORTED", entityType: "FacultyReport", metadata: (req) => req.query }), exportFacultyReportPdf);

export default router;
