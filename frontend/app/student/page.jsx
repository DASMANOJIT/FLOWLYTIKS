"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import "./student.css";
import Nav from "../components/navbar/navbar.jsx";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard, MotionSection } from "../components/motion/primitives.jsx";
import GreetingPanel from "../components/dashboard/GreetingPanel.jsx";
import { clearAuthSession, getAuthToken } from "../../lib/authStorage.js";
import { downloadPaymentReceiptPdf } from "../../lib/paymentReceiptPdf.js";

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
  if (!Number.isInteger(monthIndex) || !Number.isInteger(Number(academicYear))) return null;

  const normalizedAcademicYear = Number(academicYear);
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

export default function StudentDashboard() {
  const router = useRouter();

  const [student, setStudent] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  const [totalMonthlyFees, setTotalMonthlyFees] = useState(0); // <-- dynamic fee
  const handlePay = (month) => {
  if (!student) {
    console.error("Student not loaded yet", student);
    return;
  }

  router.push(
  `/pay/${student.id}?month=${month}&amount=${student.monthlyFee}`
);

};


  const months = [
    "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
    "January", "February",
  ];

  // ===============================
  // FETCH STUDENT + PAYMENTS
  // ===============================
  useEffect(() => {
  const fetchData = async () => {
    const token = getAuthToken();
    if (!token) {
      router.push("/login");
      return;
    }

    try {
      const [studentRes, paymentRes] = await Promise.all([
        fetch(`${API_BASE}/api/students/me`, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch(`${API_BASE}/api/payments/my`, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }),
      ]);

      if (!studentRes.ok) throw new Error("Failed to fetch student");
      if (!paymentRes.ok) throw new Error("Failed to fetch payments");

      const studentData = await studentRes.json();
      setStudent(studentData);
      setTotalMonthlyFees(studentData.monthlyFee || 0);

      const paymentData = await paymentRes.json();
      setPayments(paymentData);
    } catch (err) {
      console.error("Fetch error:", err);
      clearAuthSession();
      router.push("/login");
    } finally {
      setLoading(false);
    }
  };

  fetchData();
}, [router]);

  // ===============================
  // CALCULATIONS
  // ===============================
  const paidCount = payments.filter(
    (p) => p.status === "paid"
  ).length;

  const progressPercent = (paidCount / months.length) * 100;

  // ===============================
  // UPCOMING FEE LOGIC (NO UI CHANGE)
  // ===============================
  const paidMonthsSet = new Set(
    payments.filter(p => p.status === "paid").map(p => p.month)
  );

  // All unpaid months in academic order
  const unpaidMonths = months.filter(month => !paidMonthsSet.has(month));

  // Get current academic month (March → February)
  const now = new Date();
  const jsMonthIndex = now.getMonth(); // 0 = Jan
  const academicMonthIndex = jsMonthIndex >= 2 ? jsMonthIndex - 2 : jsMonthIndex + 10;
  const currentAcademicMonth = months[academicMonthIndex];

  // Priority logic
  let upcomingMonth = { month: "All Paid", amount: 0 };

  // 1️⃣ Backlog first
  if (unpaidMonths.length > 0) {
    upcomingMonth = {
      month: unpaidMonths[0],
      amount: totalMonthlyFees,
    };
  }
  // 2️⃣ Else current month if unpaid
  else if (!paidMonthsSet.has(currentAcademicMonth)) {
    upcomingMonth = {
      month: currentAcademicMonth,
      amount: totalMonthlyFees,
    };
  }




  // ===============================
  // MODERN PDF RECEIPT
  // ===============================
  // ===============================
  // MODERN & PROFESSIONAL PDF RECEIPT
  // ===============================
  const downloadReceiptPDF = async (month) => {
    const payment = payments.find((entry) => entry.month === month && entry.status === "paid");
    if (!student || !payment) {
      alert("Receipt details are not available right now.");
      return;
    }
    try {
      await downloadPaymentReceiptPdf({
        student,
        payment,
        amountFallback: totalMonthlyFees,
        month,
      });
    } catch (error) {
      console.error("Receipt download failed:", error);
      alert("Failed to generate the receipt PDF.");
    }
  };




  if (loading) return <PremiumLoader fullScreen label="Loading student dashboard" />;

  return (
    <motion.div
      className="dashboard-wrapper"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <Nav />

      <MotionSection className="student-header" delay={0.04}>
        <div className="student-header-divider" aria-hidden="true" />
        <h1 className="student-dashboard-title">Student Dashboard</h1>
        <p className="student-subtitle">Track your fees, payments, and upcoming dues in one place.</p>
      </MotionSection>
      <MotionSection className="dashboard-top" delay={0.08}>
        <MotionCard className="total-fees-container" hover={false}>
          <h2 className="total-title">Total Monthly Fees</h2>
          <p className="total-amount">₹{totalMonthlyFees}</p>
          <p className="total-caption">
            Your standard monthly tuition amount is shown here for quick reference.
          </p>
        </MotionCard>

        <GreetingPanel
          subtitle="Keep track of today’s date, time, and your fee overview from one polished dashboard glance."
        />
      </MotionSection>

      <MotionSection className="progress-section" delay={0.12}>
        <p className="progress-label">
          Fees Paid: {paidCount}/{months.length}
        </p>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </MotionSection>

      <h3 className="section-heading">Monthly Fee Details</h3>

      <div className="month-list">
        {months.map((month) => {
          const matchingPayment = payments.find(
            (p) => p.month === month && p.status === "paid"
          );
          const isPaid = Boolean(matchingPayment);
          const isLatePayment = matchingPayment ? isLatePaymentRecord(matchingPayment) : false;

          return (
            <MotionCard key={month} className="month-card" delay={0.04}>
              <div className="month-info">
                <p className="month-name">{month}</p>
                <p className="month-fee">₹{totalMonthlyFees}</p>
                {isLatePayment ? <span className="late-payment-badge">Late Payment</span> : null}
              </div>

              {isPaid ? (
                <MotionButton
                  className="receipt-button"
                  onClick={() => downloadReceiptPDF(month)}
                >
                  Download PDF Receipt
                </MotionButton>
              ) : (
                <MotionButton
                  className="pay-button"
                  onClick={() => handlePay(month)}
                >
                  Pay Now
                </MotionButton>


              )}
            </MotionCard>
          );
        })}
      </div>

      <MotionCard className="upcoming-container" delay={0.18}>
        <h3 className="upcoming-title">Upcoming Fee</h3>
        <div className="upcoming-content">
          <div>
            <p className="upcoming-month">{upcomingMonth.month}</p>
            <p className="upcoming-amount">₹{upcomingMonth.amount}</p>
          </div>
          <span className="due-label">
            {upcomingMonth.month === "All Paid" ? "✔ No Dues" : "Due Soon"}
          </span>
        </div>
      </MotionCard>
    </motion.div>
  );
}
