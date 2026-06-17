import { z } from "zod";
import { prismaStringId } from "./idSchemas.js";

export const payoutCreateBodySchema = z.object({
  facultyId: prismaStringId("Faculty id must be valid."),
  payrollId: prismaStringId("Payroll id must be valid.").optional(),
  amount: z.coerce.number().min(1, "Amount must be greater than zero.").optional(),
  paymentMethod: z.string().optional(),
});

export const payoutBulkBodySchema = z.object({
  payoutIds: z.array(prismaStringId("Payout id must be valid.")).min(1),
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
  payrollCycleId: prismaStringId("Payroll cycle id must be valid."),
});

export const payoutIdParamSchema = z.object({ id: prismaStringId("Payout id must be valid.") });

export const payoutListQuerySchema = z.object({
  status: z.enum(["all", "PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "REVERSED"]).optional().default("all"),
  page: z.preprocess((v) => Number(v), z.number().int().min(1).default(1)),
  limit: z.preprocess((v) => Number(v), z.number().int().min(1).max(100).default(20)),
});
