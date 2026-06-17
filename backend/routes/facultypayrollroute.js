import express from "express";
import {
  approveFacultyPayroll,
  exportPayrollReport,
  generateFacultyPayroll,
  getFacultyPayroll,
  getPayrollReceipt,
  getPayrollCycleReview,
  getPayrollWeekDetails,
  getPayrollReports,
  initiateFacultyPayrollPayout,
  processFacultyPayroll,
  rejectFacultyPayroll,
  unlockFacultyPayrollLedger,
} from "../controllers/facultypayrollcontrollers.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit, exportRateLimit } from "../middleware/security.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.js";
import {
  payrollActionBodySchema,
  payrollCycleParamSchema,
  payrollGenerateBodySchema,
  payrollInitiatePayoutBodySchema,
  payrollListQuerySchema,
  payrollProcessBodySchema,
  payrollReportQuerySchema,
  payrollWeekDetailsQuerySchema,
} from "../validation/facultyPayrollSchemas.js";
import { auditAction } from "../services/auditLogService.js";

const router = express.Router();

router.get("/", protect, validateQuery(payrollListQuerySchema.partial()), getFacultyPayroll);
router.get("/weeks", protect, adminOnly, validateQuery(payrollListQuerySchema.partial()), getFacultyPayroll);
router.get("/week-details", protect, adminOnly, validateQuery(payrollWeekDetailsQuerySchema), getPayrollWeekDetails);
router.get("/receipt", protect, adminOnly, validateQuery(payrollWeekDetailsQuerySchema), getPayrollReceipt);
router.get("/reports", protect, adminOnly, validateQuery(payrollReportQuerySchema), getPayrollReports);
router.get("/export", protect, adminOnly, exportRateLimit, validateQuery(payrollReportQuerySchema), auditAction({ action: "PAYROLL_REPORT_EXPORTED", entityType: "FacultyPayroll", metadata: (req) => req.query }), exportPayrollReport);
router.get(
  "/review/:id",
  protect,
  adminOnly,
  validateParams(payrollCycleParamSchema),
  getPayrollCycleReview
);
router.post(
  "/generate",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(payrollGenerateBodySchema),
  auditAction({ action: "PAYROLL_GENERATED", entityType: "PayrollCycle", metadata: (req) => req.body }),
  generateFacultyPayroll
);
router.post(
  "/approve",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(payrollActionBodySchema),
  auditAction({ action: "PAYROLL_APPROVED", entityType: "PayrollCycle", entityId: (req) => req.body.payrollCycleId, metadata: (req) => req.body }),
  approveFacultyPayroll
);
router.post(
  "/process",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(payrollProcessBodySchema),
  auditAction({ action: "PAYROLL_MARKED_PAID", entityType: "PayrollCycle", entityId: (req) => req.body.payrollCycleId, metadata: (req) => req.body }),
  processFacultyPayroll
);
router.post(
  "/initiate-payout",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(payrollInitiatePayoutBodySchema),
  auditAction({ action: "PAYOUT_INITIATED", entityType: "PayrollCycle", entityId: (req) => req.body.payrollCycleId, metadata: (req) => req.body }),
  initiateFacultyPayrollPayout
);
router.post(
  "/reject",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(payrollActionBodySchema),
  auditAction({ action: "PAYROLL_REJECTED", entityType: "PayrollCycle", entityId: (req) => req.body.payrollCycleId, metadata: (req) => req.body }),
  rejectFacultyPayroll
);
router.post(
  "/unlock",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(payrollActionBodySchema),
  auditAction({ action: "LEDGER_UNLOCKED", entityType: "PayrollCycle", entityId: (req) => req.body.payrollCycleId, metadata: (req) => req.body }),
  unlockFacultyPayrollLedger
);

export default router;
