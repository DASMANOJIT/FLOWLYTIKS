"use client";
import { useEffect, useRef, useState } from "react";
import "./login.css";
import Fall from "../animation/fallingword.jsx";

export default function Login() {
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
  const [forgotPhone, setForgotPhone] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const [signupOtpSent, setSignupOtpSent] = useState(false);
  const [signupOtpInput, setSignupOtpInput] = useState("");
  const [signupPhone, setSignupPhone] = useState("");
  const [signupPhoneVerified, setSignupPhoneVerified] = useState(false);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupPassword, setSignupPassword] = useState("");
  const [signupSchool, setSignupSchool] = useState("");
  const [signupCustomSchool, setSignupCustomSchool] = useState("");
  const [signupClass, setSignupClass] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const [loginMode, setLoginMode] = useState("password"); // password | otp
  const [otpLoginPhone, setOtpLoginPhone] = useState("");
  const [otpLoginSent, setOtpLoginSent] = useState(false);
  const [otpLoginOtp, setOtpLoginOtp] = useState("");
  const [otpLoginLoading, setOtpLoginLoading] = useState(false);

  const [twoFaRequired, setTwoFaRequired] = useState(false);
  const [twoFaEmail, setTwoFaEmail] = useState("");
  const [twoFaOtp, setTwoFaOtp] = useState("");
  const [twoFaLoading, setTwoFaLoading] = useState(false);

  const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000";

  const isStrongPassword = (password) =>
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(
      String(password || "")
    );

  const isValidPhone = (phone) => /^\+?\d{10,15}$/.test(String(phone || "").trim());
  const passwordChecks = {
    minLen: signupPassword.length >= 8,
    upper: /[A-Z]/.test(signupPassword),
    lower: /[a-z]/.test(signupPassword),
    number: /\d/.test(signupPassword),
    special: /[^A-Za-z0-9]/.test(signupPassword),
  };

  // =====================
  // LOGIN
  // =====================
  const handlePasswordLogin = async (e) => {
    e.preventDefault();

    const email = e.target.email?.value;
    const password = e.target.password?.value;

    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) return alert(data.message);

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
  // SIGNUP OTP (TWILIO)
  // =====================
  const sendSignupOtp = async () => {
    if (!isValidPhone(signupPhone)) {
      alert("Please enter a valid phone number before OTP.");
      return;
    }

    setSignupLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: signupPhone, purpose: "signup" }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.message);

      setSignupOtpSent(true);
      setSignupPhoneVerified(false);
      alert("OTP sent to your phone.");
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setSignupLoading(false);
    }
  };

  const verifySignupOtp = async () => {
    if (!signupOtpSent) return alert("Send OTP first.");
    const debugSignup =
      process.env.NODE_ENV !== "production" ||
      process.env.NEXT_PUBLIC_DEBUG_SIGNUP === "1";
    const code = String(signupOtpInput || "").trim();
    const maskedPhone =
      signupPhone && signupPhone.length >= 6
        ? `${signupPhone.slice(0, 3)}***${signupPhone.slice(-2)}`
        : "***";

    if (!/^\d{6}$/.test(code)) {
      return alert("Please enter the 6-digit OTP.");
    }

    if (!isValidPhone(signupPhone)) {
      return alert("Please enter a valid phone number.");
    }

    if (!isStrongPassword(signupPassword)) {
      return alert(
        "Password must be 8+ chars with uppercase, lowercase, number, and special character."
      );
    }

    setSignupLoading(true);
    try {
      // NOTE: We verify OTP and create the user in ONE backend call to avoid
      // double-checking the same code (Twilio Verify can reject repeat checks).
      const form = document.querySelector("form.card-form.signup-side");
      const name = form?.querySelector('input[name="name"]')?.value || "";
      const email = form?.querySelector('input[name="email"]')?.value || "";
      const phone = form?.querySelector('input[name="phone"]')?.value || signupPhone || "";
      const school = signupSchool || "";
      const customSchool = signupCustomSchool || "";
      const studentClass = signupClass || "";

      if (!name || !email || !school || !studentClass) {
        return alert("Please fill in all signup details before verifying OTP.");
      }
      if (school === "other" && !String(customSchool || "").trim()) {
        return alert("Please enter your school name.");
      }

      if (debugSignup) {
        console.log("OTP VERIFIED: starting signup");
        console.log("Calling signup API...");
        console.log("Signup payload:", {
          name: name ? "<present>" : "<missing>",
          email: email ? "<present>" : "<missing>",
          phone: maskedPhone,
          school: school ? "<present>" : "<missing>",
          class: studentClass ? "<present>" : "<missing>",
          password: signupPassword ? `<len:${String(signupPassword).length}>` : "<missing>",
          otp: `<len:${code.length}>`,
        });
      }

      const res = await fetch(`${API}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          password: signupPassword,
          school,
          customSchool,
          class: studentClass,
          otp: code,
        }),
      });
      const data = await res.json();

      if (debugSignup) {
        console.log("OTP VERIFIED RESPONSE:", {
          ok: res.ok,
          status: res.status,
          body: data,
        });
      }

      if (!res.ok) {
        setSignupPhoneVerified(false);
        return alert(data.message || "Signup failed.");
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("studentName", data.name);
      alert("Registered successfully!");
      setSignupOtpSent(false);
      setSignupOtpInput("");
      setSignupPhoneVerified(true);
      window.location.href = "/student";
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setSignupLoading(false);
    }
  };

  // =====================
  // REGISTER (STUDENT ONLY, OTP VERIFIED)
  // =====================
  const handleRegister = async (e) => {
    e.preventDefault();

    const name = e.target.name.value;
    const email = e.target.email.value;
    const phone = e.target.phone.value;
    const password = e.target.password.value;
    const school = e.target.school.value;
    const customSchool = e.target.customSchool?.value;
    const studentClass = e.target.class.value;

    if (!isStrongPassword(password)) {
      return alert(
        "Password must be 8+ chars with uppercase, lowercase, number, and special character."
      );
    }

    if (!signupPhoneVerified) {
      return alert("Please verify phone number with OTP before signing up.");
    }

    if (!/^\d{6}$/.test(String(signupOtpInput || "").trim())) {
      return alert("Please enter the 6-digit OTP.");
    }

    setSignupLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          password,
          school,
          customSchool,
          class: studentClass,
          otp: signupOtpInput.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) return alert(data.message);

      localStorage.setItem("token", data.token);
      localStorage.setItem("studentName", data.name);
      alert("Registered successfully!");
      setSignupOtpSent(false);
      setSignupOtpInput("");
      setSignupPhoneVerified(false);
      window.location.href = "/student";
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setSignupLoading(false);
    }
  };

  // =====================
  // FORGOT OTP (TWILIO)
  // =====================
  const sendForgotOtp = async () => {
    if (!isValidPhone(forgotPhone)) {
      alert("Please enter a valid phone number before OTP.");
      return;
    }

    setForgotLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: forgotPhone, purpose: "reset" }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.message);
      setForgotOtpSent(true);
      alert("OTP sent to your phone.");
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

    const phone = e.target.phone?.value;
    const newPassword = e.target.newPassword.value;

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
          phone,
          otp: forgotOtpInput.trim(),
          newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) return alert(data.message);

      alert("Password reset successfully!");
      setForgotOtpSent(false);
      setForgotOtpInput("");
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
    if (!isValidPhone(otpLoginPhone)) {
      alert("Please enter a valid phone number before OTP.");
      return;
    }

    setOtpLoginLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: otpLoginPhone, purpose: "login" }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.message);

      setOtpLoginSent(true);
      alert("OTP sent to your phone.");
    } catch (err) {
      alert("Cannot connect to backend!");
      console.error(err);
    } finally {
      setOtpLoginLoading(false);
    }
  };

  const verifyOtpLogin = async () => {
    if (!otpLoginSent) return alert("Send OTP first.");
    if (!/^\d{6}$/.test(String(otpLoginOtp || "").trim())) {
      return alert("Please enter the 6-digit OTP.");
    }

    setOtpLoginLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: otpLoginPhone, otp: otpLoginOtp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.message);

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
      const data = await res.json();
      if (!res.ok) return alert(data.message);

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

      <header className="login-header">
        <h1>
          WELCOME TO THE <br /> SUBHO&apos;S COMPUTER INSTITUTE
        </h1>
        <p className="login-subtitle">
          Secure student access with a modern experience.
        </p>
      </header>

      <div className="auth-shell">
      <div className={`card-wrapper ${activeForm}`}>
        <div className="auth-switch">
          <button
            type="button"
            className={`switch-btn ${activeForm === "login" ? "active" : ""}`}
            onClick={() => setActiveForm("login")}
          >
            Login
          </button>
          <button
            type="button"
            className={`switch-btn ${activeForm === "signup" ? "active" : ""}`}
            onClick={() => setActiveForm("signup")}
          >
            Sign Up
          </button>
          <button
            type="button"
            className={`switch-btn ${activeForm === "forgot" ? "active" : ""}`}
            onClick={() => setActiveForm("forgot")}
          >
            Reset
          </button>
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
              <button
                type="button"
                className="form-btn"
                onClick={verifyTwoFactorOtp}
                disabled={twoFaLoading}
              >
                {twoFaLoading ? "Verifying..." : "Verify OTP"}
              </button>
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
                placeholder="Phone Number"
                className="form-input"
                value={otpLoginPhone}
                onChange={(e) => {
                  setOtpLoginPhone(e.target.value);
                  setOtpLoginSent(false);
                }}
              />
              <button
                type="button"
                className="form-btn"
                onClick={sendLoginOtp}
                disabled={otpLoginLoading}
              >
                {otpLoginLoading ? "Sending..." : otpLoginSent ? "Resend OTP" : "Send OTP"}
              </button>
              {otpLoginSent && (
                <>
                  <input
                    placeholder="Enter OTP"
                    className="form-input"
                    value={otpLoginOtp}
                    onChange={(e) => setOtpLoginOtp(e.target.value)}
                  />
                  <button
                    type="button"
                    className="form-btn"
                    onClick={verifyOtpLogin}
                    disabled={otpLoginLoading}
                  >
                    {otpLoginLoading ? "Logging in..." : "Login"}
                  </button>
                </>
              )}
              <p
                className="switch-link soft"
                onClick={() => {
                  setLoginMode("password");
                  setOtpLoginPhone("");
                  setOtpLoginSent(false);
                  setOtpLoginOtp("");
                }}
              >
                Use email + password instead
              </p>
            </>
          ) : (
            <>
              <input name="email" placeholder="Email" className="form-input" />
              <div className="password-field">
                <input
                  name="password"
                  type={showLoginPassword ? "text" : "password"}
                  placeholder="Password"
                  className="form-input"
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
              <button className="form-btn">Login</button>
              <p
                className="switch-link soft"
                onClick={() => {
                  setLoginMode("otp");
                  setOtpLoginPhone("");
                  setOtpLoginSent(false);
                  setOtpLoginOtp("");
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

          <input name="name" placeholder="Full Name" className="form-input" />
          <select
            name="school"
            className="form-input"
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
              value={signupCustomSchool}
              onChange={(e) => setSignupCustomSchool(e.target.value)}
            />
          )}
          <select
            name="class"
            className="form-input"
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
          <input name="email" placeholder="Email" className="form-input" />
          <input
            name="phone"
            placeholder="Phone Number"
            className="form-input"
            value={signupPhone}
            onChange={(e) => {
              setSignupPhone(e.target.value);
              setSignupPhoneVerified(false);
            }}
          />
          <button type="button" className="form-btn" onClick={sendSignupOtp}>
            {signupLoading ? "Sending..." : signupOtpSent ? "Resend OTP" : "Send OTP"}
          </button>
          {signupOtpSent && (
            <>
              <input
                placeholder="Enter OTP"
                className="form-input"
                value={signupOtpInput}
                onChange={(e) => setSignupOtpInput(e.target.value)}
              />
              <button type="button" className="form-btn" onClick={verifySignupOtp}>
                {signupLoading ? "Verifying..." : "Verify OTP"}
              </button>
            </>
          )}
          <p className="switch-link">
            {signupPhoneVerified ? "Phone verified" : "Phone not verified"}
          </p>

          <div className="password-field">
            <input
              name="password"
              type={showSignupPassword ? "text" : "password"}
              placeholder="Password"
              className="form-input"
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

          <button
            className="form-btn"
            disabled={
              signupLoading ||
              !signupPhoneVerified ||
              !isStrongPassword(signupPassword)
            }
          >
            Sign Up
          </button>
          <p className="switch-link soft" onClick={() => setActiveForm("login")}>
            Already have an account?
          </p>
        </form>

        {/* FORGOT */}
        <form className="card-form forgot-side" onSubmit={handleResetPassword}>
          <h2>Reset Password</h2>
          <input
            name="phone"
            placeholder="Phone Number"
            className="form-input"
            value={forgotPhone}
            onChange={(e) => {
              setForgotPhone(e.target.value);
              setForgotOtpSent(false);
              setForgotOtpInput("");
            }}
          />

          {!forgotOtpSent && (
            <button
              type="button"
              className="form-btn"
              onClick={sendForgotOtp}
              disabled={forgotLoading}
            >
              {forgotLoading ? "Sending..." : "Send OTP"}
            </button>
          )}

          {forgotOtpSent && (
            <>
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
              <button className="form-btn" disabled={forgotLoading}>
                {forgotLoading ? "Resetting..." : "Reset Password"}
              </button>
            </>
          )}

          
        </form>
      </div>
      </div>
    </div>
  );
}
