import nodemailer from "nodemailer";

const requireEnv = (key) => {
  const value = String(process.env[key] || "").trim();
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: requireEnv("EMAIL_USER"),
    pass: requireEnv("EMAIL_PASS"),
  },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
});

export const sendOtpEmail = async (to, otp) => {
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const subject = "Your verification code";
  const text = `Your verification code is ${otp}. It expires in 5 minutes. Do not share this code with anyone.`;
  const html = `
    <p>Your verification code is <strong>${otp}</strong>.</p>
    <p>It expires in 5 minutes. Please do not share this code with anyone.</p>
  `;

  try {
    await transporter.sendMail({ from, to, subject, text, html });
  } catch (error) {
    const message = String(error?.message || "");
    const code = String(error?.code || "");
    const looksLikeSmtpNetworkIssue =
      /timeout|greeting|socket|connect|connection/i.test(message) ||
      ["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNRESET"].includes(code);

    if (looksLikeSmtpNetworkIssue) {
      console.error(
        "EMAIL DELIVERY ERROR:",
        "SMTP connection failed.",
        "If this backend runs on a Render free web service, outbound SMTP ports are blocked and Gmail SMTP will not work there."
      );
      const err = new Error("Email service unavailable. Please try again later.");
      err.status = 503;
      throw err;
    }

    console.error("EMAIL DELIVERY ERROR:", error?.message || error);
    const err = new Error("Failed to send verification email.");
    err.status = 502;
    throw err;
  }
};
