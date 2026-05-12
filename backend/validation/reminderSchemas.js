import { z } from "zod";
import { ACADEMIC_YEAR_MONTHS } from "../utils/academicYear.js";

export const whatsappReminderLogBodySchema = z.object({
  studentId: z.coerce
    .number()
    .int()
    .positive("Student id must be a positive number."),
  month: z
    .string()
    .trim()
    .refine(
      (value) => ACADEMIC_YEAR_MONTHS.includes(value),
      "Month must be a valid academic year month."
    ),
  academicYear: z.coerce
    .number()
    .int()
    .min(2000, "Academic year must be valid.")
    .max(2100, "Academic year must be valid."),
});
