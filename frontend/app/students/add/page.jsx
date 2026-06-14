"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./page.css";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import {
  MotionButton,
  MotionCard,
  MotionSection,
} from "../../components/motion/primitives.jsx";
import { getApiBaseUrl, readApiResponse } from "../../../lib/api.js";
import {
  clearAuthSession,
  getAuthRole,
  getAuthToken,
} from "../../../lib/authStorage.js";
import {
  CLASS_OPTIONS,
  SCHOOL_OPTIONS,
  SCHOOL_OTHER_VALUE,
} from "../../../lib/studentOptions.js";
import { isValidWhatsAppNumber } from "../../../lib/whatsapp.js";

const API_BASE = getApiBaseUrl();
const OTP_RESEND_COOLDOWN_SECONDS = 15;

const isStrongPassword = (password) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(
    String(password || "")
  );

const isValidPhone = (phone) => isValidWhatsAppNumber(phone);

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());

const getValidationMessage = ({
  name,
  school,
  customSchool,
  studentClass,
  phone,
  email,
  password,
}) => {
  if (!String(name || "").trim()) return "Full name is required.";
  if (!school) return "School is required.";
  if (school === SCHOOL_OTHER_VALUE && !String(customSchool || "").trim()) {
    return "Please enter the school name.";
  }
  if (!studentClass) return "Class is required.";
  if (!String(phone || "").trim()) return "WhatsApp number is required.";
  if (!isValidPhone(phone)) return "Please enter a valid WhatsApp number.";
  if (!String(email || "").trim()) return "Email is required.";
  if (!isValidEmail(email)) return "Please enter a valid email address.";
  if (!String(password || "").trim()) return "Password is required.";
  if (!isStrongPassword(password)) {
    return "Password must be 8+ chars with uppercase, lowercase, number, and special character.";
  }
  return "";
};

