import fs from "fs/promises";
import path from "path";
import prisma from "../prisma/client.js";
import { isLatePaymentForPeriod } from "../utils/paymentPeriod.js";

const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v20.0";
const WHATSAPP_GRAPH_URL = process.env.WHATSAPP_GRAPH_URL || "https://graph.facebook.com";
const RECEIPT_PRIMARY_COLOR = "#ff3131";
const RECEIPT_SECONDARY_COLOR = "#ff914d";
const RECEIPT_BORDER_COLOR = "#e8ecf1";
const RECEIPT_TEXT_COLOR = "#282828";
const RECEIPT_MUTED_TEXT_COLOR = "#6e7681";
const RECEIPT_SUCCESS_COLOR = "#22c55e";
const RECEIPT_WARNING_COLOR = "#ef4444";
const DEFAULT_INSTITUTE_NAME = "Subho's Computer Institute";
const RECEIPT_UNICODE_FONT_NAME = "ReceiptUnicode";

const MONTHS = [
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
];

export const isWhatsAppConfigured = () => {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
};

const normalizePhoneNumber = (rawPhone) => {
  if (!rawPhone) return null;
  const digits = String(rawPhone).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits.slice(1);

  const defaultCountryCode = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || "91";
  if (digits.length === 10) return `${defaultCountryCode}${digits}`;
  return digits;
};

const whatsappEndpoint = (suffix) =>
  `${WHATSAPP_GRAPH_URL}/${WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}${suffix}`;

const whatsappHeaders = () => ({
  Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
});

const resolveInstituteName = () => {
  const raw = String(process.env.EMAIL_FROM || "").trim();
  const match = raw.match(/^"?([^"<]+?)"?\s*</);
  return match?.[1]?.trim() || DEFAULT_INSTITUTE_NAME;
};

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

const getPaymentStatusLabel = (payment, paymentDate) => {
  const isLatePayment =
    payment?.isLatePayment ??
    isLatePaymentForPeriod({
      month: payment?.month,
      academicYear: payment?.academicYear,
      paidAt: paymentDate || payment?.paidAt || payment?.createdAt,
    });

  if (String(payment?.status || "").toLowerCase() === "paid" && isLatePayment) {
    return "Late Payment";
  }

  return String(payment?.status || "created")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const formatPaymentMethodLabel = ({ payment, gatewayOrder, latestAttempt, mode }) => {
  if (String(payment?.paymentProvider || "").trim().toUpperCase() === "CASH") {
    return "Cash";
  }

  const rawMethod =
    latestAttempt?.paymentMethod ||
    gatewayOrder?.paymentMethod ||
    gatewayOrder?.paymentMethodHint ||
    payment?.paymentProvider ||
    mode ||
    "";

  switch (String(rawMethod || "").trim().toUpperCase()) {
    case "UPI":
      return "UPI";
    case "CC":
    case "DC":
    case "CARD":
      return "Card";
    case "NB":
    case "NETBANK":
    case "NETBANKING":
      return "Net Banking";
    case "PHONEPE":
      return "UPI";
    case "CASHFREE":
      return "Online Payment";
    case "CASH":
      return "Cash";
    default:
      return rawMethod ? String(rawMethod) : "Online Payment";
  }
};

const buildReceiptNumber = (payment) =>
  `FL-${payment?.academicYear || new Date().getFullYear()}-${String(
    payment?.id || 0
  ).padStart(6, "0")}`;

const getReceiptLogoCandidates = () => [
  path.resolve(process.cwd(), "../frontend/public/logo.png"),
  path.resolve(process.cwd(), "frontend/public/logo.png"),
  path.resolve(process.cwd(), "public/logo.png"),
];

const getReceiptFontCandidates = () => [
  path.resolve(process.cwd(), "../frontend/public/fonts/NotoSans-Regular.ttf"),
  path.resolve(process.cwd(), "frontend/public/fonts/NotoSans-Regular.ttf"),
  path.resolve(process.cwd(), "public/fonts/NotoSans-Regular.ttf"),
];

const loadReceiptLogoBuffer = async () => {
  for (const candidate of getReceiptLogoCandidates()) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // Try next candidate path.
    }
  }

  return null;
};

const loadReceiptFontPath = async () => {
  for (const candidate of getReceiptFontCandidates()) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate path.
    }
  }

  return null;
};

const enrichReceiptStudent = async (student) => {
  if (!student?.id) return student || null;

  const fullStudent = await prisma.student.findUnique({
    where: { id: Number(student.id) },
    select: {
      id: true,
      name: true,
      class: true,
      school: true,
      phone: true,
      email: true,
    },
  });

  return {
    ...fullStudent,
    ...student,
  };
};

