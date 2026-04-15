import { z } from "zod";

export const studentIdParamSchema = z.object({
  id: z.coerce.number().int().positive("Student id must be a positive number."),
});
