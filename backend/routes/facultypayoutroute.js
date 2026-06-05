import express from "express";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit } from "../middleware/security.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validation.js";
import {
  payoutCreateBodySchema,
  payoutBulkBodySchema,
  payoutBulkMarkPaidBodySchema,
  payoutIdParamSchema,
  payoutListQuerySchema,
  payoutMarkFailedBodySchema,
  payoutMarkPaidBodySchema,
  payoutPayrollCycleBodySchema,
} from "../validation/facultyPayoutSchemas.js";
import {
  listPayouts,
  createBeneficiaryController,
  createPayout,
  createPayoutsFromPayrollCycle,
  exportPayoutsCsv,
  getPayout,
  getPayoutReceipt,
  initiateBulkPayoutController,
  initiatePayoutController,
  markBulkPayoutPaidController,
  markPayoutFailedController,
  markPayoutPaidController,
  retryPayoutController,
  syncPayoutStatusController,
} from "../controllers/facultypayoutcontrollers.js";

const router = express.Router();

router.get("/", protect, adminOnly, validateQuery(payoutListQuerySchema), listPayouts);
router.post("/", protect, adminOnly, adminWriteRateLimit, validateBody(payoutCreateBodySchema), createPayout);
router.post("/from-payroll-cycle", protect, adminOnly, adminWriteRateLimit, validateBody(payoutPayrollCycleBodySchema), createPayoutsFromPayrollCycle);
router.post("/beneficiaries/:facultyId/create", protect, adminOnly, adminWriteRateLimit, createBeneficiaryController);
router.post("/bulk-initiate", protect, adminOnly, adminWriteRateLimit, validateBody(payoutBulkBodySchema), initiateBulkPayoutController);
router.post("/bulk/initiate", protect, adminOnly, adminWriteRateLimit, validateBody(payoutBulkBodySchema), initiateBulkPayoutController);
router.post("/bulk/mark-paid", protect, adminOnly, adminWriteRateLimit, validateBody(payoutBulkMarkPaidBodySchema), markBulkPayoutPaidController);
router.get("/export.csv", protect, adminOnly, validateQuery(payoutListQuerySchema.partial()), exportPayoutsCsv);
router.get("/:id", protect, adminOnly, validateParams(payoutIdParamSchema), getPayout);
router.get("/:id/receipt", protect, adminOnly, validateParams(payoutIdParamSchema), getPayoutReceipt);
router.get("/:id/status", protect, adminOnly, validateParams(payoutIdParamSchema), syncPayoutStatusController);
router.post("/:id/initiate", protect, adminOnly, validateParams(payoutIdParamSchema), initiatePayoutController);
router.post("/:id/sync-status", protect, adminOnly, validateParams(payoutIdParamSchema), syncPayoutStatusController);
router.post("/:id/mark-paid", protect, adminOnly, adminWriteRateLimit, validateParams(payoutIdParamSchema), validateBody(payoutMarkPaidBodySchema), markPayoutPaidController);
router.post("/:id/mark-failed", protect, adminOnly, adminWriteRateLimit, validateParams(payoutIdParamSchema), validateBody(payoutMarkFailedBodySchema), markPayoutFailedController);
router.post("/:id/retry", protect, adminOnly, validateParams(payoutIdParamSchema), retryPayoutController);

export default router;
