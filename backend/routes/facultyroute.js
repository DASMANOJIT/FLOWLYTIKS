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
router.put(
  "/profile",
  protect,
  adminWriteRateLimit,
  validateBody(facultySelfUpdateBodySchema),
  updateMyFacultyPortalProfile
);

router.post("/attendance/week", protect, upsertWeekAttendance);
router.patch("/attendance", protect, upsertWeekAttendance);
router.post("/attendance", protect, upsertWeekAttendance);
router.delete("/attendance/:id", protect, deleteWeekAttendanceEntry);
router.put(
  "/me",
  protect,
  adminWriteRateLimit,
  validateBody(facultySelfUpdateBodySchema),
  updateMyFacultyPortalProfile
);
router.patch(
  "/me/password",
  protect,
  adminWriteRateLimit,
  validateBody(facultyChangePasswordBodySchema),
  changeMyFacultyPassword
);
router.post(
  "/",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(facultyCreateBodySchema),
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
  updateFaculty
);
router.patch(
  "/:id/status",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateParams(facultyIdParamSchema),
  validateBody(facultyStatusBodySchema),
  updateFacultyStatus
);
router.delete(
  "/:id",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateParams(facultyIdParamSchema),
  deleteFaculty
);

export default router;
