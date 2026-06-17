import { z } from "zod";

export const payoutCreateBodySchema = z.object({
  facultyId: z.string().uuid("Faculty id must be a valid UUID."),
  payrollId: z.string().uuid("Payroll id must be a valid UUID.").optional(),
  amount: z.coerce.number().min(1, "Amount must be greater than zero.").optional(),
  paymentMethod: z.string().optional(),
});

export const payoutBulkBodySchema = z.object({
  payoutIds: z.array(z.string().uuid("Payout id must be a valid UUID.")).min(1),
});

export const payoutMarkPaidBodySchema = z.object({
  transactionId: z.string().trim().min(2, "UTR / transaction ID is required."),
});

export const payoutBulkMarkPaidBodySchema = payoutBulkBodySchema.extend({
  transactionId: z.string().trim().min(2, "UTR / transaction ID is required."),
});

export const payoutMarkFailedBodySchema = z.object({
  failureReason: z.string().trim().max(500).optional(),
});

export const payoutPayrollCycleBodySchema = z.object({
  payrollCycleId: z.string().uuid("Payroll cycle id must be a valid UUID."),
});

export const payoutIdParamSchema = z.object({ id: z.string().uuid("Payout id must be a valid UUID.") });

export const payoutListQuerySchema = z.object({
  status: z.enum(["all", "PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "REVERSED"]).optional().default("all"),
  page: z.preprocess((v) => Number(v), z.number().int().min(1).default(1)),
  limit: z.preprocess((v) => Number(v), z.number().int().min(1).max(100).default(20)),
});
