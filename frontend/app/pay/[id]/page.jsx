"use client";
import { useRouter } from "next/navigation";
import { useParams, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

import "./pay.css";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard } from "../../components/motion/primitives.jsx";
import { getApiBaseUrl, readApiResponse } from "../../../lib/api.js";
import { clearAuthSession, getAuthRole, getAuthToken } from "../../../lib/authStorage.js";
import { openCashfreeCheckout } from "../../../lib/cashfree.js";

const API_BASE = getApiBaseUrl();
const PAYMENT_MODE = String(process.env.NEXT_PUBLIC_PAYMENT_MODE || "MANUAL_UPI")
  .trim()
  .toUpperCase();
const IS_MANUAL_UPI_MODE = PAYMENT_MODE === "MANUAL_UPI";
const MANUAL_UPI_ID = process.env.NEXT_PUBLIC_MANUAL_UPI_ID || "9831934306@ybl";
const MANUAL_UPI_PHONE = process.env.NEXT_PUBLIC_MANUAL_UPI_PHONE || "9831934306";
const MANUAL_UPI_QR_PATH =
  process.env.NEXT_PUBLIC_MANUAL_UPI_QR_PATH || "/fees-payment.jpg";

const normalizeUtr = (value) => String(value || "").replace(/\s+/g, "").trim().toUpperCase();

