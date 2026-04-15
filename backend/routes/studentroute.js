import express from "express";
import {
  getStudents,
  getStudentCount,
  getLoggedInStudent,
  getStudentById,
  deleteStudent,
} from "../controllers/studentcontrollers.js";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { validateParams } from "../middleware/validation.js";
import { studentIdParamSchema } from "../validation/studentSchemas.js";

const router = express.Router();

// ADMIN
router.get("/", protect, adminOnly, getStudents);
router.get("/count", protect, adminOnly, getStudentCount);
// STUDENT SELF
router.get("/me", protect, getLoggedInStudent);
router.get("/:id", protect, adminOnly, validateParams(studentIdParamSchema), getStudentById);
router.delete("/:id", protect, adminOnly, validateParams(studentIdParamSchema), deleteStudent);


export default router;
