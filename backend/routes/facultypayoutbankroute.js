import express from "express";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody, validateParams } from "../middleware/validation.js";
import {
  facultyBankCreateSchema,
  facultyBankUpdateSchema,
  facultySelfBankUpdateSchema,
  facultyIdParamSchema,
  bankIdParamSchema,
} from "../validation/facultyBankSchemas.js";
import {
  createBankAccount,
  updateBankAccount,
  getBankAccountByFaculty,
  updateMyBankAccount,
  verifyBankAccount,
} from "../controllers/facultypayoutbankcontrollers.js";
import { auditAction } from "../services/auditLogService.js";

const router = express.Router();

router.post("/", protect, adminOnly, adminWriteRateLimit, validateBody(facultyBankCreateSchema), auditAction({ action: "FACULTY_PAYOUT_DETAILS_CREATED_BY_ADMIN", entityType: "FacultyBankAccount", metadata: (req) => req.body }), createBankAccount);
router.put("/:id", protect, adminOnly, adminWriteRateLimit, validateParams(bankIdParamSchema), validateBody(facultyBankUpdateSchema), auditAction({ action: "FACULTY_PAYOUT_DETAILS_UPDATED_BY_ADMIN", entityType: "FacultyBankAccount", entityId: (req) => req.params.id, metadata: (req) => req.body }), updateBankAccount);
router.patch("/me", protect, adminWriteRateLimit, validateBody(facultySelfBankUpdateSchema), auditAction({ action: "FACULTY_PAYOUT_DETAILS_UPDATED", entityType: "FacultyBankAccount", metadata: (req) => req.body }), updateMyBankAccount);
router.get("/me", protect, getBankAccountByFaculty);
router.get("/faculty/:facultyId", protect, validateParams(facultyIdParamSchema), getBankAccountByFaculty);
router.post("/:id/verify", protect, adminOnly, adminWriteRateLimit, validateParams(bankIdParamSchema), auditAction({ action: "FACULTY_PAYOUT_DETAILS_VERIFIED_OR_REJECTED", entityType: "FacultyBankAccount", entityId: (req) => req.params.id, metadata: (req) => req.body }), verifyBankAccount);

export default router;
