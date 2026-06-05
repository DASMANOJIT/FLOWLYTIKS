"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { readApiResponse } from "../../../lib/api.js";
import { storeAuthSession } from "../../../lib/authStorage.js";
import "../../admin/faculty/faculty.css";

export default function FacultyLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot" | "verify" | "reset">("login");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const submitLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setFeedback(null);
    try {
  const payload: { email?: string; phone?: string; password: string } = { password };
  if (email && email.trim()) payload.email = email.trim();
  else payload.phone = phone;
      const res = await fetch("/api/faculty/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const { ok, data, error } = await readApiResponse(res, "Faculty login failed.");
      if (!ok) {
        setFeedback({ type: "error", message: error });
        return;
      }
  storeAuthSession({ token: data.token, role: "faculty", name: data.name });
      router.push("/faculty/dashboard");
    } finally {
      setLoading(false);
    }
  };

  const sendOtp = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/faculty-auth/forgot-password/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const { ok, error, data } = await readApiResponse(res, "Failed to send OTP.");
      if (!ok) {
        setFeedback({ type: "error", message: error });
        return;
      }
      setFeedback({ type: "success", message: data.message || "OTP sent." });
      setMode("verify");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/faculty-auth/forgot-password/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      });
      const { ok, error, data } = await readApiResponse(res, "Failed to verify OTP.");
      if (!ok) {
        setFeedback({ type: "error", message: error });
        return;
      }
      setResetToken(data.resetToken || "");
      setFeedback({ type: "success", message: data.message || "OTP verified." });
      setMode("reset");
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/faculty-auth/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, resetToken, password: newPassword, confirmPassword }),
      });
      const { ok, error, data } = await readApiResponse(res, "Failed to reset password.");
      if (!ok) {
        setFeedback({ type: "error", message: error });
        return;
      }
      setFeedback({ type: "success", message: data.message || "Password reset successfully." });
      setMode("login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <section className="faculty-panel faculty-modal--confirm">
          <div className="faculty-title-block">
            <h1>Faculty Login</h1>
            <p>Login with the email and password created by admin.</p>
          </div>
          {feedback ? <div className={`faculty-toast--${feedback.type}`}>{feedback.message}</div> : null}
          {mode === "login" ? (
            <form className="faculty-form" onSubmit={submitLogin}>
              <div className="faculty-field">
                <label>Email</label>
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="faculty@example.com" />
              </div>
              <div className="faculty-field">
                <label>Phone Number fallback</label>
                <input value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
              <div className="faculty-field">
                <label>Password</label>
                <div className="faculty-password-field">
                  <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} />
                  <button type="button" className="faculty-icon-button" onClick={() => setShowPassword((value) => !value)}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <button className="faculty-button faculty-button--primary" disabled={loading}>Login</button>
              <button type="button" className="faculty-button faculty-button--ghost" onClick={() => setMode("forgot")}>Forgot Password</button>
            </form>
          ) : (
            <div className="faculty-form">
              <div className="faculty-field">
                <label>Registered Phone Number</label>
                <input value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
              {mode === "forgot" ? <button className="faculty-button faculty-button--primary" onClick={sendOtp} disabled={loading}>Send OTP</button> : null}
              {mode === "verify" ? (
                <>
                  <div className="faculty-field">
                    <label>OTP</label>
                    <input value={otp} onChange={(event) => setOtp(event.target.value)} maxLength={6} />
                  </div>
                  <button className="faculty-button faculty-button--primary" onClick={verifyOtp} disabled={loading}>Verify OTP</button>
                  <button className="faculty-button faculty-button--ghost" onClick={sendOtp} disabled={loading}>Resend OTP</button>
                </>
              ) : null}
              {mode === "reset" ? (
                <>
                  <div className="faculty-field">
                    <label>New Password</label>
                    <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                  </div>
                  <div className="faculty-field">
                    <label>Confirm New Password</label>
                    <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                  </div>
                  <button className="faculty-button faculty-button--primary" onClick={resetPassword} disabled={loading}>Reset Password</button>
                </>
              ) : null}
              <button className="faculty-button faculty-button--ghost" onClick={() => setMode("login")}>Back to Login</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
