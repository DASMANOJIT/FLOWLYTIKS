import express from "express";
import { protect, adminOnly } from "../middleware/authmiddleware.js";
import { adminWriteRateLimit, exportRateLimit } from "../middleware/security.js";
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
  getCashfreePayoutWebhookHealth,
  handleCashfreePayoutWebhook,
  initiateBulkPayoutController,
  initiatePayoutController,
  markBulkPayoutPaidController,
  markPayoutFailedController,
  markPayoutPaidController,
  retryPayoutController,
  syncPayoutStatusController,
} from "../controllers/facultypayoutcontrollers.js";
import { auditAction } from "../services/auditLogService.js";

const router = express.Router();

router.get("/cashfree/webhook/health", getCashfreePayoutWebhookHealth);
router.post("/cashfree/webhook", handleCashfreePayoutWebhook);
router.get("/", protect, adminOnly, validateQuery(payoutListQuerySchema), listPayouts);
router.post("/", protect, adminOnly, adminWriteRateLimit, validateBody(payoutCreateBodySchema), auditAction({ action: "PAYOUT_CREATED", entityType: "FacultyPayout", metadata: (req) => req.body }), createPayout);
router.post("/from-payroll-cycle", protect, adminOnly, adminWriteRateLimit, validateBody(payoutPayrollCycleBodySchema), auditAction({ action: "PAYOUTS_CREATED_FROM_PAYROLL", entityType: "PayrollCycle", entityId: (req) => req.body.payrollCycleId, metadata: (req) => req.body }), createPayoutsFromPayrollCycle);
router.post("/beneficiaries/:facultyId/create", protect, adminOnly, adminWriteRateLimit, auditAction({ action: "PAYOUT_BENEFICIARY_CREATED", entityType: "Faculty", entityId: (req) => req.params.facultyId }), createBeneficiaryController);
router.post("/bulk-initiate", protect, adminOnly, adminWriteRateLimit, validateBody(payoutBulkBodySchema), auditAction({ action: "PAYOUT_BULK_INITIATED", entityType: "FacultyPayout", metadata: (req) => req.body }), initiateBulkPayoutController);
router.post("/bulk/initiate", protect, adminOnly, adminWriteRateLimit, validateBody(payoutBulkBodySchema), auditAction({ action: "PAYOUT_BULK_INITIATED", entityType: "FacultyPayout", metadata: (req) => req.body }), initiateBulkPayoutController);
router.post("/bulk/mark-paid", protect, adminOnly, adminWriteRateLimit, validateBody(payoutBulkMarkPaidBodySchema), auditAction({ action: "PAYOUT_BULK_MARKED_PAID", entityType: "FacultyPayout", metadata: (req) => req.body }), markBulkPayoutPaidController);
router.get("/export.csv", protect, adminOnly, exportRateLimit, validateQuery(payoutListQuerySchema.partial()), auditAction({ action: "PAYOUT_REPORT_EXPORTED", entityType: "FacultyPayout", metadata: (req) => req.query }), exportPayoutsCsv);
router.get("/:id", protect, adminOnly, validateParams(payoutIdParamSchema), getPayout);
router.get("/:id/receipt", protect, adminOnly, validateParams(payoutIdParamSchema), getPayoutReceipt);
router.get("/:id/status", protect, adminOnly, validateParams(payoutIdParamSchema), syncPayoutStatusController);
router.post("/:id/initiate", protect, adminOnly, adminWriteRateLimit, validateParams(payoutIdParamSchema), auditAction({ action: "PAYOUT_INITIATED", entityType: "FacultyPayout", entityId: (req) => req.params.id }), initiatePayoutController);
router.post("/:id/sync-status", protect, adminOnly, validateParams(payoutIdParamSchema), auditAction({ action: "PAYOUT_STATUS_SYNCED", entityType: "FacultyPayout", entityId: (req) => req.params.id }), syncPayoutStatusController);
router.post("/:id/mark-paid", protect, adminOnly, adminWriteRateLimit, validateParams(payoutIdParamSchema), validateBody(payoutMarkPaidBodySchema), auditAction({ action: "PAYOUT_MARKED_PAID", entityType: "FacultyPayout", entityId: (req) => req.params.id, metadata: (req) => req.body }), markPayoutPaidController);
router.post("/:id/mark-failed", protect, adminOnly, adminWriteRateLimit, validateParams(payoutIdParamSchema), validateBody(payoutMarkFailedBodySchema), auditAction({ action: "PAYOUT_MARKED_FAILED", entityType: "FacultyPayout", entityId: (req) => req.params.id, metadata: (req) => req.body }), markPayoutFailedController);
router.post("/:id/retry", protect, adminOnly, adminWriteRateLimit, validateParams(payoutIdParamSchema), auditAction({ action: "PAYOUT_RETRIED", entityType: "FacultyPayout", entityId: (req) => req.params.id }), retryPayoutController);

export default router;
