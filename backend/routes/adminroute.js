import express from "express";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import {
  createClassSchoolGroup,
  deleteClassSchoolGroup,
  listClassSchoolGroups,
  listMissingClassSchoolGroups,
  updateClassSchoolGroup,
} from "../controllers/classSchoolGroupControllers.js";
import {
  getAdminHealthCheck,
  sendAdminResetOtp,
  verifyAdminResetPassword,
} from "../controllers/admincontrollers.js";
import {
  adminWriteRateLimit,
  otpSendRateLimit,
  passwordResetRateLimit,
} from "../middleware/security.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import {
  classSchoolGroupBodySchema,
  classSchoolGroupIdParamSchema,
} from "../validation/classSchoolGroupSchemas.js";
import {
  adminResetPasswordBodySchema,
  adminResetSendOtpBodySchema,
} from "../validation/authSchemas.js";

const router = express.Router();

router.post(
  "/auth/forgot-password/send-otp",
  otpSendRateLimit,
  validateBody(adminResetSendOtpBodySchema),
  sendAdminResetOtp
);
router.post(
  "/auth/forgot-password/verify-reset",
  passwordResetRateLimit,
  validateBody(adminResetPasswordBodySchema),
  verifyAdminResetPassword
);
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
