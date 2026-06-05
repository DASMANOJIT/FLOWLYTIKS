import { z } from "zod";

const today = new Date();

export const monthYearQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).default(today.getUTCMonth() + 1),
  year: z.coerce.number().int().min(2000).max(2100).default(today.getUTCFullYear()),
});

export const workLedgerSelfQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
});
