import express from "express";
import {
  createWorkLedgerEntry,
  addAdminShiftAttendance,
  deleteAdminShiftAttendance,
  getEligibleAttendanceFaculty,
  deleteWorkLedgerEntry,
  exportWorkLedgerCsv,
  exportWorkLedgerReport,
  getWorkLedgerEntries,
  getWorkLedgerEntryById,
  getWorkLedgerFaculty,
  getWorkLedgerWeek,
  updateWorkLedgerAttendanceEntry,
  updateWorkLedgerEntry,
} from "../controllers/workledgercontrollers.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.js";
import {
  workLedgerBodySchema,
  adminAttendanceAddSchema,
  adminAttendanceEligibleSchema,
  workLedgerAttendancePatchSchema,
  workLedgerFacultyParamSchema,
  workLedgerIdParamSchema,
  workLedgerListQuerySchema,
  workLedgerWeekParamSchema,
} from "../validation/workLedgerSchemas.js";
import { auditAction } from "../services/auditLogService.js";

const router = express.Router();

router.get("/admin/attendance/eligible", protect, adminOnly, validateQuery(adminAttendanceEligibleSchema), getEligibleAttendanceFaculty);
router.post("/admin/attendance", protect, adminOnly, adminWriteRateLimit, validateBody(adminAttendanceAddSchema), auditAction({ action: "WORK_LEDGER_ENTRY_CREATED", entityType: "WorkLedgerEntry", metadata: req => req.body }), addAdminShiftAttendance);
router.delete("/admin/attendance/:id", protect, adminOnly, adminWriteRateLimit, validateParams(workLedgerIdParamSchema), auditAction({ action: "WORK_LEDGER_ENTRY_DELETED", entityType: "WorkLedgerEntry", entityId: req => req.params.id }), deleteAdminShiftAttendance);

router.get("/", protect, validateQuery(workLedgerListQuerySchema), getWorkLedgerEntries);
router.get("/export.csv", protect, validateQuery(workLedgerListQuerySchema), exportWorkLedgerCsv);
router.get("/export.json", protect, validateQuery(workLedgerListQuerySchema), exportWorkLedgerReport);
router.get(
  "/week/:weekId",
  protect,
  validateParams(workLedgerWeekParamSchema),
  validateQuery(workLedgerListQuerySchema.partial()),
  getWorkLedgerWeek
);
router.get(
  "/faculty/:facultyId",
  protect,
  validateParams(workLedgerFacultyParamSchema),
  validateQuery(workLedgerListQuerySchema.partial()),
  getWorkLedgerFaculty
);
router.patch(
  "/attendance/:attendanceId",
  protect,
  adminWriteRateLimit,
  validateBody(workLedgerAttendancePatchSchema),
  auditAction({ action: "ATTENDANCE_EDITED_BY_ADMIN", entityType: "WorkLedgerEntry", entityId: (req) => req.params.attendanceId, metadata: (req) => req.body }),
  updateWorkLedgerAttendanceEntry
);
router.get("/:id", protect, validateParams(workLedgerIdParamSchema), getWorkLedgerEntryById);
router.post(
  "/",
  protect,
  adminWriteRateLimit,
  validateBody(workLedgerBodySchema),
  auditAction({ action: "WORK_LEDGER_ENTRY_CREATED", entityType: "WorkLedgerEntry", metadata: (req) => req.body }),
  createWorkLedgerEntry
);
router.put(
  "/:id",
  protect,
  adminWriteRateLimit,
  validateParams(workLedgerIdParamSchema),
  validateBody(workLedgerBodySchema),
  auditAction({ action: "WORK_LEDGER_ENTRY_UPDATED", entityType: "WorkLedgerEntry", entityId: (req) => req.params.id, metadata: (req) => req.body }),
  updateWorkLedgerEntry
);
router.delete(
  "/:id",
  protect,
  adminWriteRateLimit,
  validateParams(workLedgerIdParamSchema),
  auditAction({ action: "WORK_LEDGER_ENTRY_DELETED", entityType: "WorkLedgerEntry", entityId: (req) => req.params.id }),
  deleteWorkLedgerEntry
);

export default router;