const enrichReceiptGatewayMeta = async (paymentId) => {
  if (!paymentId) return null;

  return prisma.paymentGatewayOrder.findFirst({
    where: { paymentId: Number(paymentId) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      provider: true,
      cashfreeOrderId: true,
      cashfreeCfOrderId: true,
      paymentMethod: true,
      paymentMethodHint: true,
      gatewayReference: true,
      paidAt: true,
      attempts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          cfPaymentId: true,
          paymentMethod: true,
          gatewayPaymentId: true,
          gatewayOrderReference: true,
          bankReference: true,
        },
      },
    },
  });
};

const drawReceiptSection = ({ doc, title, rows, startY, width }) => {
  const rowHeight = 14;
  const sectionHeight = 26 + rows.length * rowHeight + 10;

  doc
    .lineWidth(1)
    .fillColor("#ffffff")
    .strokeColor(RECEIPT_BORDER_COLOR)
    .roundedRect(40, startY, width, sectionHeight, 8)
    .fillAndStroke();

  doc.fillColor(RECEIPT_TEXT_COLOR).font("Helvetica-Bold").fontSize(11.5).text(title, 54, startY + 9);
  doc
    .strokeColor(RECEIPT_PRIMARY_COLOR)
    .lineWidth(1.8)
    .moveTo(54, startY + 21)
    .lineTo(132, startY + 21)
    .stroke();

  let rowY = startY + 32;
  rows.forEach(([label, value], index) => {
    if (index > 0) {
      doc
        .moveTo(52, rowY - 4)
        .lineTo(40 + width - 12, rowY - 4)
        .strokeColor(RECEIPT_BORDER_COLOR)
        .lineWidth(0.6)
        .stroke();
    }

    doc.fillColor(RECEIPT_MUTED_TEXT_COLOR).font("Helvetica-Bold").fontSize(10).text(label, 54, rowY, {
      width: 140,
    });
    doc.fillColor(RECEIPT_TEXT_COLOR).font("Helvetica").fontSize(10).text(String(value || "-"), 200, rowY, {
      width: width - 170,
      align: "left",
    });
    rowY += rowHeight;
  });

  return startY + sectionHeight + 16;
};

export const sendWhatsAppTemplateMessage = async ({
  to,
  templateName,
  languageCode = "en",
  bodyParams = [],
}) => {
  const toPhone = normalizePhoneNumber(to);
  if (!toPhone) return;

  const body = {
    messaging_product: "whatsapp",
    to: toPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: bodyParams.length
        ? [
            {
              type: "body",
              parameters: bodyParams.map((param) => ({
                type: "text",
                text: String(param),
              })),
            },
          ]
        : [],
    },
  };

  const res = await fetch(whatsappEndpoint("/messages"), {
    method: "POST",
    headers: {
      ...whatsappHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || "WhatsApp template send failed");
  }
};

