const requireEnv = (key) => {
  const value = String(process.env[key] || "").trim();
  if (!value) {
    console.error("EMAIL DELIVERY ERROR:", `${key} is not configured.`);
    const err = new Error("Email service unavailable. Please try again later.");
    err.status = 503;
    throw err;
  }
  return value;
};

const RESEND_API_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15_000;

const buildEmailPayload = ({ from, to, otp }) => {
  const subject = "Your verification code";
  const text = `Your verification code is ${otp}. It expires in 5 minutes. Do not share this code with anyone.`;
  const html = `
    <p>Your verification code is <strong>${otp}</strong>.</p>
    <p>It expires in 5 minutes. Please do not share this code with anyone.</p>
  `;

  return {
    from,
    to: [to],
    subject,
    text,
    html,
  };
};

export const sendOtpEmail = async (to, otp) => {
  const apiKey = requireEnv("RESEND_API_KEY");
  const from = requireEnv("EMAIL_FROM");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildEmailPayload({ from, to, otp })),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      console.error(
        "EMAIL DELIVERY ERROR:",
        payload?.message || payload?.error?.message || response.statusText
      );
      const err = new Error("Failed to send verification email.");
      err.status = response.status >= 500 ? 503 : 502;
      throw err;
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      console.error(
        "EMAIL DELIVERY ERROR:",
        "Email API request timed out."
      );
      const err = new Error("Email service unavailable. Please try again later.");
      err.status = 503;
      throw err;
    }

    if (typeof error?.status === "number") {
      throw error;
    }

    console.error("EMAIL DELIVERY ERROR:", error?.message || error);
    const err = new Error("Email service unavailable. Please try again later.");
    err.status = 503;
    throw err;
  } finally {
    clearTimeout(timeout);
  }
};
