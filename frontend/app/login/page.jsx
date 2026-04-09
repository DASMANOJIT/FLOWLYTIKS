"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./login.css";
import Fall from "../animation/fallingword.jsx";
import { MotionButton } from "../components/motion/primitives.jsx";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { readApiResponse } from "../../lib/api.js";

export default function Login() {
  const OTP_RESEND_COOLDOWN_SECONDS = 15;
  const debugRenders = process.env.NEXT_PUBLIC_RENDER_DEBUG === "1";
  const renderCount = useRef(0);
  const warned = useRef(false);

  useEffect(() => {
    if (!debugRenders) return;

    renderCount.current += 1;
    const c = renderCount.current;

    if (c === 1 || c === 2 || c === 3 || c === 5 || c === 10 || c === 20 || c % 50 === 0) {
      // Avoid logging any secrets (OTP/password); only log the count.
      console.log("[render] app/login", c);
    }

    if (!warned.current && c > 20) {
      warned.current = true;
      console.warn("⚠️ Excessive renders detected in app/login:", c);
    }
  });

  const [activeForm, setActiveForm] = useState("login");
  const [forgotOtpSent, setForgotOtpSent] = useState(false);
  const [forgotOtpInput, setForgotOtpInput] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotCooldown, setForgotCooldown] = useState(0);

  const [signupOtpSent, setSignupOtpSent] = useState(false);
  const [signupOtpInput, setSignupOtpInput] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupOtpVerified, setSignupOtpVerified] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupCooldown, setSignupCooldown] = useState(0);
  const [signupName, setSignupName] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupSchool, setSignupSchool] = useState("");
  const [signupCustomSchool, setSignupCustomSchool] = useState("");
  const [signupClass, setSignupClass] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [loginMode, setLoginMode] = useState("password"); // password | otp
  const [otpLoginEmail, setOtpLoginEmail] = useState("");
  const [otpLoginSent, setOtpLoginSent] = useState(false);
  const [otpLoginOtp, setOtpLoginOtp] = useState("");
  const [otpLoginLoading, setOtpLoginLoading] = useState(false);
  const [otpLoginCooldown, setOtpLoginCooldown] = useState(0);

  const [twoFaRequired, setTwoFaRequired] = useState(false);
  const [twoFaEmail, setTwoFaEmail] = useState("");
  const [twoFaOtp, setTwoFaOtp] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);

  // Use same-origin `/api/*` (Next.js rewrites proxy to backend).
  const API = "";

  const isStrongPassword = (password) =>
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(
      String(password || "")
    );

  const isValidPhone = (phone) =>
    /^\+?\d{10,15}$/.test(String(phone || "").trim());

  const isValidEmail = (email) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());

  const resetSignupVerificationState = () => {
    setSignupOtpSent(false);
    setSignupOtpInput("");
    setSignupOtpVerified(false);
    setSignupCooldown(0);
  };

  const getSignupFormValues = () => {
    const form = document.querySelector("form.card-form.signup-side");

    return {
      name: (signupName || form?.querySelector('input[name="name"]')?.value || "").trim(),
      school: signupSchool || form?.querySelector('select[name="school"]')?.value || "",
      customSchool:
        signupCustomSchool || form?.querySelector('input[name="customSchool"]')?.value || "",
      studentClass: signupClass || form?.querySelector('select[name="class"]')?.value || "",
      phone: (signupPhone || form?.querySelector('input[name="phone"]')?.value || "").trim(),
      email: (signupEmail || form?.querySelector('input[name="email"]')?.value || "").trim(),
      password: signupPassword || form?.querySelector('input[name="password"]')?.value || "",
    };
  };

  const getSignupValidationMessage = ({
    name,
    school,
    customSchool,
    studentClass,
    phone,
    email,
    password,
  }) => {
    if (!name) return "Full name is required.";
    if (!school) return "School is required.";
    if (school === "other" && !String(customSchool || "").trim()) {
      return "Please enter your school name.";
    }
    if (!studentClass) return "Class is required.";
    if (!phone) return "Phone number is required.";
    if (!isValidPhone(phone)) return "Please enter a valid phone number.";
    if (!email) return "Email is required.";
    if (!isValidEmail(email)) return "Please enter a valid email address.";
    if (!password) return "Password is required.";
    if (!isStrongPassword(password)) {
      return "Password must be 8+ chars with uppercase, lowercase, number, and special character.";
    }
    return "";
  };

  useEffect(() => {
    if (signupCooldown <= 0) return;
    const timer = setTimeout(() => setSignupCooldown((prev) => Math.max(prev - 1, 0)), 1000);
    return () => clearTimeout(timer);
  }, [signupCooldown]);

  useEffect(() => {
    if (forgotCooldown <= 0) return;
    const timer = setTimeout(() => setForgotCooldown((prev) => Math.max(prev - 1, 0)), 1000);
    return () => clearTimeout(timer);
  }, [forgotCooldown]);

  useEffect(() => {
    if (otpLoginCooldown <= 0) return;
    const timer = setTimeout(() => setOtpLoginCooldown((prev) => Math.max(prev - 1, 0)), 1000);
    return () => clearTimeout(timer);
  }, [otpLoginCooldown]);

  const passwordChecks = {
    minLen: signupPassword.length >= 8,
    upper: /[A-Z]/.test(signupPassword),
    lower: /[a-z]/.test(signupPassword),
    number: /\d/.test(signupPassword),
    special: /[^A-Za-z0-9]/.test(signupPassword),
  };

  const renderLoadingLabel = (label) => (
    <span className="button-loading-content">
      <PremiumLoader inline compact />
      <span>{label}</span>
    </span>
  );

  const buildSignupPayload = (signupValues) => {
    return {
      name: signupValues.name,
      email: signupValues.email,
      phone: signupValues.phone,
      password: signupValues.password,
      school: signupValues.school,
      customSchool: signupValues.customSchool,
      class: signupValues.studentClass,
      otp: signupOtpInput.trim(),
    };
  };

  const handleSignupSuccess = (data) => {
    localStorage.setItem("token", data.token);
    localStorage.setItem("studentName", data.name);
    alert("Registered successfully!");
    resetSignupVerificationState();
    window.location.href = "/student";
  };

  const submitSignup = async (signupValues) => {
    const res = await fetch(`${API}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSignupPayload(signupValues)),
    });
    const { ok, data, error } = await readApiResponse(
      res,
      "Signup failed. Please try again."
    );

    if (!ok) {
      return alert(error);
    }

    setSignupOtpVerified(true);
    handleSignupSuccess(data);
  };

  // =====================
  // LOGIN
  // =====================
  const handlePasswordLogin = async (e) => {
    e.preventDefault();

    const email = loginEmail.trim();
    const password = loginPassword;

    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const { ok, data, error } = await readApiResponse(
        res,
        "Login failed. Please try again."
      );
      if (!ok) return alert(error);

      if (data.requires2fa) {
        setTwoFaRequired(true);
        setTwoFaEmail(email);
        setTwoFaOtp("");
        return;
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("studentName", data.name);

      if (data.role === "admin") {
        window.location.href = "/admin";
      } else {
        window.location.href = "/student";
      }
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    }
  };

  // =====================
  // SIGNUP OTP
  // =====================
  const sendSignupOtp = async () => {
    if (signupLoading) return;
    if (signupCooldown > 0) {
      return alert(`Please wait ${signupCooldown}s before resending OTP.`);
    }

    const signupValues = getSignupFormValues();
    const validationMessage = getSignupValidationMessage(signupValues);
    if (validationMessage) {
      alert(validationMessage);
      return;
    }

    setSignupLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: signupValues.email,
          purpose: "signup",
          name: signupValues.name,
          school: signupValues.school,
          customSchool: signupValues.customSchool,
          class: signupValues.studentClass,
          phone: signupValues.phone,
          password: signupValues.password,
        }),
      });
      const { ok, data, error } = await readApiResponse(
        res,
        "Failed to send OTP. Please try again."
      );
      if (!ok) {
        if (data?.retryAfter) {
          setSignupCooldown(Number(data.retryAfter));
        }
        return alert(error);
      }

      setSignupOtpSent(true);
      setSignupOtpVerified(false);
      setSignupCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      alert("OTP sent to your email.");
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setSignupLoading(false);
    }
  };

  const verifySignupOtp = async () => {
    if (signupLoading) return;
    if (!signupOtpSent) return alert("Send OTP first.");

    const signupValues = getSignupFormValues();
    const validationMessage = getSignupValidationMessage(signupValues);
    if (validationMessage) {
      return alert(validationMessage);
    }
    if (!/^\d{6}$/.test(String(signupOtpInput || "").trim())) {
      return alert("Please enter the 6-digit OTP.");
    }

    setSignupLoading(true);
    try {
      await submitSignup(signupValues);
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setSignupLoading(false);
    }
  };

  // =====================
  // REGISTER (ROLE-AWARE, OTP VERIFIED)
  // =====================
  const handleRegister = async (e) => {
    e.preventDefault();

    const signupValues = getSignupFormValues();
    const validationMessage = getSignupValidationMessage(signupValues);
    if (validationMessage) return alert(validationMessage);

    if (!signupOtpVerified) {
      return alert("Please verify your email with OTP before signing up.");
    }

    if (!/^\d{6}$/.test(String(signupOtpInput || "").trim())) {
      return alert("Please enter the 6-digit OTP.");
    }
    if (!isValidPhone(signupValues.phone)) {
      return alert("Please enter a valid phone number.");
    }

    setSignupLoading(true);
    try {
      await submitSignup(signupValues);
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setSignupLoading(false);
    }
  };

  // =====================
  // FORGOT OTP
  // =====================
  const sendForgotOtp = async () => {
    if (forgotLoading) return;
    if (forgotCooldown > 0) {
      return alert(`Please wait ${forgotCooldown}s before resending OTP.`);
    }
    if (!isValidEmail(forgotEmail)) {
      alert("Please enter a valid email address before OTP.");
      return;
    }

    setForgotLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail, purpose: "reset" }),
      });
      const { ok, data, error } = await readApiResponse(
        res,
        "Failed to send OTP. Please try again."
      );
      if (!ok) {
        if (data?.retryAfter) {
          setForgotCooldown(Number(data.retryAfter));
        }
        return alert(error);
      }
      setForgotOtpSent(true);
      setForgotCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      alert("OTP sent to your email.");
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setForgotLoading(false);
    }
  };

  // =====================
  // RESET PASSWORD
  // =====================
  const handleResetPassword = async (e) => {
    e.preventDefault();

    const email = forgotEmail || e.target.email?.value;
    const newPassword = forgotNewPassword;

    if (!isValidEmail(email)) {
      return alert("Please enter a valid email address before resetting password.");
    }

    if (!forgotOtpSent) {
      return alert("Please send OTP first.");
    }
    if (!isStrongPassword(newPassword)) {
      return alert(
        "Password must be 8+ chars with uppercase, lowercase, number, and special character."
      );
    }

    if (!/^\d{6}$/.test(String(forgotOtpInput || "").trim())) {
      return alert("Please enter the 6-digit OTP.");
    }

    setForgotLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          otp: forgotOtpInput.trim(),
          newPassword,
        }),
      });
      const { ok, error } = await readApiResponse(
        res,
        "Password reset failed. Please try again."
      );
      if (!ok) return alert(error);

      alert("Password reset successfully!");
      setForgotOtpSent(false);
      setForgotOtpInput("");
      setForgotEmail("");
      setForgotNewPassword("");
      setForgotCooldown(0);
      setActiveForm("login");
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setForgotLoading(false);
    }
  };

  // =====================
  // OTP LOGIN (PASSWORDLESS)
  // =====================
  const sendLoginOtp = async () => {
    if (otpLoginLoading) return;
    if (otpLoginCooldown > 0) {
      return alert(`Please wait ${otpLoginCooldown}s before resending OTP.`);
    }
    if (!isValidEmail(otpLoginEmail)) {
      alert("Please enter a valid email before OTP.");
      return;
    }

    setOtpLoginLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: otpLoginEmail, purpose: "login" }),
      });
      const { ok, data, error } = await readApiResponse(
        res,
        "Failed to send OTP. Please try again."
      );
      if (!ok) {
        if (data?.retryAfter) {
          setOtpLoginCooldown(Number(data.retryAfter));
        }
        return alert(error);
      }

      setOtpLoginSent(true);
      setOtpLoginCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      alert("OTP sent to your email.");
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setOtpLoginLoading(false);
    }
  };

  const verifyOtpLogin = async () => {
    if (otpLoginLoading) return;
    if (!otpLoginSent) return alert("Send OTP first.");
    if (!/^\d{6}$/.test(String(otpLoginOtp || "").trim())) {
      return alert("Please enter the 6-digit OTP.");
    }

    setOtpLoginLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: otpLoginEmail, otp: otpLoginOtp.trim() }),
      });
      const { ok, data, error } = await readApiResponse(
        res,
        "Login failed. Please try again."
      );
      if (!ok) return alert(error);

      localStorage.setItem("token", data.token);
      localStorage.setItem("studentName", data.name);
      window.location.href = "/student";
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setOtpLoginLoading(false);
    }
  };

  // =====================
  // 2FA VERIFY
  // =====================
  const verifyTwoFactorOtp = async () => {
    if (twoFaLoading) return;
    if (!/^\d{6}$/.test(String(twoFaOtp || "").trim())) {
      return alert("Please enter the 6-digit OTP.");
    }

    setTwoFaLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/2fa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: twoFaEmail, otp: twoFaOtp.trim() }),
      });
      const { ok, data, error } = await readApiResponse(
        res,
        "OTP verification failed. Please try again."
      );
      if (!ok) return alert(error);

      localStorage.setItem("token", data.token);
      localStorage.setItem("studentName", data.name);
      setTwoFaRequired(false);
      setTwoFaEmail("");
      setTwoFaOtp("");
      window.location.href = "/student";
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setTwoFaLoading(false);
    }
  };

  return (
    <div className="login-container">
      <Fall />

      <motion.header
        className="login-header"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1>
          WELCOME TO THE <br /> SUBHO&apos;S COMPUTER INSTITUTE
        </h1>
        <p className="login-subtitle">
          Secure student access with a modern experience.
        </p>
      </motion.header>

      <motion.div
        className="auth-shell"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
      >
        <div className={`card-wrapper ${activeForm}`}>
          <div className="auth-switch">
            <MotionButton
              type="button"
              className={`switch-btn ${activeForm === "login" ? "active" : ""}`}
              onClick={() => setActiveForm("login")}
            >
              Login
            </MotionButton>
            <MotionButton
              type="button"
              className={`switch-btn ${activeForm === "signup" ? "active" : ""}`}
              onClick={() => setActiveForm("signup")}
            >
              Sign Up
            </MotionButton>
            <MotionButton
              type="button"
              className={`switch-btn ${activeForm === "forgot" ? "active" : ""}`}
              onClick={() => setActiveForm("forgot")}
            >
              Reset
            </MotionButton>
          </div>

          {/* LOGIN */}
          <form
            className="card-form login-side"
            onSubmit={(e) => {
              if (twoFaRequired || loginMode !== "password") {
                e.preventDefault();
                return;
              }
              handlePasswordLogin(e);
            }}
          >
            <h2>{twoFaRequired ? "Verify OTP" : loginMode === "otp" ? "Login with OTP" : "Login"}</h2>

            {twoFaRequired ? (
              <>
                <input
                  placeholder="Enter OTP"
                  className="form-input"
                  value={twoFaOtp}
                  onChange={(e) => setTwoFaOtp(e.target.value)}
                />
                <MotionButton
                  type="button"
                  className="form-btn"
                  onClick={verifyTwoFactorOtp}
                  disabled={twoFaLoading}
                >
                  {twoFaLoading ? renderLoadingLabel("Verifying") : "Verify OTP"}
                </MotionButton>
                <p
                  className="switch-link soft"
                  onClick={() => {
                    setTwoFaRequired(false);
                    setTwoFaEmail("");
                    setTwoFaOtp("");
                  }}
                >
                  Back to login
                </p>
              </>
            ) : loginMode === "otp" ? (
              <>
                <input
                  placeholder="Email"
                  className="form-input"
                  value={otpLoginEmail}
                  onChange={(e) => {
                    setOtpLoginEmail(e.target.value);
                    setOtpLoginSent(false);
                    setOtpLoginCooldown(0);
                  }}
                />
                <MotionButton
                  type="button"
                  className="form-btn"
                  onClick={sendLoginOtp}
                  disabled={otpLoginLoading || otpLoginCooldown > 0}
                >
                  {otpLoginLoading
                    ? renderLoadingLabel("Sending OTP")
                    : otpLoginCooldown > 0
                    ? `Resend OTP in ${otpLoginCooldown}s`
                    : otpLoginSent
                    ? "Resend OTP"
                    : "Send OTP"}
                </MotionButton>
                <AnimatePresence initial={false}>
                  {otpLoginSent && (
                    <motion.div
                      initial={{ opacity: 0, y: 12, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: "auto" }}
                      exit={{ opacity: 0, y: -8, height: 0 }}
                      transition={{ duration: 0.28 }}
                      style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "hidden" }}
                    >
                      <input
                        placeholder="Enter OTP"
                        className="form-input"
                        value={otpLoginOtp}
                        onChange={(e) => setOtpLoginOtp(e.target.value)}
                      />
                      <MotionButton
                        type="button"
                        className="form-btn"
                        onClick={verifyOtpLogin}
                        disabled={otpLoginLoading}
                      >
                        {otpLoginLoading ? renderLoadingLabel("Logging In") : "Login"}
                      </MotionButton>
                    </motion.div>
                  )}
                </AnimatePresence>
                <p
                  className="switch-link soft"
                  onClick={() => {
                    setLoginMode("password");
                    setOtpLoginEmail("");
                    setOtpLoginSent(false);
                    setOtpLoginOtp("");
                    setLoginEmail("");
                    setLoginPassword("");
                  }}
                >
                  Use email + password instead
                </p>
              </>
            ) : (
              <>
                <input
                  name="email"
                  placeholder="Email"
                  className="form-input"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                />
                <div className="password-field">
                  <input
                    name="password"
                    type={showLoginPassword ? "text" : "password"}
                    placeholder="Password"
                    className="form-input"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="eye-btn"
                    onClick={() => setShowLoginPassword((v) => !v)}
                    aria-label={showLoginPassword ? "Hide password" : "Show password"}
                  >
                    {showLoginPassword ? "🙈" : "👁"}
                  </button>
                </div>
                <MotionButton className="form-btn">Login</MotionButton>
                <p
                  className="switch-link soft"
                  onClick={() => {
                    setLoginMode("otp");
                    setOtpLoginEmail("");
                    setOtpLoginSent(false);
                    setOtpLoginOtp("");
                    setLoginEmail("");
                    setLoginPassword("");
                  }}
                >
                  Login with OTP instead
                </p>
              </>
            )}
          </form>

          {/* SIGNUP */}
          <form className="card-form signup-side" onSubmit={handleRegister}>
            <h2>Sign Up</h2>
            <input
              name="name"
              placeholder="Full Name"
              className="form-input"
              required
              value={signupName}
              onChange={(e) => setSignupName(e.target.value)}
            />
            <select
              name="school"
              className="form-input"
              required
              value={signupSchool}
              onChange={(e) => {
                const value = e.target.value;
                setSignupSchool(value);
                if (value !== "other") setSignupCustomSchool("");
              }}
            >
              <option value="">Select School</option>
              <option>St. Augustine's Day School - Barrackpore</option>
              <option>St. Augustine's Day School - Shyamnagar</option>
              <option>Modern English Academy</option>
              <option>St. Claret School</option>
              <option>Douglas Memorial Higher Secondary School</option>
              <option>Assembly of Angels Secondary School</option>
              <option>STEM World School</option>
              <option value="other">Other</option>
            </select>
            {signupSchool === "other" && (
              <input
                type="text"
                name="customSchool"
                placeholder="Enter your school name"
                className="form-input"
                required
                value={signupCustomSchool}
                onChange={(e) => setSignupCustomSchool(e.target.value)}
              />
            )}
            <select
              name="class"
              className="form-input"
              required
              value={signupClass}
              onChange={(e) => setSignupClass(e.target.value)}
            >
              <option value="">Select Class</option>
              {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              name="phone"
              placeholder="Phone Number"
              className="form-input"
              required
              value={signupPhone}
              onChange={(e) => setSignupPhone(e.target.value)}
            />
            <input
              name="email"
              placeholder="Email"
              className="form-input"
              required
              value={signupEmail}
              onChange={(e) => {
                setSignupEmail(e.target.value);
                setSignupOtpSent(false);
                setSignupOtpVerified(false);
                setSignupCooldown(0);
              }}
            />
            <MotionButton
              type="button"
              className="form-btn"
              onClick={sendSignupOtp}
              disabled={signupLoading || signupCooldown > 0}
            >
              {signupLoading
                ? renderLoadingLabel("Sending OTP")
                : signupCooldown > 0
                ? `Resend OTP in ${signupCooldown}s`
                : signupOtpSent
                ? "Resend OTP"
                : "Send OTP"}
            </MotionButton>
            <AnimatePresence initial={false}>
              {signupOtpSent && (
                <motion.div
                  initial={{ opacity: 0, y: 12, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: 0.28 }}
                  style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "hidden" }}
                >
                  <input
                    placeholder="Enter OTP"
                    className="form-input"
                    required
                    value={signupOtpInput}
                    onChange={(e) => setSignupOtpInput(e.target.value)}
                  />
                  <MotionButton
                    type="button"
                    className="form-btn"
                    onClick={verifySignupOtp}
                    disabled={signupLoading}
                  >
                    {signupLoading ? renderLoadingLabel("Verifying") : "Verify OTP"}
                  </MotionButton>
                </motion.div>
              )}
            </AnimatePresence>
            <p className="switch-link">
              {signupOtpVerified ? "Email verified" : "Email not verified"}
            </p>

            <div className="password-field">
              <input
                name="password"
                type={showSignupPassword ? "text" : "password"}
                placeholder="Password"
                className="form-input"
                required
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
              />
              <button
                type="button"
                className="eye-btn"
                onClick={() => setShowSignupPassword((v) => !v)}
                aria-label={showSignupPassword ? "Hide password" : "Show password"}
              >
                {showSignupPassword ? "🙈" : "👁"}
              </button>
            </div>
            <p className="password-rules">
              {passwordChecks.minLen ? "✓" : "•"} 8+ chars |{" "}
              {passwordChecks.upper ? "✓" : "•"} uppercase |{" "}
              {passwordChecks.lower ? "✓" : "•"} lowercase |{" "}
              {passwordChecks.number ? "✓" : "•"} number |{" "}
              {passwordChecks.special ? "✓" : "•"} special
            </p>

            <MotionButton
              className="form-btn"
              disabled={
                signupLoading ||
                !signupOtpVerified ||
                !isStrongPassword(signupPassword)
              }
            >
              {signupLoading ? renderLoadingLabel("Creating Account") : "Sign Up"}
            </MotionButton>
            <p className="switch-link soft" onClick={() => setActiveForm("login")}>
              Already have an account?
            </p>
          </form>

          {/* FORGOT */}
          <form className="card-form forgot-side" onSubmit={handleResetPassword}>
            <h2>Reset Password</h2>
            <input
              name="email"
              placeholder="Email"
              className="form-input"
              value={forgotEmail}
              onChange={(e) => {
                setForgotEmail(e.target.value);
                setForgotOtpSent(false);
                setForgotOtpInput("");
                setForgotNewPassword("");
                setForgotCooldown(0);
              }}
            />

            <MotionButton
              type="button"
              className="form-btn"
              onClick={sendForgotOtp}
              disabled={forgotLoading || forgotCooldown > 0}
            >
              {forgotLoading
                ? renderLoadingLabel("Sending OTP")
                : forgotCooldown > 0
                ? `Resend OTP in ${forgotCooldown}s`
                : forgotOtpSent
                ? "Resend OTP"
                : "Send OTP"}
            </MotionButton>

            <AnimatePresence initial={false}>
              {forgotOtpSent && (
                <motion.div
                  initial={{ opacity: 0, y: 12, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: 0.28 }}
                  style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "hidden" }}
                >
                  <input
                    placeholder="Enter OTP"
                    className="form-input"
                    value={forgotOtpInput}
                    onChange={(e) => setForgotOtpInput(e.target.value)}
                  />
                  <div className="password-field">
                    <input
                      name="newPassword"
                      type={showResetPassword ? "text" : "password"}
                      placeholder="New Password"
                      className="form-input"
                      value={forgotNewPassword}
                      onChange={(e) => setForgotNewPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="eye-btn"
                      onClick={() => setShowResetPassword((v) => !v)}
                      aria-label={showResetPassword ? "Hide password" : "Show password"}
                    >
                      {showResetPassword ? "🙈" : "👁"}
                    </button>
                  </div>
                  <MotionButton className="form-btn" disabled={forgotLoading}>
                    {forgotLoading ? renderLoadingLabel("Resetting") : "Reset Password"}
                  </MotionButton>
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
