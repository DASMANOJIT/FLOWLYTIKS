import express from "express";
import {
  approveFacultyPayroll,
  exportPayrollReport,
  generateFacultyPayroll,
  getFacultyPayroll,
  getPayrollCycleReview,
  getPayrollReports,
  processFacultyPayroll,
  rejectFacultyPayroll,
  unlockFacultyPayrollLedger,
} from "../controllers/facultypayrollcontrollers.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.js";
import {
  payrollActionBodySchema,
  payrollCycleParamSchema,
  payrollGenerateBodySchema,
  payrollListQuerySchema,
  payrollProcessBodySchema,
  payrollReportQuerySchema,
} from "../validation/facultyPayrollSchemas.js";

const router = express.Router();

router.get("/", protect, validateQuery(payrollListQuerySchema.partial()), getFacultyPayroll);
router.get("/reports", protect, adminOnly, validateQuery(payrollReportQuerySchema), getPayrollReports);
router.get("/export", protect, adminOnly, validateQuery(payrollReportQuerySchema), exportPayrollReport);
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
  generateFacultyPayroll
);
router.post(
  "/approve",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(payrollActionBodySchema),
  approveFacultyPayroll
);
router.post(
  "/process",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(payrollProcessBodySchema),
  processFacultyPayroll
);
router.post(
  "/reject",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(payrollActionBodySchema),
  rejectFacultyPayroll
);
router.post(
  "/unlock",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(payrollActionBodySchema),
  unlockFacultyPayrollLedger
);

export default router;
