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
});

export const sendOtpEmail = async (to, otp) => {
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const subject = "Your verification code";
  const text = `Your verification code is ${otp}. It expires in 5 minutes. Do not share this code with anyone.`;
  const html = `
    <p>Your verification code is <strong>${otp}</strong>.</p>
    <p>It expires in 5 minutes. Please do not share this code with anyone.</p>
  `;
  await transporter.sendMail({ from, to, subject, text, html });
};
