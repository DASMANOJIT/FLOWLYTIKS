"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import "./page.css";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard, MotionSection } from "../components/motion/primitives.jsx";
import { clearAuthSession, getAuthToken } from "../../lib/authStorage.js";

// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API_BASE = "";

const PAYMENT_MONTH_TO_INDEX = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

const getPaymentPeriodEnd = (month, academicYear) => {
  const monthIndex = PAYMENT_MONTH_TO_INDEX[String(month || "").trim()];
  const normalizedAcademicYear = Number(academicYear);

  if (!Number.isInteger(monthIndex) || !Number.isInteger(normalizedAcademicYear)) {
    return null;
  }

  const calendarYear = monthIndex >= 2 ? normalizedAcademicYear : normalizedAcademicYear + 1;
  return new Date(calendarYear, monthIndex + 1, 0, 23, 59, 59, 999);
};

const isLatePaymentRecord = (payment) => {
  if (typeof payment?.isLatePayment === "boolean") {
    return payment.isLatePayment;
  }

  if (typeof payment?.receiptMeta?.isLatePayment === "boolean") {
    return payment.receiptMeta.isLatePayment;
  }

  const paidAt = payment?.receiptMeta?.paymentDate || payment?.paidAt || payment?.createdAt;
  const periodEnd = getPaymentPeriodEnd(payment?.month, payment?.academicYear);
  const paidDate = paidAt ? new Date(paidAt) : null;

  if (!periodEnd || !paidDate || Number.isNaN(paidDate.getTime())) {
    return false;
  }

  return paidDate.getTime() > periodEnd.getTime();
};

const getPaymentStatusLabel = (payment) => {
  if (payment?.receiptMeta?.paymentStatusLabel) {
    return payment.receiptMeta.paymentStatusLabel;
  }

  if (String(payment?.status || "").toLowerCase() === "paid" && isLatePaymentRecord(payment)) {
    return "Late Payment";
  }

  return String(payment?.status || "created")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

export default function StudentSelfProfile() {
  const router = useRouter();

  const [student, setStudent] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  // =========================
  // FETCH PROFILE + PAYMENTS
  // =========================
  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      router.push("/login");
      return;
    }

    Promise.all([
      fetch(`${API_BASE}/api/students/me`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`${API_BASE}/api/payments/my`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ])
      .then(async ([studentRes, paymentRes]) => {
        if (!studentRes.ok || !paymentRes.ok) throw new Error();

        const studentData = await studentRes.json();
        const paymentData = await paymentRes.json();

        setStudent(studentData);
        setPayments(paymentData || []);
      })
      .catch(() => {
        clearAuthSession();
        router.push("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <PremiumLoader fullScreen label="Loading profile" />;

  return (
    <motion.div
      className="self-profile-page"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <MotionCard className="profile-card" hover={false}>

        {/* BACK BUTTON */}
        <MotionButton
          className="back-dashboard-btn"
          onClick={() => router.push("/student")}
        >
          ← Back to Dashboard
        </MotionButton>

        {/* HEADER */}
        <MotionSection className="profile-header" delay={0.04}>
          <div className="avatar">
            {student.name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="profile-title">{student.name}</h1>
            <p className="profile-subtitle">Your Profile</p>
          </div>
        </MotionSection>

        {/* PROFILE INFO */}
        <div className="profile-grid">
          <div className="info-item">
            <span>Class</span>
            <p>{student.class || "-"}</p>
          </div>

          <div className="info-item">
            <span>School</span>
            <p>{student.school || "-"}</p>
          </div>

          <div className="info-item">
            <span>Phone</span>
            <p>{student.phone}</p>
          </div>

          <div className="info-item">
            <span>Email</span>
            <p>{student.email}</p>
          </div>
        </div>

        {/* =========================
            PAYMENT HISTORY
        ========================= */}
        <div className="payment-history">
          <h3>Payment History</h3>

          {payments.length ? (
            <div className="payment-list">
              {payments.map((p) => (
                <div key={p.id} className="payment-item">
                  <div>
                    <p className="payment-month">{p.month}</p>
                    <p className="payment-date">
                      {new Date(
                        p.receiptMeta?.paymentDate || p.paidAt || p.createdAt
                      ).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="payment-right">
                    <p className="payment-amount">₹{p.amount}</p>
                    <span
                      className={
                        getPaymentStatusLabel(p) === "Late Payment"
                          ? "status-late"
                          : p.status === "paid"
                          ? "status-paid"
                          : "status-unpaid"
                      }
                    >
                      {getPaymentStatusLabel(p)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-data">No payment records found</p>
          )}
        </div>
      </MotionCard>
    </motion.div>
  );
}
