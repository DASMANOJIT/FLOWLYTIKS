export const digitsOnly = (value) => String(value || "").replace(/[^\d]/g, "");

export const formatIndianPhone = (raw) => {
  const cleaned = String(raw || "").trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) {
    return cleaned.replace(/\s+/g, "");
  }
  const digits = digitsOnly(cleaned);
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) {
    return `+91${digits.slice(1)}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  return digits ? `+${digits}` : "";
};

export const isValidIndianPhone = (phone) => /^\+91\d{10}$/.test(String(phone || "").trim());

export const maskPhone = (phone) => {
  if (!phone || phone.length < 6) return "***";
  return `${phone.slice(0, 3)}***${phone.slice(-2)}`;
};
