import { z } from "zod";
import { prismaStringId } from "./idSchemas.js";

const emptyToNull = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const optionalText = z.preprocess(emptyToNull, z.string().max(300).nullable().optional());
const payoutModeSchema = z.enum(["UPI", "BANK", "BOTH", "NONE"]).optional().default("NONE");

const payoutDetailsShape = {
  facultyId: prismaStringId("Faculty id must be valid.").optional(),
  payoutMode: payoutModeSchema,
  accountHolderName: optionalText,
  accountNumber: z.preprocess(emptyToNull, z.string().regex(/^\d{6,24}$/, "Bank account number must contain 6-24 digits.").nullable().optional()),
  ifscCode: z.preprocess((value) => {
    const text = emptyToNull(value);
    return text ? String(text).toUpperCase() : null;
  }, z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC code.").nullable().optional()),
  bankName: optionalText,
  branchName: optionalText,
  upiId: z.preprocess(emptyToNull, z.string().min(3).max(120).refine((value) => value.includes("@"), "Enter a valid UPI ID.").nullable().optional()),
  panNumber: optionalText,
  payoutContactName: optionalText,
  payoutContactPhone: z.preprocess(emptyToNull, z.string().regex(/^\d{8,15}$/, "Enter a valid contact phone.").nullable().optional()),
  payoutContactEmail: z.preprocess(emptyToNull, z.string().email("Enter a valid contact email.").nullable().optional()),
  verificationStatus: z.enum(["PENDING", "VERIFIED", "REJECTED"]).optional(),
  payoutEligible: z.boolean().optional(),
  payoutBlockedReason: optionalText,
  payoutRemarks: optionalText,
};

const enforcePayoutModeRequirements = (data, ctx) => {
  if (["UPI", "BOTH"].includes(data.payoutMode) && !data.upiId) {
    ctx.addIssue({ code: "custom", path: ["upiId"], message: "UPI ID is required for this payout mode." });
  }
  if (["BANK", "BOTH"].includes(data.payoutMode)) {
    for (const field of ["accountHolderName", "accountNumber", "ifscCode", "bankName"]) {
      if (!data[field]) ctx.addIssue({ code: "custom", path: [field], message: "Bank details are required for this payout mode." });
    }
  }
};

export const facultyBankCreateSchema = z.object({
  ...payoutDetailsShape,
  facultyId: prismaStringId("Faculty id must be valid."),
}).superRefine(enforcePayoutModeRequirements);

export const facultyBankUpdateSchema = z
  .object(payoutDetailsShape)
  .partial()
  .superRefine(enforcePayoutModeRequirements);

export const facultySelfBankUpdateSchema = z.object({
  payoutMode: payoutDetailsShape.payoutMode,
  accountHolderName: payoutDetailsShape.accountHolderName,
  accountNumber: payoutDetailsShape.accountNumber,
  ifscCode: payoutDetailsShape.ifscCode,
  bankName: payoutDetailsShape.bankName,
  branchName: payoutDetailsShape.branchName,
  upiId: payoutDetailsShape.upiId,
  payoutContactName: payoutDetailsShape.payoutContactName,
  payoutContactPhone: payoutDetailsShape.payoutContactPhone,
  payoutContactEmail: payoutDetailsShape.payoutContactEmail,
}).superRefine(enforcePayoutModeRequirements);

export const facultyIdParamSchema = z.object({ facultyId: prismaStringId("Faculty id must be valid.") });

export const bankIdParamSchema = z.object({ id: prismaStringId("Bank id must be valid.") });
