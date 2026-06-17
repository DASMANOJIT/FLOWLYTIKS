import express from "express";
import {
  createFaculty,
  deleteFaculty,
  getFaculty,
  getFacultyById,
  changeMyFacultyPassword,
  updateFaculty,
  updateFacultyStatus,
} from "../controllers/facultycontrollers.js";
import {
  getFacultyDashboard,
  getMyAttendance,
  getMyFacultyProfileForPortal,
  getMyNotifications,
  getMyPayoutHistory,
  getMyWorkLedger,
  getWeekAttendance,
  deleteWeekAttendanceEntry,
  upsertWeekAttendance,
  updateMyFacultyPortalProfile,
} from "../controllers/facultyportalcontrollers.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.js";
import {
  facultyChangePasswordBodySchema,
  facultyCreateBodySchema,
  facultyIdParamSchema,
  facultyListQuerySchema,
  facultySelfUpdateBodySchema,
  facultyStatusBodySchema,
  facultyUpdateBodySchema,
} from "../validation/facultySchemas.js";
import {
  monthYearQuerySchema,
  workLedgerSelfQuerySchema,
} from "../validation/facultyPortalSchemas.js";
import { facultySelfBankUpdateSchema } from "../validation/facultyBankSchemas.js";
import { updateMyBankAccount } from "../controllers/facultypayoutbankcontrollers.js";
import { auditAction } from "../services/auditLogService.js";
import { facultyChatbotMessage } from "../controllers/facultychatbotcontroller.js";

const router = express.Router();

router.get("/", protect, adminOnly, validateQuery(facultyListQuerySchema), getFaculty);
router.get("/dashboard", protect, getFacultyDashboard);
router.get("/dashboard-summary", protect, getFacultyDashboard);
router.get("/me", protect, getMyFacultyProfileForPortal);
router.get("/attendance", protect, (req, res, next) => {
  if (req.query.weekStart) return getWeekAttendance(req, res);
  return next();
}, validateQuery(monthYearQuerySchema), getMyAttendance);
router.get("/attendance/week", protect, getWeekAttendance);
router.get("/work-ledger", protect, validateQuery(workLedgerSelfQuerySchema), getMyWorkLedger);
router.get("/notifications", protect, getMyNotifications);
router.get("/payout-history", protect, getMyPayoutHistory);
router.post("/chatbot/message", protect, facultyChatbotMessage);
router.put(
  "/profile",
  protect,
  adminWriteRateLimit,
  validateBody(facultySelfUpdateBodySchema),
  auditAction({ action: "FACULTY_PROFILE_UPDATED", entityType: "Faculty", entityId: (req) => req.user?.id }),
  updateMyFacultyPortalProfile
);
router.patch(
  "/me/payout-details",
  protect,
  adminWriteRateLimit,
  validateBody(facultySelfBankUpdateSchema),
  auditAction({ action: "FACULTY_PAYOUT_DETAILS_UPDATED", entityType: "Faculty", entityId: (req) => req.user?.id }),
  updateMyBankAccount
);

router.post("/attendance/week", protect, auditAction({ action: "ATTENDANCE_SUBMITTED", entityType: "WorkLedgerEntry", metadata: (req) => req.body }), upsertWeekAttendance);
router.patch("/attendance", protect, auditAction({ action: "ATTENDANCE_SUBMITTED", entityType: "WorkLedgerEntry", metadata: (req) => req.body }), upsertWeekAttendance);
router.post("/attendance", protect, auditAction({ action: "ATTENDANCE_SUBMITTED", entityType: "WorkLedgerEntry", metadata: (req) => req.body }), upsertWeekAttendance);
router.delete("/attendance/:id", protect, auditAction({ action: "ATTENDANCE_DELETED", entityType: "WorkLedgerEntry", entityId: (req) => req.params.id }), deleteWeekAttendanceEntry);
router.put(
  "/me",
  protect,
  adminWriteRateLimit,
  validateBody(facultySelfUpdateBodySchema),
  auditAction({ action: "FACULTY_PROFILE_UPDATED", entityType: "Faculty", entityId: (req) => req.user?.id }),
  updateMyFacultyPortalProfile
);
router.patch(
  "/me/password",
  protect,
  adminWriteRateLimit,
  validateBody(facultyChangePasswordBodySchema),
  auditAction({ action: "FACULTY_PASSWORD_CHANGED", entityType: "Faculty", entityId: (req) => req.user?.id }),
  changeMyFacultyPassword
);
router.post(
  "/",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(facultyCreateBodySchema),
  auditAction({ action: "FACULTY_CREATED", entityType: "Faculty", metadata: (req) => req.body }),
  createFaculty
);
router.get("/:id", protect, adminOnly, validateParams(facultyIdParamSchema), getFacultyById);
router.put(
  "/:id",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateParams(facultyIdParamSchema),
  validateBody(facultyUpdateBodySchema),
  auditAction({ action: "FACULTY_UPDATED", entityType: "Faculty", entityId: (req) => req.params.id, metadata: (req) => req.body }),
  updateFaculty
);
router.patch(
  "/:id/status",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateParams(facultyIdParamSchema),
  validateBody(facultyStatusBodySchema),
  auditAction({ action: "FACULTY_STATUS_UPDATED", entityType: "Faculty", entityId: (req) => req.params.id, metadata: (req) => req.body }),
  updateFacultyStatus
);
router.delete(
  "/:id",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateParams(facultyIdParamSchema),
  auditAction({ action: "FACULTY_DELETED", entityType: "Faculty", entityId: (req) => req.params.id }),
  deleteFaculty
);

export default router;
