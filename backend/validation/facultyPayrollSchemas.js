import { z } from "zod";
import { prismaStringId } from "./idSchemas.js";

const dateOnly = z.preprocess((value) => {
  const raw = String(value || "").trim();
  if (!raw) return value;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : date;
}, z.date({ error: "Date is required." }));

export const payrollGenerateBodySchema = z
  .object({
    weekStart: dateOnly,
    weekEnd: dateOnly,
  })
  .refine((data) => data.weekStart <= data.weekEnd, {
    path: ["weekEnd"],
    message: "Week end must be after week start.",
  });

export const payrollProcessBodySchema = z.object({
  payrollBatchId: prismaStringId("Payroll cycle id must be valid.").optional(),
  payrollCycleId: prismaStringId("Payroll cycle id must be valid.").optional(),
}).refine((data) => data.payrollBatchId || data.payrollCycleId, {
  path: ["payrollCycleId"],
  message: "Payroll cycle id is required.",
});

export const payrollInitiatePayoutBodySchema = z.object({
  cycleId: prismaStringId("Payroll cycle id must be valid.").optional(),
  payrollCycleId: prismaStringId("Payroll cycle id must be valid.").optional(),
  weekStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weekEnd: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((data) => data.cycleId || data.payrollCycleId || (data.weekStart && data.weekEnd), {
  path: ["payrollCycleId"],
  message: "Payroll cycle id or week period is required.",
});

export const payrollCycleParamSchema = z.object({
  id: prismaStringId("Payroll cycle id must be valid."),
});

export const payrollActionBodySchema = z.object({
  payrollCycleId: prismaStringId("Payroll cycle id must be valid."),
  remarks: z.string().trim().max(500).optional(),
});

export const payrollListQuerySchema = z.object({
  batchId: prismaStringId().optional(),
  cycleId: prismaStringId().optional(),
  weekStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weekEnd: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const payrollWeekDetailsQuerySchema = z.object({
  cycleId: prismaStringId().optional(),
  weekStart: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  weekEnd: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((data) => data.cycleId || (data.weekStart && data.weekEnd), {
  path: ["cycleId"],
  message: "Provide cycleId or weekStart and weekEnd.",
});

export const payrollReportQuerySchema = z.object({
  type: z.enum(["weekly", "monthly", "faculty", "summary"]).optional(),
  format: z.enum(["csv", "excel", "xlsx", "pdf"]).optional(),
  cycleId: prismaStringId().optional(),
  facultyId: prismaStringId("Faculty id must be valid.").optional(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "PAID", "REJECTED", "LOCKED"]).optional(),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
