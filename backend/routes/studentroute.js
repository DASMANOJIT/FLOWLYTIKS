import express from "express";
import {
  getStudents,
  exportStudentsCsv,
  getStudentCount,
  getLoggedInStudent,
  getStudentById,
  deleteStudent,
} from "../controllers/studentcontrollers.js";
import {
  sendAdminCreateStudentOtp,
  verifyAdminCreateStudentOtp,
} from "../controllers/adminstudentcontrollers.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import { registerBodySchema, signupBodySchema } from "../validation/authSchemas.js";
import { studentIdParamSchema } from "../validation/studentSchemas.js";

const router = express.Router();

// ADMIN
router.get("/", protect, adminOnly, getStudents);
router.get("/export.csv", protect, adminOnly, exportStudentsCsv);
router.get("/count", protect, adminOnly, getStudentCount);
router.post(
  "/send-create-otp",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(registerBodySchema),
  sendAdminCreateStudentOtp
);
router.post(
  "/verify-create-otp",
  protect,
  adminOnly,
  adminWriteRateLimit,
  validateBody(signupBodySchema),
  verifyAdminCreateStudentOtp
);
// STUDENT SELF
router.get("/me", protect, getLoggedInStudent);
router.get("/:id", protect, adminOnly, validateParams(studentIdParamSchema), getStudentById);
router.delete("/:id", protect, adminOnly, validateParams(studentIdParamSchema), deleteStudent);


export default router;
