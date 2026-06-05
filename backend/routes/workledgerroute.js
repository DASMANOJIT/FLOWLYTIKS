import express from "express";
import {
  createWorkLedgerEntry,
  deleteWorkLedgerEntry,
  exportWorkLedgerCsv,
  getWorkLedgerEntries,
  getWorkLedgerEntryById,
  getWorkLedgerFaculty,
  getWorkLedgerWeek,
  updateWorkLedgerEntry,
} from "../controllers/workledgercontrollers.js";
import { protect } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.js";
import {
  workLedgerBodySchema,
  workLedgerFacultyParamSchema,
  workLedgerIdParamSchema,
  workLedgerListQuerySchema,
  workLedgerWeekParamSchema,
} from "../validation/workLedgerSchemas.js";

const router = express.Router();

router.get("/", protect, validateQuery(workLedgerListQuerySchema), getWorkLedgerEntries);
router.get("/export.csv", protect, validateQuery(workLedgerListQuerySchema), exportWorkLedgerCsv);
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
router.get("/:id", protect, validateParams(workLedgerIdParamSchema), getWorkLedgerEntryById);
router.post(
  "/",
  protect,
  adminWriteRateLimit,
  validateBody(workLedgerBodySchema),
  createWorkLedgerEntry
);
router.put(
  "/:id",
  protect,
  adminWriteRateLimit,
  validateParams(workLedgerIdParamSchema),
  validateBody(workLedgerBodySchema),
  updateWorkLedgerEntry
);
router.delete(
  "/:id",
  protect,
  adminWriteRateLimit,
  validateParams(workLedgerIdParamSchema),
  deleteWorkLedgerEntry
);

export default router;
