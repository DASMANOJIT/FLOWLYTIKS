"use client";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { MotionButton } from "../components/motion/primitives.jsx";
import { getApiBaseUrl, readApiResponse } from "../../lib/api.js";
import styles from "./StaffPasswordReset.module.css";

export default function StaffPasswordReset({ initialEmail, onBack, onComplete }) {
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState(initialEmail || "");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const perform = async (action) => {
    if (request.current || (action === "send-code" && cooldown)) return;
    if (action === "save" && password !== confirmation) { setError("Passwords do not match."); return; }
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setMessage("");
    try {
      const body = action === "send-code" ? { email } : action === "verify" ? { email, code } : { email, resetToken, newPassword: password, confirmPassword: confirmation };
      const response = await fetch(`${getApiBaseUrl()}/api/staff/password-reset/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const result = await readApiResponse(response, "Staff password reset could not complete.");
      if (!result.ok) { if (result.data?.retryAfter) setCooldown(Number(result.data.retryAfter)); throw new Error(result.error); }
      if (controller.signal.aborted) return;
      if (action === "send-code") { setCode(""); setResetToken(""); setStep("code"); setCooldown(result.data.cooldown || 15); setMessage(result.data.message); }
      else if (action === "verify") {
        if (!result.data.resetToken) throw new Error("Verification did not complete. Please try again.");
        setResetToken(result.data.resetToken); setStep("password"); setMessage(result.data.message);
      } else onComplete(email, result.data.message);
    } catch (error) { if (!controller.signal.aborted) setError(error.message || "Unable to reset password."); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  };
  return <form className={`card-form forgot-side ${styles.form}`} onSubmit={event => { event.preventDefault(); void perform(step === "email" ? "send-code" : step === "code" ? "verify" : "save"); }}>
    <h2>Reset Staff Password</h2>
    <input type="email" required aria-label="Staff reset email" autoComplete="email" className="form-input" placeholder="Email" value={email} disabled={busy || step !== "email"} onChange={event => setEmail(event.target.value)} />
    {step === "code" && <input type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} aria-label="Staff verification code" className="form-input" placeholder="Six-digit verification code" value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />}
    {step === "password" && <>
      <div className="password-field"><input type={show ? "text" : "password"} required minLength={8} maxLength={72} autoComplete="new-password" aria-label="New Staff password" className="form-input" placeholder="New password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /><button type="button" className="eye-btn" aria-label={show ? "Hide new password" : "Show new password"} onClick={() => setShow(value => !value)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
      <input type={show ? "text" : "password"} required autoComplete="new-password" aria-label="Confirm Staff password" className="form-input" placeholder="Confirm password" value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} />
      <p className={styles.message}>Use 8–72 characters with uppercase, lowercase, a number and a special character.</p>
    </>}
    {error && <p className={styles.message} role="alert">{error}</p>}{message && <p className={styles.message} role="status">{message}</p>}
    <MotionButton className="form-btn" disabled={busy}>{busy ? "Please wait..." : step === "email" ? "Send verification code" : step === "code" ? "Verify code" : "Save password"}</MotionButton>
    {step === "code" && <button type="button" className={styles.link} disabled={busy || cooldown > 0} onClick={() => void perform("send-code")}>{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}</button>}
    <button type="button" className={styles.link} disabled={busy} onClick={onBack}>Back to Staff Login</button>
  </form>;
}
