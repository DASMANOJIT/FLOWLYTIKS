"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./login.css";
import Fall from "../animation/fallingword.jsx";
import { MotionButton } from "../components/motion/primitives.jsx";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { readApiResponse } from "../../lib/api.js";
import {
  clearLegacyAuthStorage,
  storeAuthSession,
  storeFacultyAuthSession,
} from "../../lib/authStorage.js";
import {
  CLASS_OPTIONS,
  SCHOOL_OPTIONS,
  SCHOOL_OTHER_VALUE,
} from "../../lib/studentOptions.js";
import { isValidWhatsAppNumber } from "../../lib/whatsapp.js";

export default function Login() {
  const OTP_RESEND_COOLDOWN_SECONDS = 15;

  const [selectedRole, setSelectedRole] = useState("student");
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
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [showFacultyPassword, setShowFacultyPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminLoginLoading, setAdminLoginLoading] = useState(false);
  const [facultyEmail, setFacultyEmail] = useState("");
  const [facultyPassword, setFacultyPassword] = useState("");
  const [facultyLoginLoading, setFacultyLoginLoading] = useState(false);
  const [roleResetOtpSent, setRoleResetOtpSent] = useState(false);
  const [roleResetLoading, setRoleResetLoading] = useState(false);
  const [roleResetForm, setRoleResetForm] = useState({
    email: "",
    otp: "",
    newPassword: "",
    confirmPassword: "",
  });
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

  const isValidPhone = (phone) => isValidWhatsAppNumber(phone);

  const isValidEmail = (email) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());

  const resetSignupVerificationState = () => {
    setSignupOtpSent(false);
    setSignupOtpInput("");
    setSignupOtpVerified(false);
    setSignupCooldown(0);
  };

  const selectRole = (role) => {
    setSelectedRole(role);
    setActiveForm("login");
    setRoleResetOtpSent(false);
    setRoleResetForm({ email: "", otp: "", newPassword: "", confirmPassword: "" });
    setTwoFaRequired(false);
    setTwoFaEmail("");
    setTwoFaOtp("");
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
    if (school === SCHOOL_OTHER_VALUE && !String(customSchool || "").trim()) {
      return "Please enter your school name.";
    }
    if (!studentClass) return "Class is required.";
    if (!phone) return "WhatsApp number is required.";
    if (!isValidPhone(phone)) return "Please enter a valid WhatsApp number.";
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

  useEffect(() => {
    clearLegacyAuthStorage();
  }, []);

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
    storeAuthSession({ token: data.token, name: data.name, role: "student" });
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
  const loginWithAuthEndpoint = async ({ email, password, expectedRole, redirectTo }) => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const { ok, data, error } = await readApiResponse(
      res,
      "Login failed. Please try again."
    );
    if (!ok) return { ok: false, error };

    if (expectedRole && data.role !== expectedRole) {
      return {
        ok: false,
        error: `This account is not registered as ${expectedRole === "admin" ? "an administrator" : "a student"}.`,
      };
    }

    storeAuthSession({ token: data.token, name: data.name, role: data.role });
    window.location.href = redirectTo || (data.role === "admin" ? "/admin" : "/student");
    return { ok: true };
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    if (adminLoginLoading) return;

    const email = adminEmail.trim();
    const password = adminPassword;

    setAdminLoginLoading(true);
    try {
      const result = await loginWithAuthEndpoint({
        email,
        password,
        expectedRole: "admin",
        redirectTo: "/admin",
      });
      if (!result.ok) return alert(result.error);
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setAdminLoginLoading(false);
    }
  };

  const handleFacultyLogin = async (e) => {
    e.preventDefault();
    if (facultyLoginLoading) return;

    const email = facultyEmail.trim();
    const password = facultyPassword;

    setFacultyLoginLoading(true);
    try {
      const res = await fetch(`${API}/api/faculty/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const { ok, data, error } = await readApiResponse(
        res,
        "Faculty login failed. Please try again."
      );
      if (!ok) return alert(error);

      storeFacultyAuthSession({ token: data.token, name: data.name });
      window.location.href = "/faculty/dashboard";
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setFacultyLoginLoading(false);
    }
  };

  const getRoleResetBase = () => {
    if (selectedRole === "admin") return "/api/admin/auth/forgot-password";
    if (selectedRole === "faculty") return "/api/faculty/auth/forgot-password";
    return "";
  };

  const sendRoleResetOtp = async () => {
    const base = getRoleResetBase();
    if (!base) return;
    setRoleResetLoading(true);
    try {
      const res = await fetch(`${API}${base}/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: roleResetForm.email }),
      });
      const { ok, data, error } = await readApiResponse(res, "Failed to send OTP. Please try again.");
      if (!ok) return alert(error);
      setRoleResetOtpSent(true);
      alert(data.message || "OTP sent successfully.");
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setRoleResetLoading(false);
    }
  };

  const verifyRoleReset = async (e) => {
    e.preventDefault();
    const base = getRoleResetBase();
    if (!base) return;
    setRoleResetLoading(true);
    try {
      const res = await fetch(`${API}${base}/verify-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roleResetForm),
      });
      const { ok, data, error } = await readApiResponse(res, "Password reset failed. Please try again.");
      if (!ok) return alert(error);
      alert(data.message || "Password reset successful. Please login again.");
      setActiveForm("login");
      setRoleResetOtpSent(false);
      setRoleResetForm({ email: "", otp: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setRoleResetLoading(false);
    }
  };

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

      if (data.role !== "student") {
        return alert("Please use Administrator Login for this account.");
      }

      storeAuthSession({ token: data.token, name: data.name, role: data.role });

      window.location.href = "/student";
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
      return alert("Please enter a valid WhatsApp number.");
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

      storeAuthSession({ token: data.token, name: data.name, role: data.role });
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

      storeAuthSession({ token: data.token, name: data.name, role: data.role });
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
        <div className={`card-wrapper ${selectedRole === "student" ? activeForm : activeForm === "forgot" ? "forgot" : "login"} role-${selectedRole}`}>
          <div className="auth-switch">
            <MotionButton
              type="button"
              className={`switch-btn ${selectedRole === "admin" ? "active" : ""}`}
              onClick={() => selectRole("admin")}
            >
              Administrator Login
            </MotionButton>
            <MotionButton
              type="button"
              className={`switch-btn ${selectedRole === "faculty" ? "active" : ""}`}
              onClick={() => selectRole("faculty")}
            >
              Faculty Login
            </MotionButton>
            <MotionButton
              type="button"
              className={`switch-btn ${selectedRole === "student" ? "active" : ""}`}
              onClick={() => selectRole("student")}
            >
              Student Login
            </MotionButton>
          </div>

          {selectedRole === "student" ? (
            <div className="auth-switch auth-switch--student">
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
          ) : null}

          {selectedRole === "admin" && activeForm === "forgot" ? (
            <form className="card-form login-side" onSubmit={verifyRoleReset}>
              <h2>Reset Admin Password</h2>
              <input
                placeholder="Admin Email"
                className="form-input"
                value={roleResetForm.email}
                inputMode="email"
                autoComplete="email"
                onChange={(e) => setRoleResetForm((current) => ({ ...current, email: e.target.value }))}
              />
              <MotionButton type="button" className="form-btn" onClick={sendRoleResetOtp} disabled={roleResetLoading}>
                {roleResetLoading ? renderLoadingLabel("Sending OTP") : roleResetOtpSent ? "Resend OTP" : "Send OTP"}
              </MotionButton>
              {roleResetOtpSent ? (
                <>
                  <input
                    placeholder="Enter OTP"
                    className="form-input"
                    value={roleResetForm.otp}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    onChange={(e) => setRoleResetForm((current) => ({ ...current, otp: e.target.value }))}
                  />
                  <input
                    type="password"
                    placeholder="New Password"
                    className="form-input"
                    value={roleResetForm.newPassword}
                    autoComplete="new-password"
                    onChange={(e) => setRoleResetForm((current) => ({ ...current, newPassword: e.target.value }))}
                  />
                  <input
                    type="password"
                    placeholder="Confirm New Password"
                    className="form-input"
                    value={roleResetForm.confirmPassword}
                    autoComplete="new-password"
                    onChange={(e) => setRoleResetForm((current) => ({ ...current, confirmPassword: e.target.value }))}
                  />
                  <MotionButton className="form-btn" disabled={roleResetLoading}>
                    {roleResetLoading ? renderLoadingLabel("Resetting") : "Reset Password"}
                  </MotionButton>
                </>
              ) : null}
              <p className="switch-link soft" onClick={() => setActiveForm("login")}>Back to Administrator Login</p>
            </form>
          ) : null}

          {selectedRole === "admin" && activeForm !== "forgot" ? (
            <form className="card-form login-side" onSubmit={handleAdminLogin}>
              <h2>Administrator Login</h2>
              <input
                name="adminEmail"
                placeholder="Email"
                className="form-input"
                value={adminEmail}
                inputMode="email"
                autoComplete="email"
                onChange={(e) => setAdminEmail(e.target.value)}
              />
              <div className="password-field">
                <input
                  name="adminPassword"
                  type={showAdminPassword ? "text" : "password"}
                  placeholder="Password"
                  className="form-input"
                  value={adminPassword}
                  autoComplete="current-password"
                  onChange={(e) => setAdminPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowAdminPassword((v) => !v)}
                  aria-label={showAdminPassword ? "Hide password" : "Show password"}
                >
                  {showAdminPassword ? "🙈" : "👁"}
                </button>
              </div>
              <MotionButton className="form-btn" disabled={adminLoginLoading}>
                {adminLoginLoading ? renderLoadingLabel("Logging In") : "Login as Administrator"}
              </MotionButton>
              <p className="switch-link soft" onClick={() => setActiveForm("forgot")}>Reset Password</p>
            </form>
          ) : null}

          {selectedRole === "faculty" && activeForm === "forgot" ? (
            <form className="card-form login-side" onSubmit={verifyRoleReset}>
              <h2>Reset Faculty Password</h2>
              <input
                placeholder="Faculty Email"
                className="form-input"
                value={roleResetForm.email}
                inputMode="email"
                autoComplete="email"
                onChange={(e) => setRoleResetForm((current) => ({ ...current, email: e.target.value }))}
              />
              <MotionButton type="button" className="form-btn" onClick={sendRoleResetOtp} disabled={roleResetLoading}>
                {roleResetLoading ? renderLoadingLabel("Sending OTP") : roleResetOtpSent ? "Resend OTP" : "Send OTP"}
              </MotionButton>
              {roleResetOtpSent ? (
                <>
                  <input
                    placeholder="Enter OTP"
                    className="form-input"
                    value={roleResetForm.otp}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    onChange={(e) => setRoleResetForm((current) => ({ ...current, otp: e.target.value }))}
                  />
                  <input
                    type="password"
                    placeholder="New Password"
                    className="form-input"
                    value={roleResetForm.newPassword}
                    autoComplete="new-password"
                    onChange={(e) => setRoleResetForm((current) => ({ ...current, newPassword: e.target.value }))}
                  />
                  <input
                    type="password"
                    placeholder="Confirm New Password"
                    className="form-input"
                    value={roleResetForm.confirmPassword}
                    autoComplete="new-password"
                    onChange={(e) => setRoleResetForm((current) => ({ ...current, confirmPassword: e.target.value }))}
                  />
                  <MotionButton className="form-btn" disabled={roleResetLoading}>
                    {roleResetLoading ? renderLoadingLabel("Resetting") : "Reset Password"}
                  </MotionButton>
                </>
              ) : null}
              <p className="switch-link soft" onClick={() => setActiveForm("login")}>Back to Faculty Login</p>
            </form>
          ) : null}

          {selectedRole === "faculty" && activeForm !== "forgot" ? (
            <form className="card-form login-side" onSubmit={handleFacultyLogin}>
              <h2>Faculty Login</h2>
              <input
                name="facultyEmail"
                placeholder="Email"
                className="form-input"
                value={facultyEmail}
                inputMode="email"
                autoComplete="email"
                onChange={(e) => setFacultyEmail(e.target.value)}
              />
              <div className="password-field">
                <input
                  name="facultyPassword"
                  type={showFacultyPassword ? "text" : "password"}
                  placeholder="Password"
                  className="form-input"
                  value={facultyPassword}
                  autoComplete="current-password"
                  onChange={(e) => setFacultyPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowFacultyPassword((v) => !v)}
                  aria-label={showFacultyPassword ? "Hide password" : "Show password"}
                >
                  {showFacultyPassword ? "🙈" : "👁"}
                </button>
              </div>
              <MotionButton className="form-btn" disabled={facultyLoginLoading}>
                {facultyLoginLoading ? renderLoadingLabel("Logging In") : "Login as Faculty"}
              </MotionButton>
              <p className="switch-link soft" onClick={() => setActiveForm("forgot")}>Reset Password</p>
            </form>
          ) : null}

          {/* STUDENT LOGIN */}
          {selectedRole === "student" ? (
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
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
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
                  inputMode="email"
                  autoComplete="email"
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
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
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
                  inputMode="email"
                  autoComplete="email"
                  onChange={(e) => setLoginEmail(e.target.value)}
                />
                <div className="password-field">
                  <input
                    name="password"
                    type={showLoginPassword ? "text" : "password"}
                    placeholder="Password"
                    className="form-input"
                    value={loginPassword}
                    autoComplete="current-password"
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
                <p
                  className="switch-link soft"
                  onClick={() => selectRole("faculty")}
                >
                  Faculty Login
                </p>
              </>
            )}
          </form>
          ) : null}

          {/* SIGNUP */}
          {selectedRole === "student" ? (
          <form className="card-form signup-side" onSubmit={handleRegister}>
            <h2>Sign Up</h2>
            <input
              name="name"
              placeholder="Full Name"
              className="form-input"
              required
              value={signupName}
              autoComplete="name"
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
                if (value !== SCHOOL_OTHER_VALUE) setSignupCustomSchool("");
              }}
            >
              <option value="">Select School</option>
              {SCHOOL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={SCHOOL_OTHER_VALUE}>Other</option>
            </select>
            {signupSchool === SCHOOL_OTHER_VALUE && (
              <input
                type="text"
                name="customSchool"
                placeholder="Enter your school name"
                className="form-input"
                required
                value={signupCustomSchool}
                autoComplete="organization"
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
              {CLASS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <input
              name="phone"
              placeholder="Enter WhatsApp number"
              className="form-input"
              required
              value={signupPhone}
              inputMode="tel"
              autoComplete="tel"
              onChange={(e) => setSignupPhone(e.target.value)}
            />
            <p className="form-help-text">
              
            </p>
            <input
              name="email"
              placeholder="Email"
              className="form-input"
              required
              value={signupEmail}
              inputMode="email"
              autoComplete="email"
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
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
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
                autoComplete="new-password"
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
          ) : null}

          {/* FORGOT */}
          {selectedRole === "student" ? (
          <form className="card-form forgot-side" onSubmit={handleResetPassword}>
            <h2>Reset Password</h2>
            <input
              name="email"
              placeholder="Email"
              className="form-input"
              value={forgotEmail}
              inputMode="email"
              autoComplete="email"
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
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                  />
                  <div className="password-field">
                    <input
                      name="newPassword"
                      type={showResetPassword ? "text" : "password"}
                      placeholder="New Password"
                    className="form-input"
                    value={forgotNewPassword}
                    autoComplete="new-password"
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
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}
