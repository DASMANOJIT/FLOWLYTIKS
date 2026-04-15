import { z } from "zod";

const paymentMonthSchema = z.enum([
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
]);

const positiveIntSchema = z.coerce
  .number()
  .int("Must be a whole number.")
  .positive("Must be a positive number.");

const positiveAmountSchema = z.coerce
  .number()
  .positive("Amount must be greater than zero.")
  .max(1_000_000, "Amount is too large.");

const isoDateStringSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid date.")
  .optional();

export const markPaidBodySchema = z.object({
  studentId: positiveIntSchema,
  month: paymentMonthSchema,
});

export const bulkUpdatePaymentsBodySchema = z.object({
  studentIds: z.array(positiveIntSchema).min(1).max(10),
  month: paymentMonthSchema,
  status: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .refine((value) => value === "paid", "Only paid status is supported."),
  paymentMode: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .refine((value) => value === "cash", "Only cash payment mode is supported."),
});

export const cashfreeCreateOrderBodySchema = z.object({
  studentId: positiveIntSchema,
  amount: positiveAmountSchema,
  month: paymentMonthSchema,
  preferredMethod: z.string().trim().max(40).optional().nullable(),
  upiApp: z.string().trim().max(40).optional().nullable(),
  upiId: z.string().trim().max(120).optional().nullable(),
});

export const revenueQuerySchema = z.object({
  from: isoDateStringSchema,
  to: isoDateStringSchema,
});

export const paymentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const monthlyFeeBodySchema = z.object({
  fee: positiveAmountSchema,
});

export const reversePaymentBodySchema = z.object({
  paymentId: positiveIntSchema,
  studentId: positiveIntSchema,
  month: paymentMonthSchema,
  academicYear: z.coerce.number().int().min(2000).max(3000),
});
