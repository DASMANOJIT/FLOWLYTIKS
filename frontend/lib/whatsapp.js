const digitsOnly = (value) => String(value || "").replace(/\D/g, "");

export const normalizeWhatsAppNumber = (value) => {
  const digits = digitsOnly(value);

  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;

  return "";
};

export const isValidWhatsAppNumber = (value) =>
  normalizeWhatsAppNumber(value).length === 12;

export const formatWhatsAppDisplay = (value) => {
  const normalized = normalizeWhatsAppNumber(value);
  if (!normalized) return String(value || "").trim();

  const localDigits = normalized.slice(-10);
  return `+91 ${localDigits.slice(0, 5)} ${localDigits.slice(5)}`;
};

export const createWhatsAppReminderLink = ({
  number,
  studentName,
  monthName,
  amount,
  senderName,
}) => {
  const normalizedNumber = normalizeWhatsAppNumber(number);
  if (!normalizedNumber) return "";

  const message = [
    `Hello ${studentName},`,
    "",
    `This is a gentle reminder that your fee for ${monthName} is currently pending.`,
    "",
    `Amount Due: ₹${amount}`,
    "",
    "Please complete your payment through Flowlytiks:",
    "https://www.flowlytiks.in/login",
    "",
    "Thank you.",
    "",
    `- ${String(senderName || "").trim() || "Flowlytiks"}`,
  ].join("\n");

  return `https://wa.me/${normalizedNumber}?text=${encodeURIComponent(message)}`;
};
