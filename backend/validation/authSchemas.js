import { z } from "zod";
import { isValidPhone } from "../utils/authValidation.js";

const emailSchema = z.string().trim().email("Please provide a valid email address.");
const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Please enter the 6-digit OTP.");
const purposeSchema = z.enum(["signup", "login", "reset", "2fa"]).optional();

const optionalTrimmedString = (max = 160) =>
  z.string().trim().max(max).optional();

const phoneSchema = z
  .string()
  .trim()
  .min(10, "WhatsApp number is required.")
  .max(24, "Please enter a valid WhatsApp number.")
  .refine((value) => isValidPhone(value), "Please enter a valid WhatsApp number.");

const optionalPhoneSchema = z
  .string()
  .trim()
  .max(24, "Please enter a valid WhatsApp number.")
  .optional()
  .refine((value) => !value || isValidPhone(value), "Please enter a valid WhatsApp number.");

export const sendOtpBodySchema = z.object({
  email: emailSchema,
  purpose: purposeSchema,
  name: optionalTrimmedString(120),
  phone: optionalPhoneSchema,
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
  phone: phoneSchema,
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

export const adminResetSendOtpBodySchema = z.object({
  email: emailSchema,
});

export const adminResetPasswordBodySchema = z
  .object({
    email: emailSchema,
    otp: otpSchema,
    newPassword: z.string().min(8, "Password must be at least 8 characters.").max(200),
    confirmPassword: z.string().min(1, "Confirm password is required.").max(200),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match.",
  });