export default function AddStudentPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [submittingOtp, setSubmittingOtp] = useState(false);
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otp, setOtp] = useState("");
  const [feedback, setFeedback] = useState(null);

  const [name, setName] = useState("");
  const [school, setSchool] = useState("");
  const [customSchool, setCustomSchool] = useState("");
  const [studentClass, setStudentClass] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    const role = getAuthRole();
    if (!token) {
      router.push("/login");
      return;
    }
    if (role && role !== "admin") {
      clearAuthSession();
      router.push("/login");
      return;
    }
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (otpCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setOtpCooldown((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [otpCooldown]);

  const passwordChecks = useMemo(
    () => ({
      minLen: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /\d/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    }),
    [password]
  );

  const buildPayload = () => ({
    name: name.trim(),
    school,
    customSchool: customSchool.trim(),
    class: studentClass,
    phone: phone.trim(),
    email: email.trim(),
    password,
  });

  const resetOtpState = () => {
    setOtpSent(false);
    setOtp("");
    setOtpCooldown(0);
  };

  const setFeedbackMessage = (type, message) => {
    setFeedback({ type, message });
  };

  const handleSendOtp = async () => {
    if (submittingOtp || creatingStudent) return;
    if (otpCooldown > 0) {
      setFeedbackMessage("error", `Please wait ${otpCooldown}s before resending OTP.`);
      return;
    }

    const payload = buildPayload();
    const validationMessage = getValidationMessage({
      ...payload,
      studentClass: payload.class,
    });
    if (validationMessage) {
      setFeedbackMessage("error", validationMessage);
      return;
    }

    setSubmittingOtp(true);
    setFeedback(null);

    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/students/send-create-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const { ok, data, error } = await readApiResponse(
        res,
        "Failed to send OTP. Please try again."
      );

      if (!ok) {
        if (res.status === 401 || res.status === 403) {
          clearAuthSession();
          router.push("/login");
          return;
        }
        if (data?.retryAfter) {
          setOtpCooldown(Number(data.retryAfter) || OTP_RESEND_COOLDOWN_SECONDS);
        }
        setFeedbackMessage("error", error);
        return;
      }

      setOtpSent(true);
      setOtpCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      setFeedbackMessage(
        "success",
        data?.maskedEmail
          ? `OTP sent successfully to ${data.maskedEmail}.`
          : "OTP sent successfully."
      );
    } catch (error) {
      console.error("Admin add-student send OTP error:", error);
      setFeedbackMessage("error", "Cannot connect to backend.");
    } finally {
      setSubmittingOtp(false);
    }
  };

  const handleVerifyAndCreate = async (event) => {
    event.preventDefault();
    if (creatingStudent || submittingOtp) return;

    const payload = buildPayload();
    const validationMessage = getValidationMessage({
      ...payload,
      studentClass: payload.class,
    });
    if (validationMessage) {
      setFeedbackMessage("error", validationMessage);
      return;
    }

    if (!otpSent) {
      setFeedbackMessage("error", "Send OTP first.");
      return;
    }

    if (!/^\d{6}$/.test(String(otp || "").trim())) {
      setFeedbackMessage("error", "Please enter the 6-digit OTP.");
      return;
    }

    setCreatingStudent(true);
    setFeedback(null);

    try {
      const token = getAuthToken();
      const res = await fetch(`${API_BASE}/api/students/verify-create-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...payload,
          otp: otp.trim(),
        }),
      });

      const { ok, data, error } = await readApiResponse(
        res,
        "Student creation failed. Please try again."
      );

      if (!ok) {
        if (res.status === 401 || res.status === 403) {
          clearAuthSession();
          router.push("/login");
          return;
        }
        setFeedbackMessage("error", error);
        return;
      }

      setFeedbackMessage("success", data?.message || "Student account created successfully.");
      window.setTimeout(() => {
        router.push("/students");
      }, 1200);
    } catch (error) {
      console.error("Admin add-student create error:", error);
      setFeedbackMessage("error", "Cannot connect to backend.");
    } finally {
      setCreatingStudent(false);
    }
  };

  if (!ready) {
    return <PremiumLoader fullScreen label="Loading add student page" />;
  }

  return (
    <MotionSection
      className="add-student-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="add-student-shell">
        <Link href="/students" className="add-student-back">
          ← Back to Students
        </Link>

        <MotionCard className="add-student-card" hover={false}>
          <div className="add-student-header">
            <h1>Add Student</h1>
            <p>
              Create a student account with the same signup details used in the
              student registration flow. OTP verification is required before the
              account is created.
            </p>
          </div>

          <form className="add-student-form" onSubmit={handleVerifyAndCreate}>
            <label className="add-student-field">
              <span>Full Name</span>
              <input
                type="text"
                value={name}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>

            <label className="add-student-field">
              <span>School</span>
              <select
                value={school}
                onChange={(event) => {
                  const value = event.target.value;
                  setSchool(value);
                  if (value !== SCHOOL_OTHER_VALUE) {
                    setCustomSchool("");
                  }
                }}
                required
              >
                <option value="">Select School</option>
                {SCHOOL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value={SCHOOL_OTHER_VALUE}>Other</option>
              </select>
            </label>

            {school === SCHOOL_OTHER_VALUE ? (
              <label className="add-student-field">
                <span>Custom School</span>
                <input
                  type="text"
                  value={customSchool}
                  autoComplete="organization"
                  onChange={(event) => setCustomSchool(event.target.value)}
                  required
                />
              </label>
            ) : null}

            <label className="add-student-field">
              <span>Class</span>
              <select
                value={studentClass}
                onChange={(event) => setStudentClass(event.target.value)}
                required
              >
                <option value="">Select Class</option>
                {CLASS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="add-student-field">
              <span>WhatsApp Number</span>
              <input
                type="tel"
                value={phone}
                autoComplete="tel"
                inputMode="tel"
                placeholder="Enter WhatsApp number"
                onChange={(event) => setPhone(event.target.value)}
                required
              />
              <p className="add-student-field-help">
                This number will be used by the institute for payment reminders. No WhatsApp
                verification is required.
              </p>
            </label>

            <label className="add-student-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                autoComplete="email"
                inputMode="email"
                onChange={(event) => {
                  setEmail(event.target.value);
                  resetOtpState();
                }}
                required
              />
            </label>

            <label className="add-student-field">
              <span>Password</span>
              <div className="add-student-password">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  className="add-student-eye-btn"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "🙈" : "👁"}
                </button>
              </div>
            </label>

            <p className="add-student-password-rules">
              {passwordChecks.minLen ? "✓" : "•"} 8+ chars |{" "}
              {passwordChecks.upper ? "✓" : "•"} uppercase |{" "}
              {passwordChecks.lower ? "✓" : "•"} lowercase |{" "}
              {passwordChecks.number ? "✓" : "•"} number |{" "}
              {passwordChecks.special ? "✓" : "•"} special
            </p>

            <div className="add-student-actions">
              <MotionButton
                type="button"
                className="add-student-action-btn add-student-action-btn--secondary"
                onClick={handleSendOtp}
                disabled={submittingOtp || creatingStudent || otpCooldown > 0}
              >
                {submittingOtp
                  ? "Sending OTP..."
                  : otpCooldown > 0
                  ? `Resend OTP in ${otpCooldown}s`
                  : otpSent
                  ? "Resend OTP"
                  : "Send OTP"}
              </MotionButton>
            </div>

            {otpSent ? (
              <div className="add-student-otp-box">
                <label className="add-student-field">
                  <span>Enter OTP</span>
                  <input
                    type="text"
                    value={otp}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    onChange={(event) => setOtp(event.target.value)}
                    required
                  />
                </label>
              </div>
            ) : null}

            {feedback ? (
              <div
                className={`add-student-feedback add-student-feedback--${feedback.type}`}
              >
                {feedback.message}
              </div>
            ) : null}

            <MotionButton
              className="add-student-action-btn add-student-action-btn--primary"
              disabled={
                creatingStudent ||
                submittingOtp ||
                !otpSent ||
                !isStrongPassword(password)
              }
            >
              {creatingStudent ? "Verifying & Creating..." : "Verify & Create Student"}
            </MotionButton>
          </form>
        </MotionCard>
      </div>
    </MotionSection>
  );
}
