import { z } from "zod";
import { prismaStringId } from "./idSchemas.js";

export const salaryTypes = ["MONTHLY_FIXED", "PER_CLASS", "ATTENDANCE_BASED"];
export const facultyStatuses = ["ACTIVE", "INACTIVE"];

const emptyToNull = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const optionalString = z.preprocess(
  emptyToNull,
  z.string().max(500).nullable().optional()
);

const optionalUpdatePassword = z.preprocess((value) => {
  const text = emptyToNull(value);
  return text || undefined;
}, z.string().min(8, "Password must be at least 8 characters.").optional());

const optionalDate = z.preprocess((value) => {
  const text = emptyToNull(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? value : date;
}, z.date().nullable().optional());

const requiredDate = z.preprocess((value) => {
  const text = emptyToNull(value);
  if (!text) return value;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? value : date;
}, z.date({ error: "Joining date is required." }));

const salaryAmount = z.preprocess((value) => {
  const text = emptyToNull(value);
  if (!text) return null;
  return Number(text);
}, z.number().min(0, "Salary amount must be 0 or more.").nullable().optional());

const experienceYears = z.preprocess((value) => {
  const text = emptyToNull(value);
  if (!text) return null;
  return Number.parseInt(text, 10);
}, z.number().int().min(0).max(80).nullable().optional());

export const facultyIdParamSchema = z.object({
  id: prismaStringId("Faculty id must be valid."),
});

export const facultyListQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(10000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  searchName: z.string().trim().max(120).optional().default(""),
  searchPhone: z.string().trim().max(30).optional().default(""),
  status: z.enum(["all", ...facultyStatuses]).optional().default("all"),
});

const facultyProfileFields = {
  fullName: z.string().trim().min(1, "Full name is required.").max(160),
  email: z.preprocess(
    emptyToNull,
    z.email("Enter a valid email.").max(160).nullable().optional()
  ),
  phone: z.string().trim().min(1, "Phone number is required.").max(30),
  gender: optionalString,
  dob: optionalDate,
  address: optionalString,
  designation: optionalString,
  qualification: optionalString,
  experienceYears,
  joiningDate: requiredDate,
  employmentType: z.preprocess(
    emptyToNull,
    z.string().max(80).nullable().optional()
  ),
  salaryType: z.enum(salaryTypes, { error: "Salary type is required." }),
  salaryAmount,
  paymentNotes: optionalString,
  status: z.enum(facultyStatuses).default("ACTIVE"),
};

export const facultyCreateBodySchema = z
  .object({
    ...facultyProfileFields,
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Confirm password is required."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match.",
  });

export const facultyUpdateBodySchema = z
  .object({
    ...facultyProfileFields,
    password: optionalUpdatePassword,
    confirmPassword: z.preprocess((value) => {
      const text = emptyToNull(value);
      return text || undefined;
    }, z.string().optional()),
  })
  .refine((data) => !data.password || data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match.",
  });

export const facultySelfUpdateBodySchema = z.object({
  phone: z.string().trim().min(1, "Mobile number is required.").max(30).optional(),
  email: z.preprocess(
    emptyToNull,
    z.email("Enter a valid email.").max(160).nullable().optional()
  ),
  address: optionalString,
  profilePictureUrl: z.preprocess(
    emptyToNull,
    z.url("Enter a valid profile picture URL.").max(1000).nullable().optional()
  ),
});

export const facultyChangePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required."),
    newPassword: z.string().min(8, "New password must be at least 8 characters."),
    confirmNewPassword: z.string().min(1, "Password confirmation is required."),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    path: ["confirmNewPassword"],
    message: "Passwords must match.",
  });

export const facultyLoginBodySchema = z
  .object({
    phone: z.string().trim().max(30).optional(),
    email: z.preprocess(emptyToNull, z.string().email().max(160).nullable().optional()),
    password: z.string().min(1, "Password is required."),
  })
  .refine((data) => !!(data.phone || data.email), {
    message: "Phone number or email is required.",
    path: ["phone"],
  });

export const facultyForgotPasswordBodySchema = z.object({
  phone: z.string().trim().max(30).optional(),
  email: z.preprocess(emptyToNull, z.string().email().max(160).nullable().optional()),
}).refine((data) => !!(data.phone || data.email), {
  message: "Email or phone number is required.",
  path: ["email"],
});

export const facultyVerifyOtpBodySchema = z.object({
  phone: z.string().trim().min(1, "Phone number is required.").max(30),
  otp: z.string().trim().regex(/^\d{6}$/, "Please enter the 6-digit OTP."),
});

export const facultyResetPasswordBodySchema = z
  .object({
    phone: z.string().trim().min(1, "Phone number is required.").max(30),
    resetToken: z.string().trim().min(16, "Reset token is required."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Confirm password is required."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match.",
  });

export const facultyEmailResetPasswordBodySchema = z
  .object({
    email: z.preprocess(emptyToNull, z.string().email().max(160)),
    otp: z.string().trim().regex(/^\d{6}$/, "Please enter the 6-digit OTP."),
    newPassword: z.string().min(8, "Password must be at least 8 characters.").max(200),
    confirmPassword: z.string().min(1, "Confirm password is required.").max(200),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match.",
  });

export const facultyStatusBodySchema = z.object({
  status: z.enum(facultyStatuses),
});
