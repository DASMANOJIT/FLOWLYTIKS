import { z } from "zod";

const emailSchema = z.string().trim().email("Please provide a valid email address.");
const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Please enter the 6-digit OTP.");
const purposeSchema = z.enum(["signup", "login", "reset", "2fa"]).optional();

const optionalTrimmedString = (max = 160) =>
  z.string().trim().max(max).optional();

export const sendOtpBodySchema = z.object({
  email: emailSchema,
  purpose: purposeSchema,
  name: optionalTrimmedString(120),
  phone: optionalTrimmedString(20),
  password: optionalTrimmedString(200),
  school: optionalTrimmedString(160),
  customSchool: optionalTrimmedString(160),
  class: z.union([z.string().trim(), z.number()]).optional(),
});

export const verifyOtpBodySchema = z.object({
  email: emailSchema,
  otp: otpSchema,
  purpose: purposeSchema,
});

export const signupBodySchema = z.object({
  name: z.string().trim().min(1, "Full name is required.").max(120),
  email: emailSchema,
  phone: z.string().trim().min(10, "Please enter a valid phone number.").max(20),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  school: z.string().trim().min(1, "School is required.").max(160),
  customSchool: optionalTrimmedString(160),
  class: z.union([z.string().trim(), z.number()]),
  otp: otpSchema,
  role: optionalTrimmedString(40),
});

export const registerBodySchema = signupBodySchema.omit({ otp: true });

export const loginBodySchema = z.object({
  email: emailSchema,
  password: optionalTrimmedString(200),
  otp: optionalTrimmedString(12),
});

export const twoFactorBodySchema = z.object({
  email: emailSchema,
  otp: otpSchema,
});

export const resetPasswordBodySchema = z.object({
  email: emailSchema,
  otp: otpSchema,
  newPassword: z.string().min(8, "Password must be at least 8 characters.").max(200),
});
