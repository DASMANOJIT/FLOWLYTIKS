import { z } from "zod";
import { isValidWhatsAppGroupLink } from "../services/classSchoolGroupService.js";

const trimmedRequiredString = (label, max = 160) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be shorter.`);

export const classSchoolGroupBodySchema = z.object({
  className: trimmedRequiredString("Class", 60),
  schoolName: trimmedRequiredString("School", 160),
  whatsappGroupLink: trimmedRequiredString("WhatsApp group link", 500).refine(
    (value) => isValidWhatsAppGroupLink(value),
    "Please enter a valid WhatsApp group invite link."
  ),
});

export const classSchoolGroupIdParamSchema = z.object({
  id: z.string().trim().min(1, "Group id is required."),
});
