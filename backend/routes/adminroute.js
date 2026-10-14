import express from "express";
import { readFacultyBilling } from "../services/adminDashboardService.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import {
  createClassSchoolGroup,
  deleteClassSchoolGroup,
  listClassSchoolGroups,
  listMissingClassSchoolGroups,
  updateClassSchoolGroup,
} from "../controllers/classSchoolGroupControllers.js";
import { getAdminHealthCheck, getAdminDashboardSummary } from "../controllers/admincontrollers.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import {
  classSchoolGroupBodySchema,
  classSchoolGroupIdParamSchema,
} from "../validation/classSchoolGroupSchemas.js";

const router = express.Router();
router.get("/faculty-billing-summary", protect, adminOnly, async (req, res) => {
  try { res.json(await readFacultyBilling()); }
  catch (error) {
    console.error("Faculty billing summary unavailable", { code: error.code || "QUERY_FAILED" });
    res.status(503).json({ error: "Faculty billing summary is unavailable. Please try again." });
  }
});
router.get("/dashboard-summary", protect, adminOnly, getAdminDashboardSummary);

router.get("/health-check", protect, adminOnly, getAdminHealthCheck);
router.get("/class-school-groups", protect, adminOnly, listClassSchoolGroups);
router.get(
  "/class-school-groups/missing",
  protect,
  adminOnly,
  listMissingClassSchoolGroups
);
router.post(
  "/class-school-groups",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(classSchoolGroupBodySchema),
  createClassSchoolGroup
);
router.put(
  "/class-school-groups/:id",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateParams(classSchoolGroupIdParamSchema),
  validateBody(classSchoolGroupBodySchema),
  updateClassSchoolGroup
);
router.delete(
  "/class-school-groups/:id",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateParams(classSchoolGroupIdParamSchema),
  deleteClassSchoolGroup
);

export default router;
