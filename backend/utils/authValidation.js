import { digitsOnly, formatIndianPhone, isValidIndianPhone } from "./phone.js";

const collapseWhitespace = (value) => String(value || "").replace(/\s+/g, " ").trim();

export const normalizeEmail = (value) => collapseWhitespace(value).toLowerCase();

export const isValidEmail = (value) => {
  const normalized = normalizeEmail(value);
  return (
    normalized.length >= 5 &&
    normalized.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  );
};

export const normalizeName = (value) => collapseWhitespace(value);

export const isValidName = (value) => {
  const normalized = normalizeName(value);
  return normalized.length >= 2 && normalized.length <= 80;
};

export const normalizeSchoolText = (value) => collapseWhitespace(value);

export const isValidSchoolText = (value) => {
  const normalized = normalizeSchoolText(value);
  return normalized.length >= 2 && normalized.length <= 120;
};

export const resolveSchoolValue = ({ school, customSchool }) => {
  const normalizedSchool = normalizeSchoolText(school);
  if (normalizedSchool.toLowerCase() === "other") {
    return normalizeSchoolText(customSchool);
  }
  return normalizedSchool;
};

export const parseStudentClass = (value) => {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isInteger(parsed) ? parsed : NaN;
};

export const isValidStudentClass = (value) => {
  const parsed = typeof value === "number" ? value : parseStudentClass(value);
  return Number.isInteger(parsed) && parsed >= 3 && parsed <= 12;
};

export const normalizePhone = (value) => formatIndianPhone(value);

export const isValidPhone = (value) => isValidIndianPhone(normalizePhone(value));

export const getPhoneSearchCandidates = (value) => {
  const raw = String(value || "").trim();
  const normalized = normalizePhone(raw);
  const digits = digitsOnly(raw);
  const values = [
    raw,
    normalized,
    digits,
    digits ? `+${digits}` : "",
    digits.length === 10 ? `+91${digits}` : "",
    digits.length === 12 && digits.startsWith("91") ? `+${digits}` : "",
  ];

  return [...new Set(values.filter(Boolean))];
};

export const isStrongPassword = (password) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,72}$/.test(
    String(password || "")
  );

export const normalizeOtp = (value) => String(value || "").replace(/\s+/g, "");

export const isValidOtp = (value) => /^\d{6}$/.test(normalizeOtp(value));