export const sendWhatsAppTextMessage = async ({ to, message }) => {
  const toPhone = normalizePhoneNumber(to);
  if (!toPhone) return;

  const res = await fetch(whatsappEndpoint("/messages"), {
    method: "POST",
    headers: {
      ...whatsappHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhone,
      type: "text",
      text: {
        preview_url: false,
        body: message,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || "WhatsApp text send failed");
  }
};

export const createPaymentReceiptPdf = async ({ student, payment, mode }) => {
  let PDFDocument;
  try {
    const pdfkit = await import("pdfkit");
    PDFDocument = pdfkit.default;
  } catch (err) {
    throw new Error(
      "pdfkit is not installed. Run: cd backend && npm install pdfkit"
    );
  }

  const doc = new PDFDocument({ margin: 48, size: "A4" });
  const chunks = [];

  return new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    (async () => {
      const receiptStudent = await enrichReceiptStudent(student);
      const gatewayOrder = await enrichReceiptGatewayMeta(payment?.id);
      const effectiveGatewayOrder =
        String(payment?.paymentProvider || "").trim().toUpperCase() === "CASH"
          ? null
          : gatewayOrder;
      const latestAttempt = effectiveGatewayOrder?.attempts?.[0] || null;
      const logoBuffer = await loadReceiptLogoBuffer();
      const receiptFontPath = await loadReceiptFontPath();
      const instituteName = resolveInstituteName();
      const generatedAt = new Date();
      const academicYearLabel = payment?.academicYear
        ? `${payment.academicYear}-${payment.academicYear + 1}`
        : "-";
      const receiptNumber = buildReceiptNumber(payment);
      const pageWidth = doc.page.width;
      const contentWidth = pageWidth - 80;
      const paidOnDate =
        effectiveGatewayOrder?.paidAt ||
        latestAttempt?.paymentTime ||
        payment?.paidAt ||
        payment?.createdAt ||
        null;
      const paymentStatus = getPaymentStatusLabel(payment, paidOnDate);
      const amountPaid = formatReceiptCurrency(payment?.amount, {
        fallback: !receiptFontPath,
      });
      const receiptDate = formatReceiptDate(generatedAt);
      const transactionId =
        latestAttempt?.cfPaymentId ||
        latestAttempt?.gatewayPaymentId ||
        payment?.phonepePaymentId ||
        payment?.phonepeTransactionId ||
        String(payment?.id || "-");

      if (receiptFontPath) {
        doc.registerFont(RECEIPT_UNICODE_FONT_NAME, receiptFontPath);
      }

      doc.rect(0, 0, pageWidth, 14).fill(RECEIPT_PRIMARY_COLOR);
      doc.rect(0, 14, pageWidth, 4).fill(RECEIPT_SECONDARY_COLOR);

      doc.fillColor(RECEIPT_PRIMARY_COLOR).roundedRect(40, 24, 56, 56, 10).fill();
      if (logoBuffer) {
        doc.image(logoBuffer, 44, 28, {
          fit: [48, 48],
        });
      }

      doc
        .moveTo(112, 52)
        .lineTo(pageWidth - 44, 52)
        .strokeColor(RECEIPT_BORDER_COLOR)
        .lineWidth(0.9)
        .stroke();
      doc
        .moveTo(112, 60)
        .lineTo(190, 60)
        .strokeColor(RECEIPT_SECONDARY_COLOR)
        .lineWidth(2)
        .stroke();

      doc.fillColor(RECEIPT_TEXT_COLOR).font("Helvetica-Bold").fontSize(20).text("Payment Receipt", 40, 102, {
        width: contentWidth,
        align: "center",
      });
      doc.fillColor(RECEIPT_MUTED_TEXT_COLOR).font("Helvetica").fontSize(10.5).text(
        "Tuition fee payment acknowledgement",
        40,
        122,
        {
          width: contentWidth,
          align: "center",
        }
      );

      doc
        .lineWidth(1)
        .fillColor("#ffffff")
        .strokeColor(RECEIPT_BORDER_COLOR)
        .roundedRect(40, 144, contentWidth, 60, 10)
        .fillAndStroke();
      doc
        .moveTo(52, 158)
        .lineTo(pageWidth - 52, 158)
        .strokeColor(RECEIPT_PRIMARY_COLOR)
        .lineWidth(1.2)
        .stroke();

      doc.fillColor(RECEIPT_MUTED_TEXT_COLOR).font("Helvetica").fontSize(10);
      doc.text("Receipt Number", 56, 171);
      doc.text("Receipt Date", 194, 171);
      doc.text("Payment Status", 312, 171);
      doc.text("Amount Paid", 442, 171);

      doc.fillColor(RECEIPT_TEXT_COLOR).font("Helvetica-Bold").fontSize(11);
      doc.text(receiptNumber, 56, 186, { width: 124 });
      doc.fillColor(RECEIPT_TEXT_COLOR).text(receiptDate, 194, 186, { width: 90 });
      doc.fillColor(paymentStatus === "Late Payment" ? RECEIPT_WARNING_COLOR : RECEIPT_SUCCESS_COLOR).text(paymentStatus, 312, 186, {
        width: 110,
      });
      doc
        .fillColor(RECEIPT_TEXT_COLOR)
        .font(receiptFontPath ? RECEIPT_UNICODE_FONT_NAME : "Helvetica-Bold")
        .text(amountPaid, 442, 186, { width: 70, align: "right" });
      doc.font("Helvetica");

      let nextY = 222;
      nextY = drawReceiptSection({
        doc,
        title: "Student Details",
        rows: [
          ["Student Name", receiptStudent?.name || "-"],
          ["Student ID", receiptStudent?.id ? String(receiptStudent.id) : "-"],
          ["Class / Batch", receiptStudent?.class || "-"],
          ["Phone Number", receiptStudent?.phone || "-"],
          ["Email", receiptStudent?.email || "-"],
          ["School", receiptStudent?.school || "-"],
        ],
        startY: nextY,
        width: contentWidth,
      });

      nextY = drawReceiptSection({
        doc,
        title: "Fee Details",
        rows: [
          ["Month / Fee Period", payment?.month || "-"],
          ["Academic Year", academicYearLabel],
          ["Paid On", formatReceiptDate(paidOnDate)],
          ["Payment Status", paymentStatus],
          [
            "Payment Method",
            formatPaymentMethodLabel({
              payment,
              gatewayOrder: effectiveGatewayOrder,
              latestAttempt,
              mode,
            }),
          ],
          ["Transaction ID", transactionId],
        ],
        startY: nextY,
        width: contentWidth,
      });

      doc
        .moveTo(52, doc.page.height - 72)
        .lineTo(pageWidth - 52, doc.page.height - 72)
        .strokeColor(RECEIPT_BORDER_COLOR)
        .lineWidth(0.8)
        .stroke();

      doc.fillColor(RECEIPT_MUTED_TEXT_COLOR).font("Helvetica").fontSize(10).text(
        "This is a system generated receipt and does not require a signature.",
        40,
        doc.page.height - 56,
        { width: contentWidth, align: "center" }
      );
      doc.text("Please retain this receipt for your institute records.", 40, doc.page.height - 40, {
        width: contentWidth,
        align: "center",
      });

      doc.end();
    })().catch(reject);
  });
};

