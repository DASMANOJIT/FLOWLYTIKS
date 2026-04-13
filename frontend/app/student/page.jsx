"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import "./student.css";
import Nav from "../components/navbar/navbar.jsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard, MotionSection } from "../components/motion/primitives.jsx";
import GreetingPanel from "../components/dashboard/GreetingPanel.jsx";

// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API_BASE = "";
const RECEIPT_INSTITUTE_NAME = "Subho's Computer Institute";
const RECEIPT_PRIMARY = [255, 49, 49];
const RECEIPT_SECONDARY = [255, 145, 77];
const RECEIPT_TEXT_DARK = [40, 40, 40];
const RECEIPT_TEXT_MUTED = [110, 118, 129];
const RECEIPT_PANEL_BG = [246, 247, 249];
const RECEIPT_BORDER = [232, 236, 241];
const RECEIPT_SUCCESS = [34, 197, 94];

const formatReceiptDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date(value))
    : "-";

const formatReceiptCurrency = (amount, currency = "INR") =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));

const getReceiptPaymentMethod = (payment) =>
  payment?.receiptMeta?.paymentMethod ||
  (payment?.phonepeTransactionId ? "UPI" : "Online Payment");

const getReceiptGatewayName = (payment) =>
  payment?.receiptMeta?.paymentGateway ||
  (payment?.phonepeTransactionId ? "PhonePe" : "Online Payment");

const getReceiptNumber = (payment) =>
  payment?.receiptMeta?.receiptNumber ||
  `FL-${payment?.academicYear || new Date().getFullYear()}-${String(
    payment?.id || 0
  ).padStart(6, "0")}`;

