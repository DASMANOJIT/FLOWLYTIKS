import { z } from "zod";
import { prismaStringId } from "./idSchemas.js";

export const workLedgerShifts = ["MORNING", "AFTERNOON", "EVENING"];

const emptyToNull = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const dateOnly = z.preprocess((value) => {
  const text = emptyToNull(value);
  if (!text) return value;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : date;
}, z.date({ error: "Date is required." }));

export const workLedgerIdParamSchema = z.object({
  id: prismaStringId("Ledger entry id must be valid."),
});

export const workLedgerWeekParamSchema = z.object({
  weekId: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Week id must be YYYY-MM-DD."),
});

export const workLedgerFacultyParamSchema = z.object({
  facultyId: prismaStringId("Faculty id must be valid."),
});

export const workLedgerBodySchema = z.object({
  facultyId: prismaStringId("Faculty member is required."),
  date: dateOnly,
  shift: z.enum(workLedgerShifts, { error: "Shift is required." }),
  amount: z.coerce.number().min(0, "Amount cannot be negative."),
  remarks: z.preprocess(emptyToNull, z.string().max(1000).nullable().optional()),
});

export const workLedgerAttendancePatchSchema = z.object({
  isPresent: z.boolean().optional().default(true),
  amount: z.coerce.number().min(0, "Amount cannot be negative.").optional().default(0),
  remarks: z.preprocess(emptyToNull, z.string().max(1000).nullable().optional()),
});

export const workLedgerListQuerySchema = z.object({
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  facultyId: z.union([prismaStringId("Faculty id must be valid."), z.literal("all")]).optional().default("all"),
  shift: z.enum(["all", ...workLedgerShifts]).optional().default("all"),
  search: z.string().trim().max(160).optional().default(""),
  week: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  month: z.string().trim().regex(/^\d{4}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional().default(500),
  exportScope: z.enum(["currentWeek", "currentMonth", "custom"]).optional(),
});