const uploadMediaToWhatsApp = async ({ fileBuffer, filename, mimeType }) => {
  const formData = new FormData();
  formData.append("messaging_product", "whatsapp");
  formData.append(
    "file",
    new Blob([fileBuffer], { type: mimeType }),
    filename
  );

  const res = await fetch(whatsappEndpoint("/media"), {
    method: "POST",
    headers: whatsappHeaders(),
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) {
    throw new Error(data?.error?.message || "WhatsApp media upload failed");
  }

  return data.id;
};

export const sendWhatsAppDocumentByMediaId = async ({
  to,
  mediaId,
  filename,
  caption,
}) => {
  const toPhone = normalizePhoneNumber(to);
  if (!toPhone) return;

  const res = await fetch(whatsappEndpoint("/messages"), {
    method: "POST",
    headers: {
      ...whatsappHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhone,
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || "WhatsApp document send failed");
  }
};

export const sendFeePaidWhatsAppNotification = async ({
  student,
  payment,
  mode,
}) => {
  if (!isWhatsAppConfigured() || !student?.phone) return;

  const templateName = process.env.WHATSAPP_FEE_PAID_TEMPLATE;
  const languageCode = process.env.WHATSAPP_TEMPLATE_LANG || "en";

  if (templateName) {
    await sendWhatsAppTemplateMessage({
      to: student.phone,
      templateName,
      languageCode,
      bodyParams: [student.name, payment.month, payment.amount],
    });
  } else {
    await sendWhatsAppTextMessage({
      to: student.phone,
      message: `Hi ${student.name}, your fee for ${payment.month} is received. Amount: INR ${payment.amount}. Mode: ${mode}.`,
    });
  }

  try {
    const pdfBuffer = await createPaymentReceiptPdf({ student, payment, mode });
    const mediaId = await uploadMediaToWhatsApp({
      fileBuffer: pdfBuffer,
      filename: `fee-receipt-${student.id}-${payment.month}.pdf`,
      mimeType: "application/pdf",
    });

    await sendWhatsAppDocumentByMediaId({
      to: student.phone,
      mediaId,
      filename: `fee-receipt-${payment.month}.pdf`,
      caption: `Receipt for ${payment.month} (${payment.academicYear}-${payment.academicYear + 1})`,
    });
  } catch (err) {
    console.error("WhatsApp PDF send skipped:", err.message);
  }
};

const getCurrentAcademicMonthIndex = () => {
  const jsMonthIndex = new Date().getMonth();
  return jsMonthIndex >= 2 ? jsMonthIndex - 2 : jsMonthIndex + 10;
};

export const getDueMonthsForReminder = ({ paidMonths }) => {
  const paidSet = new Set((paidMonths || []).map((m) => String(m)));
  const currentIndex = getCurrentAcademicMonthIndex();
  const dueMonths = [];

  for (let i = 0; i <= currentIndex; i += 1) {
    const month = MONTHS[i];
    if (!paidSet.has(month)) dueMonths.push(month);
  }

  return dueMonths;
};

export const sendFeeReminderWhatsApp = async ({
  student,
  dueMonths,
  monthlyFee,
  academicYear,
}) => {
  if (!isWhatsAppConfigured() || !student?.phone || !dueMonths.length) return;

  const templateName = process.env.WHATSAPP_FEE_REMINDER_TEMPLATE;
  const languageCode = process.env.WHATSAPP_TEMPLATE_LANG || "en";
  const totalDue = dueMonths.length * Number(monthlyFee || 0);

  if (templateName) {
    await sendWhatsAppTemplateMessage({
      to: student.phone,
      templateName,
      languageCode,
      bodyParams: [
        student.name,
        dueMonths.join(", "),
        totalDue,
        `${academicYear}-${academicYear + 1}`,
      ],
    });
    return;
  }

  await sendWhatsAppTextMessage({
    to: student.phone,
    message: `Hi ${student.name}, fee reminder for ${academicYear}-${academicYear + 1}. Pending months: ${dueMonths.join(", ")}. Total due: INR ${totalDue}.`,
  });
};
