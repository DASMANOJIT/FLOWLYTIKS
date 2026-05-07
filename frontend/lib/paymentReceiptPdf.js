import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const RECEIPT_PRIMARY = [255, 49, 49];
const RECEIPT_SECONDARY = [255, 145, 77];
const RECEIPT_TEXT_DARK = [40, 40, 40];
const RECEIPT_TEXT_MUTED = [110, 118, 129];
const RECEIPT_PANEL_BG = [246, 247, 249];
const RECEIPT_BORDER = [232, 236, 241];
const RECEIPT_SUCCESS = [34, 197, 94];
const RECEIPT_WARNING = [239, 68, 68];
const RECEIPT_PDF_FONT_FILE = "NotoSans-Regular.ttf";
const RECEIPT_PDF_FONT_NAME = "NotoSans";

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

let receiptPdfFontBase64Promise;

const formatReceiptDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      }).format(new Date(value))
    : "-";

const formatReceiptCurrency = (amount, { fallback = false } = {}) => {
  const formattedAmount = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));

  return `${fallback ? "Rs." : "₹"} ${formattedAmount}`;
};

const loadReceiptPdfFont = async (doc) => {
  if (typeof window === "undefined") {
    return { fontName: "helvetica", currencyFallback: true };
  }

  try {
    if (!receiptPdfFontBase64Promise) {
      receiptPdfFontBase64Promise = fetch(`/fonts/${RECEIPT_PDF_FONT_FILE}`).then(
        async (response) => {
          if (!response.ok) {
            throw new Error(`Unable to load receipt font (${response.status})`);
          }

          const buffer = await response.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const chunkSize = 0x8000;
          let binary = "";

          for (let index = 0; index < bytes.length; index += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
          }

          return btoa(binary);
        }
      );
    }

    const fontBase64 = await receiptPdfFontBase64Promise;
    const fontList = doc.getFontList?.() || {};

    if (!fontList?.[RECEIPT_PDF_FONT_NAME]) {
      doc.addFileToVFS(RECEIPT_PDF_FONT_FILE, fontBase64);
      doc.addFont(RECEIPT_PDF_FONT_FILE, RECEIPT_PDF_FONT_NAME, "normal");
      doc.addFont(RECEIPT_PDF_FONT_FILE, RECEIPT_PDF_FONT_NAME, "bold");
    }

    return { fontName: RECEIPT_PDF_FONT_NAME, currencyFallback: false };
  } catch (error) {
    console.warn("Receipt font fallback enabled:", error);
    return { fontName: "helvetica", currencyFallback: true };
  }
};

const getPaymentPeriodEnd = (month, academicYear) => {
  const monthIndex = PAYMENT_MONTH_TO_INDEX[String(month || "").trim()];
  if (!Number.isInteger(monthIndex) || !Number.isInteger(Number(academicYear))) {
    return null;
  }

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

  const paidAt =
    payment?.receiptMeta?.paymentDate ||
    payment?.paidAt ||
    payment?.updatedAt ||
    payment?.createdAt;
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

const getReceiptPaymentMethod = (payment) =>
  payment?.receiptMeta?.paymentMethod ||
  (String(payment?.paymentProvider || "").trim().toUpperCase() === "CASH"
    ? "Cash"
    : payment?.phonepeTransactionId
    ? "UPI"
    : "Online Payment");

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

const loadReceiptLogo = async () => {
  if (typeof window === "undefined") {
    return null;
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.src = "/logo.png";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
  });
};

export const downloadPaymentReceiptPdf = async ({
  student,
  payment,
  amountFallback = 0,
  month = null,
}) => {
  if (!student || !payment) {
    throw new Error("Receipt details are not available right now.");
  }

  const generatedAt = new Date();
  const receiptNumber = getReceiptNumber(payment);
  const paymentStatus = getPaymentStatusLabel(payment).toUpperCase();
  const paymentStatusColor =
    paymentStatus === "LATE PAYMENT" ? RECEIPT_WARNING : RECEIPT_SUCCESS;
  const receiptDate = formatReceiptDate(generatedAt);
  const paidOnDate = formatReceiptDate(
    payment?.receiptMeta?.paymentDate ||
      payment?.paidAt ||
      payment?.updatedAt ||
      payment?.createdAt
  );
  const academicYearLabel = payment?.academicYear
    ? `${payment.academicYear}-${payment.academicYear + 1}`
    : "-";
  const transactionId =
    payment?.receiptMeta?.cashfreePaymentId ||
    payment?.receiptMeta?.transactionId ||
    payment?.phonepeTransactionId ||
    payment?.phonepePaymentId ||
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
    ["Paid On", paidOnDate],
    ["Payment Status", getPaymentStatusLabel(payment)],
    ["Payment Method", getReceiptPaymentMethod(payment)],
    ["Transaction ID", transactionId],
  ];

  const logoImage = await loadReceiptLogo();
  const doc = new jsPDF("p", "mm", "a4");
  const { fontName: receiptFontName, currencyFallback } = await loadReceiptPdfFont(doc);
  const amountPaid = formatReceiptCurrency(payment?.amount || amountFallback, {
    fallback: currencyFallback,
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const accentHeight = 10;

  for (let index = 0; index < accentHeight; index += 1) {
    const progress = index / accentHeight;
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
    doc.rect(0, index, pageWidth, 1, "F");
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
  doc.setTextColor(...paymentStatusColor);
  doc.text(paymentStatus, 124, 85);
  doc.setTextColor(...RECEIPT_TEXT_DARK);
  doc.setFont(receiptFontName, receiptFontName === "helvetica" ? "bold" : "normal");
  doc.text(amountPaid, 166, 85, { align: "left" });
  doc.setFont("helvetica", "normal");

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
  doc.text("Please retain this receipt for your records.", pageWidth / 2, footerY + 6, {
    align: "center",
  });

  doc.save(getReceiptFilename({ student, payment, month }));
};
