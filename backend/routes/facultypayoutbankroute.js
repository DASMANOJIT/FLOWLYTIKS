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

const router = express.Router();

router.post("/", protect, adminOnly, adminWriteRateLimit, validateBody(facultyBankCreateSchema), createBankAccount);
router.put("/:id", protect, adminOnly, adminWriteRateLimit, validateParams(bankIdParamSchema), validateBody(facultyBankUpdateSchema), updateBankAccount);
router.patch("/me", protect, adminWriteRateLimit, validateBody(facultySelfBankUpdateSchema), updateMyBankAccount);
router.get("/me", protect, getBankAccountByFaculty);
router.get("/faculty/:facultyId", protect, validateParams(facultyIdParamSchema), getBankAccountByFaculty);
router.post("/:id/verify", protect, adminOnly, validateParams(bankIdParamSchema), verifyBankAccount);

export default router;