const getReceiptFilename = ({ student, payment, month }) => {
  const namePart = String(student?.name || "student")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  return `${namePart || "student"}_${month || payment?.month || "receipt"}_receipt.pdf`;
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
    const token = localStorage.getItem("token");
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
      localStorage.removeItem("token");
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
  const downloadReceiptPDF = (month) => {
    const payment = payments.find((entry) => entry.month === month && entry.status === "paid");
    if (!student || !payment) {
      alert("Receipt details are not available right now.");
      return;
    }

    const generatedAt = new Date();
    const receiptNumber = getReceiptNumber(payment);
    const amountPaid = formatReceiptCurrency(payment?.amount || totalMonthlyFees);
    const paymentStatus = String(payment?.status || "paid").toUpperCase();
    const receiptDate = formatReceiptDate(generatedAt);
    const academicYearLabel = payment?.academicYear
      ? `${payment.academicYear}-${payment.academicYear + 1}`
      : "-";
    const transactionId =
      payment?.receiptMeta?.cashfreePaymentId ||
      payment?.receiptMeta?.transactionId ||
      String(payment?.id || "-");

    const studentRows = [
      ["Student Name", student?.name || "-"],
      ["Student ID", student?.id ? String(student.id) : "-"],
      ["Class / Batch", student?.class || "-"],
      ["School", student?.school || "-"],
      ["Phone Number", student?.phone || "-"],
      ["Email", student?.email || "-"],
    ];

    const feeRows = [
      ["Month / Fee Period", payment?.month || month || "-"],
      ["Academic Year", academicYearLabel],
      ["Payment Method", getReceiptPaymentMethod(payment)],
      ["Transaction ID", transactionId],
    ];

    const renderReceipt = (logoImage = null) => {
      const doc = new jsPDF("p", "mm", "a4");
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const accentHeight = 10;

      for (let i = 0; i < accentHeight; i += 1) {
        const progress = i / accentHeight;
        const red = Math.round(
          RECEIPT_PRIMARY[0] + (RECEIPT_SECONDARY[0] - RECEIPT_PRIMARY[0]) * progress
        );
        const green = Math.round(
          RECEIPT_PRIMARY[1] + (RECEIPT_SECONDARY[1] - RECEIPT_PRIMARY[1]) * progress
        );
        const blue = Math.round(
          RECEIPT_PRIMARY[2] + (RECEIPT_SECONDARY[2] - RECEIPT_PRIMARY[2]) * progress
        );
        doc.setFillColor(red, green, blue);
        doc.rect(0, i, pageWidth, 1, "F");
      }

      doc.setFillColor(255, 255, 255);
      doc.rect(0, accentHeight, pageWidth, pageHeight - accentHeight, "F");

      doc.setFillColor(...RECEIPT_PRIMARY);
      doc.roundedRect(15, 16, 28, 28, 6, 6, "F");
      if (logoImage) {
        doc.addImage(logoImage, "PNG", 17, 18, 24, 24);
      }

      doc.setDrawColor(...RECEIPT_BORDER);
      doc.setLineWidth(0.5);
      doc.line(48, 30, pageWidth - 15, 30);
      doc.setDrawColor(...RECEIPT_SECONDARY);
      doc.setLineWidth(1.4);
      doc.line(48, 34, 88, 34);

      doc.setTextColor(...RECEIPT_TEXT_DARK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("Payment Receipt", 15, 55);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...RECEIPT_TEXT_MUTED);
      doc.text("Tuition fee payment acknowledgement", 15, 61);

      doc.setFillColor(255, 255, 255);
      doc.roundedRect(15, 68, 180, 19, 6, 6, "F");
      doc.setDrawColor(...RECEIPT_BORDER);
      doc.roundedRect(15, 68, 180, 19, 6, 6, "S");
      doc.setDrawColor(...RECEIPT_PRIMARY);
      doc.setLineWidth(1.2);
      doc.line(21, 75, pageWidth - 21, 75);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(...RECEIPT_TEXT_MUTED);
      doc.setFontSize(8.9);
      doc.text("Receipt Number", 22, 80);
      doc.text("Receipt Date", 76, 80);
      doc.text("Payment Status", 124, 80);
      doc.text("Amount Paid", 166, 80);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(...RECEIPT_TEXT_DARK);
      doc.setFontSize(10.2);
      doc.text(receiptNumber, 22, 85);
      doc.text(receiptDate, 76, 85);
      doc.setTextColor(...RECEIPT_SUCCESS);
      doc.text(paymentStatus, 124, 85);
      doc.setTextColor(...RECEIPT_TEXT_DARK);
      doc.text(amountPaid, 166, 85, { align: "left" });

      autoTable(doc, {
        startY: 96,
        theme: "grid",
        head: [["Student Details", "Information"]],
        body: studentRows,
        styles: {
          fontSize: 9.5,
          cellPadding: 3.1,
          textColor: RECEIPT_TEXT_DARK,
          lineColor: RECEIPT_BORDER,
          lineWidth: 0.2,
          overflow: "linebreak",
        },
        headStyles: {
          fillColor: RECEIPT_PRIMARY,
          textColor: [255, 255, 255],
          fontStyle: "bold",
        },
        alternateRowStyles: {
          fillColor: RECEIPT_PANEL_BG,
        },
        columnStyles: {
          0: {
            cellWidth: 54,
            fontStyle: "bold",
          },
          1: {
            cellWidth: 116,
          },
        },
        margin: { left: 20, right: 20 },
      });

      autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 8,
        theme: "grid",
        head: [["Fee Details", "Information"]],
        body: feeRows,
        styles: {
          fontSize: 9.5,
          cellPadding: 3.1,
          textColor: RECEIPT_TEXT_DARK,
          lineColor: RECEIPT_BORDER,
          lineWidth: 0.2,
          overflow: "linebreak",
        },
        headStyles: {
          fillColor: RECEIPT_SECONDARY,
          textColor: [255, 255, 255],
          fontStyle: "bold",
        },
        alternateRowStyles: {
          fillColor: [252, 252, 253],
        },
        columnStyles: {
          0: {
            cellWidth: 54,
            fontStyle: "bold",
          },
          1: {
            cellWidth: 116,
          },
        },
        margin: { left: 20, right: 20 },
      });

      const footerY = Math.min(pageHeight - 24, doc.lastAutoTable.finalY + 14);
      doc.setDrawColor(...RECEIPT_BORDER);
      doc.line(20, footerY - 6, pageWidth - 20, footerY - 6);
      doc.setTextColor(...RECEIPT_TEXT_MUTED);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.2);
      doc.text(
        "This is a system generated receipt and does not require a signature.",
        pageWidth / 2,
        footerY,
        { align: "center" }
      );
      doc.text(
        "Please retain this receipt for your records.",
        pageWidth / 2,
        footerY + 6,
        { align: "center" }
      );

      doc.save(getReceiptFilename({ student, payment, month }));
    };

    const img = new Image();
    img.src = "/logo.png";
    img.onload = () => renderReceipt(img);
    img.onerror = () => renderReceipt(null);
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
        <h1 className="student-name">____________</h1>
        <h1 className="student-name">____________</h1>
        <p className="student-subtitle">Student Dashboard</p>
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
          const isPaid = payments.some(
            (p) => p.month === month && p.status === "paid"
          );

          return (
            <MotionCard key={month} className="month-card" delay={0.04}>
              <div className="month-info">
                <p className="month-name">{month}</p>
                <p className="month-fee">₹{totalMonthlyFees}</p>
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
