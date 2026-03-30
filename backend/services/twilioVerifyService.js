import { getTwilioClient } from "./twilioClient.js";

const digitsOnly = (value) => String(value || "").replace(/[^\d]/g, "");
const isDebug = () =>
  process.env.DEBUG_TWILIO_VERIFY === "1" || process.env.DEBUG_OTP === "1";
const shouldLogSensitive = () => process.env.NODE_ENV !== "production" || isDebug();

// Frontend sends phone without +91; backend normalizes to +91XXXXXXXXXX.
export const formatIndianPhone = (raw) => {
  const cleaned = String(raw || "").trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned.replace(/\s+/g, "");

  const digits = digitsOnly(cleaned);

  // 0XXXXXXXXXX -> +91XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith("0")) {
    return `+91${digits.slice(1)}`;
  }
  // 91XXXXXXXXXX -> +91XXXXXXXXXX
  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }
  // XXXXXXXXXX -> +91XXXXXXXXXX
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  // Fallback: best-effort, still ensure leading +
  return digits ? `+${digits}` : "";
};

const requireVerifyServiceSid = () => {
  const primary = String(process.env.TWILIO_VERIFY_SERVICE_SID || "").trim();
  if (primary) return primary;

  // Back-compat for older env naming.
  const legacy = String(process.env.TWILIO_VERIFY_SID || "").trim();
  if (legacy) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "Using legacy env var TWILIO_VERIFY_SID. Prefer TWILIO_VERIFY_SERVICE_SID."
      );
    }
    return legacy;
  }

  throw new Error("Missing TWILIO_VERIFY_SERVICE_SID");
};

export const sendOTP = async (rawPhone) => {
  const phone = formatIndianPhone(rawPhone);
  if (!/^\+91\d{10}$/.test(phone)) {
    const err = new Error("Invalid phone number. Expected Indian number (10 digits).");
    err.status = 400;
    throw err;
  }

  const client = getTwilioClient();
  const serviceSid = requireVerifyServiceSid();

  try {
    if (shouldLogSensitive()) {
      // eslint-disable-next-line no-console
      console.log("RAW PHONE:", rawPhone);
      // eslint-disable-next-line no-console
      console.log("FORMATTED PHONE:", phone);
    }
    const verification = await client.verify.v2
      .services(serviceSid)
      .verifications.create({ to: phone, channel: "sms" });
    if (shouldLogSensitive()) {
      // eslint-disable-next-line no-console
      console.log("TWILIO RESPONSE:", verification);
    }
    return { ok: true, status: verification?.status || "pending" };
  } catch (err) {
    if (shouldLogSensitive()) {
      // eslint-disable-next-line no-console
      console.error("TWILIO ERROR:", err);
    } else {
      // eslint-disable-next-line no-console
      console.error("TWILIO ERROR:", {
        name: err?.name,
        message: err?.message,
        status: err?.status,
        code: err?.code,
        moreInfo: err?.moreInfo,
      });
    }
    throw err;
  }
};

export const verifyOTP = async (rawPhone, rawCode) => {
  const phone = formatIndianPhone(rawPhone);
  const code = String(rawCode || "").trim();
  if (!/^\+91\d{10}$/.test(phone)) {
    const err = new Error("Invalid phone number. Expected Indian number (10 digits).");
    err.status = 400;
    throw err;
  }
  if (!/^\d{4,8}$/.test(code)) {
    const err = new Error("Invalid OTP code format.");
    err.status = 400;
    throw err;
  }

  const client = getTwilioClient();
  const serviceSid = requireVerifyServiceSid();

  try {
    if (shouldLogSensitive()) {
      // eslint-disable-next-line no-console
      console.log("RAW PHONE:", rawPhone);
      // eslint-disable-next-line no-console
      console.log("FORMATTED PHONE:", phone);
      // eslint-disable-next-line no-console
      console.log("OTP ENTERED:", code);
    }
    const check = await client.verify.v2
      .services(serviceSid)
      .verificationChecks.create({ to: phone, code });
    if (shouldLogSensitive()) {
      // eslint-disable-next-line no-console
      console.log("TWILIO RESPONSE:", check);
    }

    const approved = String(check?.status || "").toLowerCase() === "approved";
    return { ok: approved, status: check?.status };
  } catch (err) {
    if (shouldLogSensitive()) {
      // eslint-disable-next-line no-console
      console.error("TWILIO ERROR:", err);
    } else {
      // eslint-disable-next-line no-console
      console.error("TWILIO ERROR:", {
        name: err?.name,
        message: err?.message,
        status: err?.status,
        code: err?.code,
        moreInfo: err?.moreInfo,
      });
    }
    throw err;
  }
};