export default function PayPage() {
  const { id: studentId } = useParams();

  const searchParams = useSearchParams();
  const month = searchParams.get("month");
  const amount = searchParams.get("amount");
  const router = useRouter();


  const [method, setMethod] = useState("upi");
  const [selectedUpiApp, setSelectedUpiApp] = useState(null);
  const [customUpiId, setCustomUpiId] = useState("");
  const [student, setStudent] = useState(null);
  const [isPaying, setIsPaying] = useState(false);
  const [utrNumber, setUtrNumber] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");


  useEffect(() => {
    if (!studentId) return;

    const fetchStudent = async () => {
      try {
        const token = getAuthToken();
        const role = getAuthRole();
        if (!token) {
          router.push("/login");
          return;
        }
        if (role && role !== "student") {
          clearAuthSession();
          router.push("/login");
          return;
        }

        const res = await fetch(
          `${API_BASE}/api/students/me`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!res.ok) {
          throw new Error("Student fetch failed");
        }


        const data = await res.json();
        setStudent(data);
      } catch (err) {
        console.error("Failed to fetch student details", err);
      }
    };

    fetchStudent();
  }, [studentId, router]);




  const handleCashfreePay = async () => {
    try {
      if (!month || !amount) {
        alert("Invalid payment details.");
        return;
      }

      const token = getAuthToken();
      if (!token) {
        router.push("/login");
        return;
      }

      setIsPaying(true);

      const res = await fetch(
        `${API_BASE}/api/payments/cashfree/create-order`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            studentId: student?.id || studentId,
            amount,
            month,
            preferredMethod: method,
            upiApp: selectedUpiApp,
            upiId: customUpiId.trim() || null,
          }),
        }
      );

      const { ok, data, error } = await readApiResponse(
        res,
        "Unable to initialize checkout right now."
      );

      const paymentSessionId =
        String(data?.payment_session_id || data?.paymentSessionId || "").trim() || null;

      if (!ok || !paymentSessionId) {
        console.error("Cashfree payment initiate response is malformed:", data);
        alert(error || data.message || "Payment initiation failed");
        return;
      }

      await openCashfreeCheckout({
        paymentSessionId,
        environment: data.environment,
      });
    } catch (err) {
      console.error(err);
      alert(err?.message || "Something went wrong");
    } finally {
      setIsPaying(false);
    }
  };

  const handleCopy = async (value, label) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied`);
      setTimeout(() => setCopyStatus(""), 1800);
    } catch {
      setCopyStatus("Copy failed. Please copy manually.");
      setTimeout(() => setCopyStatus(""), 2200);
    }
  };

  const handleManualUpiPay = async () => {
    try {
      setPaymentError("");
      if (!month) {
        setPaymentError("Invalid payment month.");
        return;
      }

      const normalizedUtr = normalizeUtr(utrNumber);
      if (!/^[A-Z0-9]{8,35}$/.test(normalizedUtr)) {
        setPaymentError("Enter a valid UTR number after completing the UPI payment.");
        return;
      }

      const token = getAuthToken();
      if (!token) {
        router.push("/login");
        return;
      }

      setIsPaying(true);
      const res = await fetch(`${API_BASE}/api/payments/manual-upi`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          month,
          utrNumber: normalizedUtr,
        }),
      });

      const { ok, data, error } = await readApiResponse(
        res,
        "Unable to complete manual UPI payment."
      );

      if (!ok || !data?.success) {
        setPaymentError(error || data?.message || "Unable to complete manual UPI payment.");
        return;
      }

      router.push(
        `/payment-success?gateway=manual-upi&paymentId=${encodeURIComponent(
          data.paymentId || ""
        )}&month=${encodeURIComponent(data.month || month)}&amount=${encodeURIComponent(
          data.amount || amount || ""
        )}&academicYear=${encodeURIComponent(
          data.academicYear || ""
        )}&utr=${encodeURIComponent(
          data.utrNumber || normalizedUtr
        )}&studentName=${encodeURIComponent(
          student?.name || ""
        )}&studentId=${encodeURIComponent(
          student?.id || studentId || ""
        )}&paidAt=${encodeURIComponent(data.payment?.paidAt || "")}`
      );
    } catch (err) {
      console.error(err);
      setPaymentError(err?.message || "Something went wrong.");
    } finally {
      setIsPaying(false);
    }
  };



  return (
    <motion.div
      className="pay-wrapper"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link href="/student" className="back-btn">
        ← Back to Dashboard
      </Link>


 




      <h1 className="pay-heading">Fee Payment</h1>

      <MotionCard className="pay-card" hover={false}>
        <h2 className="student-title">Student ID: {studentId}</h2>
        {student ? (
          <div className="student-info">
            <p><strong>Name:</strong> {student.name}</p>
            <p><strong>Class:</strong> {student.class}</p>
            <p><strong>School:</strong> {student.school}</p>
          </div>
        ) : (
          <PremiumLoader label="Loading student details" />
        )}



        <p className="pay-row"><strong>Month:</strong> {month}</p>
        <p className="pay-row"><strong>Amount:</strong> ₹{amount}</p>
        {IS_MANUAL_UPI_MODE ? (
          <div className="manual-upi-section">
            <p className="method-note">
              Scan the QR code or use the UPI details below to complete the payment. After
              payment, enter the UTR number and click Pay.
            </p>

            <div className="manual-upi-grid">
              <div className="manual-upi-qr-card">
                <img src={MANUAL_UPI_QR_PATH} alt="Manual UPI payment QR code" />
                <span>UPI QR Code</span>
              </div>

              <div className="manual-upi-details">
                <div className="manual-upi-detail-row">
                  <span>UPI ID</span>
                  <strong>{MANUAL_UPI_ID}</strong>
                  <button type="button" onClick={() => handleCopy(MANUAL_UPI_ID, "UPI ID")}>
                    {copyStatus === "UPI ID copied" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="manual-upi-detail-row">
                  <span>UPI Phone Number</span>
                  <strong>{MANUAL_UPI_PHONE}</strong>
                  <button type="button" onClick={() => handleCopy(MANUAL_UPI_PHONE, "Phone")}>
                    {copyStatus === "Phone copied" ? "Copied" : "Copy"}
                  </button>
                </div>
                {copyStatus ? <p className="manual-upi-copy-status">{copyStatus}</p> : null}
              </div>
            </div>

            <label className="manual-upi-label" htmlFor="manual-upi-utr">
              UTR / Transaction Reference Number
            </label>
            <input
              id="manual-upi-utr"
              className="input-box"
              value={utrNumber}
              onChange={(event) => setUtrNumber(event.target.value.toUpperCase())}
              placeholder="Enter your UTR number"
              autoComplete="off"
            />
            {paymentError ? <p className="payment-error">{paymentError}</p> : null}

            <MotionButton className="final-pay-btn" onClick={handleManualUpiPay} disabled={isPaying}>
              {isPaying ? (
                <span className="button-loading-content">
                  <PremiumLoader inline compact />
                  <span>Confirming Payment</span>
                </span>
              ) : (
                `Pay ₹${amount}`
              )}
            </MotionButton>
          </div>
        ) : (
          <>
            <p className="method-note" style={{ marginTop: "18px", textAlign: "center" }}>
              You will be redirected to complete payment securely.
            </p>

            {/* PAYMENT BUTTON */}
            <MotionButton className="final-pay-btn" onClick={handleCashfreePay} disabled={isPaying}>
              {isPaying ? (
                <span className="button-loading-content">
                  <PremiumLoader inline compact />
                  <span>Opening Secure Checkout</span>
                </span>
              ) : (
                `Pay ₹${amount}`
              )}
            </MotionButton>
          </>
        )}

      </MotionCard>
    </motion.div>
  );
}
