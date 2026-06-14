import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const PRIMARY = [255, 49, 49];
const SECONDARY = [255, 145, 77];
const TEXT_DARK = [40, 40, 40];
const TEXT_MUTED = [110, 118, 129];
const PANEL_BG = [246, 247, 249];
const BORDER = [232, 236, 241];
const SUCCESS = [34, 197, 94];
const WARNING = [245, 158, 11];
const DANGER = [239, 68, 68];
const FONT_FILE = "NotoSans-Regular.ttf";
const FONT_NAME = "NotoSans";

let fontBase64Promise;

const safe = (value, fallback = "-") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const dateText = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const currencyText = (value, { fallback = false } = {}) =>
  `${fallback ? "Rs." : "₹"} ${new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0,
  }).format(Number(value || 0))}`;

const statusLabel = (value) =>
  safe(value, "Pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const statusColor = (status) => {
  const normalized = String(status || "").toUpperCase();
  if (["PAID", "SUCCESS", "COMPLETED"].includes(normalized)) return SUCCESS;
  if (["FAILED", "REJECTED", "REVERSED", "CANCELLED"].includes(normalized)) return DANGER;
  return WARNING;
};

const filenamePart = (value) =>
  safe(value, "faculty")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

const loadFont = async (doc) => {
  if (typeof window === "undefined") {
    return { fontName: "helvetica", currencyFallback: true };
  }

  try {
    if (!fontBase64Promise) {
      fontBase64Promise = fetch(`/fonts/${FONT_FILE}`).then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load payslip font (${response.status})`);
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        const chunkSize = 0x8000;
        let binary = "";
        for (let index = 0; index < bytes.length; index += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        return btoa(binary);
      });
    }

    const fontBase64 = await fontBase64Promise;
    const fontList = doc.getFontList?.() || {};
    if (!fontList?.[FONT_NAME]) {
      doc.addFileToVFS(FONT_FILE, fontBase64);
      doc.addFont(FONT_FILE, FONT_NAME, "normal");
      doc.addFont(FONT_FILE, FONT_NAME, "bold");
    }
    return { fontName: FONT_NAME, currencyFallback: false };
  } catch {
    return { fontName: "helvetica", currencyFallback: true };
  }
};

const loadLogo = async () => {
  if (typeof window === "undefined") return null;
  return new Promise((resolve) => {
    const image = new Image();
    image.src = "/logo.png";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
  });
};

const drawReceiptShell = ({ doc, logoImage, title, subtitle, meta, amount, status, fontName }) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const accentHeight = 10;

  for (let index = 0; index < accentHeight; index += 1) {
    const progress = index / accentHeight;
    doc.setFillColor(
      Math.round(PRIMARY[0] + (SECONDARY[0] - PRIMARY[0]) * progress),
      Math.round(PRIMARY[1] + (SECONDARY[1] - PRIMARY[1]) * progress),
      Math.round(PRIMARY[2] + (SECONDARY[2] - PRIMARY[2]) * progress)
    );
    doc.rect(0, index, pageWidth, 1, "F");
  }

  doc.setFillColor(255, 255, 255);
  doc.rect(0, accentHeight, pageWidth, pageHeight - accentHeight, "F");
  doc.setFillColor(...PRIMARY);
  doc.roundedRect(15, 16, 28, 28, 6, 6, "F");
  if (logoImage) doc.addImage(logoImage, "PNG", 17, 18, 24, 24);

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.5);
  doc.line(48, 30, pageWidth - 15, 30);
  doc.setDrawColor(...SECONDARY);
  doc.setLineWidth(1.4);
  doc.line(48, 34, 88, 34);

  doc.setTextColor(...TEXT_DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, 15, 55);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(subtitle, 15, 61);

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(15, 68, 180, 19, 6, 6, "F");
  doc.setDrawColor(...BORDER);
  doc.roundedRect(15, 68, 180, 19, 6, 6, "S");
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(1.2);
  doc.line(21, 75, pageWidth - 21, 75);

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.setFontSize(8.9);
  doc.text(meta[0][0], 22, 80);
  doc.text(meta[1][0], 76, 80);
  doc.text("Payment Status", 124, 80);
  doc.text("Paid Amount", 166, 80);

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...TEXT_DARK);
  doc.setFontSize(10.2);
  doc.text(meta[0][1], 22, 85);
  doc.text(meta[1][1], 76, 85);
  doc.setTextColor(...statusColor(status));
  doc.text(statusLabel(status).toUpperCase(), 124, 85);
  doc.setTextColor(...TEXT_DARK);
  doc.setFont(fontName, fontName === "helvetica" ? "bold" : "normal");
  doc.text(amount, 166, 85, { align: "left" });
  doc.setFont("helvetica", "normal");
};

const drawInfoTable = ({ doc, startY, title, rows, fillColor }) => {
  autoTable(doc, {
    startY,
    theme: "grid",
    head: [[title, "Information"]],
    body: rows,
    styles: {
      fontSize: 9.5,
      cellPadding: 3.1,
      textColor: TEXT_DARK,
      lineColor: BORDER,
      lineWidth: 0.2,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor,
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: PANEL_BG },
    columnStyles: {
      0: { cellWidth: 54, fontStyle: "bold" },
      1: { cellWidth: 116 },
    },
    margin: { left: 20, right: 20 },
  });
};

const normalizeDetailsRows = (payroll) => {
  const details = Array.isArray(payroll?.attendanceDetails)
    ? payroll.attendanceDetails
    : Array.isArray(payroll?.details)
    ? payroll.details
    : [];
  return details.map((row) => [
    dateText(row.date),
    safe(row.day),
    statusLabel(row.shift),
    currencyText(row.amount),
    statusLabel(row.status || (row.isPresent === false ? "Absent" : "Present")),
    safe(row.updatedByName || row.updatedBy),
    dateText(row.updatedAt),
  ]);
};

export const downloadFacultyPayslipPdf = async ({ profile, payroll }) => {
  if (!payroll) throw new Error("Payslip details are not available right now.");

  const doc = new jsPDF("p", "mm", "a4");
  const logoImage = await loadLogo();
  const { fontName, currencyFallback } = await loadFont(doc);
  const paidAmount = Number(payroll.paidAmount ?? payroll.netAmount ?? payroll.totalAmount ?? payroll.calculatedAmount ?? 0);
  const payableAmount = Number(payroll.totalPayable ?? payroll.netAmount ?? payroll.totalAmount ?? payroll.calculatedAmount ?? 0);
  const pendingAmount = Number(payroll.pendingAmount ?? Math.max(0, payableAmount - paidAmount));
  const payslipId = safe(payroll.receiptId || payroll.batchNumber || payroll.id, "PAYSLIP");
  const weekPeriod = `${safe(payroll.weekStart)} to ${safe(payroll.weekEnd)}`;
  const paymentStatus = payroll.paymentStatus || payroll.status || "PENDING";

  drawReceiptShell({
    doc,
    logoImage,
    title: "Faculty Payslip",
    subtitle: "Weekly faculty payment acknowledgement",
    meta: [
      ["Payslip ID", payslipId],
      ["Generated On", dateText(new Date())],
    ],
    amount: currencyText(paidAmount, { fallback: currencyFallback }),
    status: paymentStatus,
    fontName,
  });

  drawInfoTable({
    doc,
    startY: 96,
    title: "Faculty Details",
    fillColor: PRIMARY,
    rows: [
      ["Faculty Name", safe(profile?.fullName || profile?.name || payroll.facultyName)],
      ["Faculty ID", safe(profile?.facultyId || payroll.facultyCode || payroll.facultyId)],
      ["Phone Number", safe(profile?.phone || payroll.phone)],
      ["Email", safe(profile?.email || payroll.email)],
    ],
  });

  drawInfoTable({
    doc,
    startY: doc.lastAutoTable.finalY + 8,
    title: "Payment Details",
    fillColor: SECONDARY,
    rows: [
      ["Week Period", weekPeriod],
      ["Payment Mode", statusLabel(payroll.paymentMode || payroll.paymentMethod || "-")],
      ["Payment Status", statusLabel(paymentStatus)],
      ["Total Attendance Entries", safe(payroll.totalEntries ?? payroll.attendanceEntries ?? payroll.presentDays ?? 0, "0")],
      ["Total Payable Amount", currencyText(payableAmount, { fallback: currencyFallback })],
      ["Paid Amount", currencyText(paidAmount, { fallback: currencyFallback })],
      ["Pending Amount", currencyText(pendingAmount, { fallback: currencyFallback })],
      ["Paid Date", dateText(payroll.paidAt || payroll.paidDate)],
      ["Paid By Admin", safe(payroll.paidByAdminName || payroll.paidBy || payroll.approvedBy)],
      ["UTR / Transaction ID", safe(payroll.utr || payroll.transactionId)],
      ["Cashfree Transfer ID", safe(payroll.cashfreeTransferId)],
      ["Cashfree Reference ID", safe(payroll.cashfreeReferenceId || payroll.gatewayReference || payroll.referenceId)],
      ["Remarks", safe(payroll.remarks || payroll.failureReason)],
    ],
  });

  const detailRows = normalizeDetailsRows(payroll);
  if (detailRows.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 8,
      theme: "grid",
      head: [["Date", "Day", "Shift", "Amount", "Status", "Updated By", "Updated At"]],
      body: detailRows,
      styles: {
        fontSize: 8.5,
        cellPadding: 2.6,
        textColor: TEXT_DARK,
        lineColor: BORDER,
        lineWidth: 0.2,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: PRIMARY,
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      alternateRowStyles: { fillColor: [252, 252, 253] },
      margin: { left: 14, right: 14 },
    });
  }

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = Math.min(pageHeight - 24, (doc.lastAutoTable?.finalY || 230) + 14);
  doc.setDrawColor(...BORDER);
  doc.line(20, footerY - 6, pageWidth - 20, footerY - 6);
  doc.setTextColor(...TEXT_MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.2);
  doc.text("This is a system generated payslip and does not require a signature.", pageWidth / 2, footerY, {
    align: "center",
  });
  doc.text("Please retain this payslip for your institute records.", pageWidth / 2, footerY + 6, {
    align: "center",
  });

  doc.save(`${filenamePart(profile?.fullName || payroll.facultyName)}_${filenamePart(payslipId)}_payslip.pdf`);
};
