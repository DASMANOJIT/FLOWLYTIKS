import express from "express";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import {
  createClassSchoolGroup,
  deleteClassSchoolGroup,
  listClassSchoolGroups,
  listMissingClassSchoolGroups,
  updateClassSchoolGroup,
} from "../controllers/classSchoolGroupControllers.js";
import { getAdminHealthCheck } from "../controllers/admincontrollers.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import {
  classSchoolGroupBodySchema,
  classSchoolGroupIdParamSchema,
} from "../validation/classSchoolGroupSchemas.js";

const router = express.Router();

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
