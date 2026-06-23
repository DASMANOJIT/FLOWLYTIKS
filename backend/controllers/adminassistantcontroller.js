import prisma from "../prisma/client.js";
import {
  ACADEMIC_YEAR_TIMEZONE,
  getAcademicYear,
  getPromotionDateGate,
} from "../utils/academicYear.js";
import { isLatePaymentForPeriod } from "../utils/paymentPeriod.js";
import { markPaidForStudent } from "../services/feeOpsService.js";
import {
  BACKGROUND_JOB_TYPES,
  createBackgroundJob,
  getBackgroundJobStatus,
} from "../services/backgroundJobService.js";
import { findActivePromotionJobForAcademicYear } from "../services/promotionService.js";
import {
  buildWhatsAppReminderState,
  mapReminderLogsByStudentId,
  WHATSAPP_REMINDER_CHANNEL,
} from "../services/reminderCooldownService.js";
import { autoPromoteIfEligible } from "./studentcontrollers.js";
import {
  isPaymentSchemaCompatibilityError,
  logPaymentCompatibilityFallback,
  stripExtendedPaymentWriteData,
} from "../utils/paymentCompat.js";

const MONTH_ALIASES = {
  march: "March",
  mar: "March",
  april: "April",
  apr: "April",
  may: "May",
  june: "June",
  jun: "June",
  july: "July",
  jul: "July",
  august: "August",
  aug: "August",
  september: "September",
  sept: "September",
  sep: "September",
  october: "October",
  oct: "October",
  november: "November",
  nov: "November",
  december: "December",
  dec: "December",
  january: "January",
  jan: "January",
  february: "February",
  feb: "February",
};

const MONTH_TO_INDEX = {
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

const sanitizePrompt = (text) => String(text || "").trim();
const lower = (text) => sanitizePrompt(text).toLowerCase();
const words = (text) => lower(text).split(/[^a-z0-9+@.-]+/).filter(Boolean);
const hasAny = (text, list) => list.some((item) => lower(text).includes(item));

const extractStudentId = (promptText) => {
  const text = lower(promptText);
  const idPatterns = [
    /\bstudent\s*(?:id)?\s*(\d+)\b/i,
    /\bid\s*(\d+)\b/i,
    /\broll\s*(\d+)\b/i,
  ];
  for (const pattern of idPatterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
};

const extractStudentNameHint = (promptText) => {
  const text = sanitizePrompt(promptText);
  const patterns = [
    /\bname\s*[:=-]?\s*([A-Za-z][A-Za-z .'-]{1,60})$/i,
    /\bstudent\s+([A-Za-z][A-Za-z .'-]{1,60})$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
};

const extractMonth = (promptText) => {
  const input = lower(promptText);
  for (const [key, value] of Object.entries(MONTH_ALIASES)) {
    const regex = new RegExp(`\\b${key}\\b`, "i");
    if (regex.test(input)) return value;
  }
  return null;
};

const extractFeeAmount = (promptText) => {
  const match = sanitizePrompt(promptText).match(/(\d{2,6})/);
  return match ? Number(match[1]) : null;
};

const extractCalendarYear = (promptText) => {
  const match = sanitizePrompt(promptText).match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[^\d]{0,8}(20\d{2}|21\d{2})\b/i
  );
  return match ? Number(match[1]) : null;
};

const buildAcademicYearLabel = (academicYear) =>
  `${academicYear}-${Number(academicYear) + 1}`;

const getCurrentReminderMonth = () =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: ACADEMIC_YEAR_TIMEZONE,
    month: "long",
  }).format(new Date());

const isBulkAllStudentsPrompt = (promptText) =>
  /\beveryone\b/i.test(promptText) ||
  /\ball\s+students\b/i.test(promptText) ||
  /\ball\b/i.test(promptText);

const isBulkMarkUnpaidPrompt = (promptText) =>
  isBulkAllStudentsPrompt(promptText) ||
  /\bany(?:one|body)\b/i.test(promptText) ||
  hasAny(promptText, ["cash payments", "admin cash payments", "manual payments"]);

const isUndoPaymentPrompt = (promptText) => {
  const text = lower(promptText);
  return (
    (hasAny(text, ["unpaid", "mistake", "remove paid status"]) &&
      hasAny(text, ["mark", "set", "make", "remove", "reverse", "undo"])) ||
    (hasAny(text, ["undo", "reverse"]) &&
      hasAny(text, ["cash payment", "cash payments", "payment"]))
  );
};

const extractBulkMarkPaidConfirmation = (promptText) => {
  const match = sanitizePrompt(promptText).match(
    /^confirm\s+mark\s+([a-z]+)(?:\s+(\d{4}))?\s+paid$/i
  );
  if (!match) return null;

  const month = MONTH_ALIASES[String(match[1] || "").toLowerCase()] || null;
  if (!month) return null;

  return {
    month,
    calendarYear: match[2] ? Number(match[2]) : null,
  };
};

const resolveAcademicYearForMonth = (month, calendarYear = null) => {
  if (!calendarYear) {
    return getAcademicYear();
  }

  const monthIndex = MONTH_TO_INDEX[month];
  if (!Number.isInteger(monthIndex)) {
    return getAcademicYear();
  }

  return monthIndex >= 2 ? Number(calendarYear) : Number(calendarYear) - 1;
};

const buildBulkMarkPaidConfirmationCommand = ({ month, calendarYear }) =>
  calendarYear
    ? `CONFIRM MARK ${month.toUpperCase()} ${calendarYear} PAID`
    : `CONFIRM MARK ${month.toUpperCase()} PAID`;

const executeBulkMarkPaidForAllStudents = async ({
  month,
  academicYear,
  monthlyFee,
  requestedByUserId = null,
}) => {
  const students = await prisma.student.findMany({
    select: { id: true, name: true },
    orderBy: { id: "asc" },
  });

  const studentIds = students.map((student) => Number(student.id));
  const existingPayments =
    studentIds.length > 0
      ? await prisma.payment.findMany({
          where: {
            studentId: { in: studentIds },
            month,
            academicYear,
          },
          select: {
            id: true,
            studentId: true,
            status: true,
          },
        })
      : [];

  const alreadyPaidPayments = existingPayments.filter(
    (payment) => String(payment.status || "").toLowerCase() === "paid"
  );
  const paymentsToUpdate = existingPayments.filter(
    (payment) => String(payment.status || "").toLowerCase() !== "paid"
  );
  const existingPaymentStudentIds = new Set(
    existingPayments.map((payment) => Number(payment.studentId))
  );
  const studentsMissingPayments = students.filter(
    (student) => !existingPaymentStudentIds.has(Number(student.id))
  );

  const paidAt = new Date();
  const paymentWriteData = {
    amount: Number(monthlyFee),
    status: "paid",
    currency: "INR",
    paymentProvider: "CASH",
    paidAt,
    isLatePayment: isLatePaymentForPeriod({
      month,
      academicYear,
      paidAt,
    }),
    phonepeTransactionId: null,
    phonepePaymentId: null,
    teacherAdminId: requestedByUserId ? Number(requestedByUserId) : null,
  };

  let updatedCount = 0;
  let createdCount = 0;

  await prisma.$transaction(async (tx) => {
    try {
      if (paymentsToUpdate.length) {
        const result = await tx.payment.updateMany({
          where: {
            id: { in: paymentsToUpdate.map((payment) => payment.id) },
            status: { not: "paid" },
          },
          data: paymentWriteData,
        });
        updatedCount = result.count;
      }

      if (studentsMissingPayments.length) {
        const result = await tx.payment.createMany({
          data: studentsMissingPayments.map((student) => ({
            studentId: Number(student.id),
            month,
            academicYear,
            ...paymentWriteData,
          })),
          skipDuplicates: true,
        });
        createdCount = result.count;
      }
    } catch (error) {
      if (!isPaymentSchemaCompatibilityError(error)) {
        throw error;
      }

      logPaymentCompatibilityFallback("executeBulkMarkPaidForAllStudents", error);
      const legacyWriteData = stripExtendedPaymentWriteData(paymentWriteData);

      if (paymentsToUpdate.length) {
        const result = await tx.payment.updateMany({
          where: {
            id: { in: paymentsToUpdate.map((payment) => payment.id) },
            status: { not: "paid" },
          },
          data: legacyWriteData,
        });
        updatedCount = result.count;
      }

      if (studentsMissingPayments.length) {
        const result = await tx.payment.createMany({
          data: studentsMissingPayments.map((student) => ({
            studentId: Number(student.id),
            month,
            academicYear,
            ...legacyWriteData,
          })),
          skipDuplicates: true,
        });
        createdCount = result.count;
      }
    }
  });

  const changedStudentIds = [
    ...paymentsToUpdate.map((payment) => Number(payment.studentId)),
    ...studentsMissingPayments.map((student) => Number(student.id)),
  ];

  await Promise.allSettled(
    changedStudentIds.map((studentId) => autoPromoteIfEligible(studentId, academicYear))
  );

  const totalChecked = students.length;
  const skippedCount = alreadyPaidPayments.length;
  const newlyMarkedPaid = updatedCount + createdCount;
  const failedCount = Math.max(0, totalChecked - skippedCount - newlyMarkedPaid);

  return {
    totalChecked,
    newlyMarkedPaid,
    skippedCount,
    failedCount,
  };
};

const matchStudentsFromPrompt = (promptText, students) => {
  const text = lower(promptText);
  const studentId = extractStudentId(promptText);
  if (studentId) {
    const byId = students.find((s) => Number(s.id) === Number(studentId));
    return byId ? [byId] : [];
  }

  const hintedName = extractStudentNameHint(promptText);
  if (hintedName) {
    const lowerHint = hintedName.toLowerCase();
    const matchedByHint = students.filter((s) =>
      String(s.name || "").toLowerCase().includes(lowerHint)
    );
    if (matchedByHint.length) return matchedByHint;
  }

  const matched = students.filter((s) =>
    text.includes(String(s.name || "").toLowerCase())
  );
  if (matched.length) return matched;

  const ignoredTokens = new Set([
    ...Object.keys(MONTH_ALIASES),
    "student",
    "mark",
    "set",
    "make",
    "remove",
    "reverse",
    "paid",
    "unpaid",
    "payment",
    "status",
    "for",
    "the",
    "this",
    "month",
    "mistake",
    "by",
    "was",
    "id",
  ]);
  const promptNameTokens = words(promptText).filter(
    (token) => token.length >= 3 && !ignoredTokens.has(token) && !/^\d+$/.test(token)
  );

  if (!promptNameTokens.length) return [];

  return students.filter((student) => {
    const nameTokens = words(student.name || "");
    return promptNameTokens.some((token) => nameTokens.includes(token));
  });
};

const runMarkPaidCommand = async (promptText, requestedByUserId = null) => {
  const confirmation = extractBulkMarkPaidConfirmation(promptText);
  if (confirmation) {
    const academicYear = resolveAcademicYearForMonth(
      confirmation.month,
      confirmation.calendarYear
    );
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    if (!settings?.monthlyFee) {
      return { ok: false, message: "Monthly fee not configured." };
    }

    const summary = await executeBulkMarkPaidForAllStudents({
      month: confirmation.month,
      academicYear,
      monthlyFee: settings.monthlyFee,
      requestedByUserId,
    });

    return {
      ok: true,
      message: [
        `Bulk mark-paid completed for ${confirmation.month} (${buildAcademicYearLabel(academicYear)}).`,
        `Total students checked: ${summary.totalChecked}`,
        `Newly marked paid: ${summary.newlyMarkedPaid}`,
        `Already paid / skipped: ${summary.skippedCount}`,
        `Failed: ${summary.failedCount}`,
      ].join("\n"),
    };
  }

  const month = extractMonth(promptText);
  if (!month) {
    return { ok: false, message: "Please mention month. Example: mark paid for Rahul for March" };
  }

  const calendarYear = extractCalendarYear(promptText);
  const academicYear = resolveAcademicYearForMonth(month, calendarYear);
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings?.monthlyFee) {
    return { ok: false, message: "Monthly fee not configured." };
  }

  const applyAll = isBulkAllStudentsPrompt(promptText);
  if (applyAll) {
    return {
      ok: true,
      requiresConfirmation: true,
      message: `This will mark all students as paid for ${month} ${buildAcademicYearLabel(
        academicYear
      )}. Type ${buildBulkMarkPaidConfirmationCommand({
        month,
        calendarYear,
      })} to continue.`,
    };
  }

  const allStudents = await prisma.student.findMany({
    select: { id: true, name: true, phone: true },
    orderBy: { id: "asc" },
  });

  const targets = applyAll ? allStudents : matchStudentsFromPrompt(promptText, allStudents);

  if (!targets.length) {
    return { ok: false, message: "No student matched. Use full name or 'student id 12'." };
  }

  let created = 0;
  let alreadyPaid = 0;
  for (const student of targets) {
    const result = await markPaidForStudent({
      student,
      month,
      academicYear,
      monthlyFee: settings.monthlyFee,
      teacherAdminId: requestedByUserId,
    });
    if (result.status === "created") created += 1;
    if (result.status === "already_paid") alreadyPaid += 1;
  }

  return {
    ok: true,
    message: `Done. Marked paid for ${created} student(s), already paid: ${alreadyPaid}, month: ${month}, academic year: ${buildAcademicYearLabel(
      academicYear
    )}.`,
  };
};

const PAYMENT_SELECT_FOR_UNDO = {
  id: true,
  studentId: true,
  month: true,
  academicYear: true,
  status: true,
  paymentProvider: true,
  teacherAdminId: true,
  phonepeTransactionId: true,
  phonepePaymentId: true,
  gatewayOrders: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      provider: true,
      paymentMethod: true,
      paymentMethodHint: true,
      cashfreeOrderId: true,
      cashfreeCfOrderId: true,
      gatewayReference: true,
      attempts: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          provider: true,
          cfPaymentId: true,
          paymentMethod: true,
          bankReference: true,
          gatewayPaymentId: true,
        },
      },
    },
  },
};

const normalizePaymentMethod = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const ONLINE_PAYMENT_METHODS = new Set([
  "PHONEPE",
  "CASHFREE",
  "UPI",
  "ONLINE",
  "GATEWAY",
  "QR",
  "BANK",
  "BANK_TRANSFER",
  "NETBANK",
  "NETBANKING",
  "NB",
  "CARD",
  "CC",
  "DC",
  "CREDIT_CARD",
  "DEBIT_CARD",
]);

const getLatestGatewayOrder = (payment) => payment?.gatewayOrders?.[0] || null;
const getLatestPaymentAttempt = (payment) => getLatestGatewayOrder(payment)?.attempts?.[0] || null;

const hasOnlinePaymentEvidence = (payment) => {
  const gatewayOrder = getLatestGatewayOrder(payment);
  const latestAttempt = getLatestPaymentAttempt(payment);
  const methodValues = [
    payment?.paymentProvider,
    gatewayOrder?.provider,
    gatewayOrder?.paymentMethod,
    gatewayOrder?.paymentMethodHint,
    latestAttempt?.provider,
    latestAttempt?.paymentMethod,
  ].map(normalizePaymentMethod);

  return (
    methodValues.some((value) => ONLINE_PAYMENT_METHODS.has(value)) ||
    Boolean(
      payment?.phonepeTransactionId ||
        payment?.phonepePaymentId ||
        gatewayOrder?.cashfreeOrderId ||
        gatewayOrder?.cashfreeCfOrderId ||
        gatewayOrder?.gatewayReference ||
        latestAttempt?.cfPaymentId ||
        latestAttempt?.bankReference ||
        latestAttempt?.gatewayPaymentId
    )
  );
};

const getUndoBlockedPaymentMethodLabel = (payment) => {
  const gatewayOrder = getLatestGatewayOrder(payment);
  const latestAttempt = getLatestPaymentAttempt(payment);
  const rawMethod =
    latestAttempt?.paymentMethod ||
    gatewayOrder?.paymentMethod ||
    gatewayOrder?.paymentMethodHint ||
    latestAttempt?.provider ||
    gatewayOrder?.provider ||
    payment?.paymentProvider ||
    "";
  const method = normalizePaymentMethod(rawMethod);

  if (method === "PHONEPE" || method === "UPI" || payment?.phonepeTransactionId || payment?.phonepePaymentId) {
    return "UPI";
  }
  if (method === "CASHFREE" || gatewayOrder?.cashfreeOrderId || gatewayOrder?.cashfreeCfOrderId || latestAttempt?.cfPaymentId) {
    return "Cashfree";
  }
  if (["BANK", "BANK_TRANSFER", "NETBANK", "NETBANKING", "NB"].includes(method)) {
    return "Bank Transfer";
  }
  if (["CARD", "CC", "DC", "CREDIT_CARD", "DEBIT_CARD"].includes(method)) {
    return "Card";
  }
  if (method === "QR") {
    return "QR";
  }
  if (method === "ONLINE" || method === "GATEWAY") {
    return "Online";
  }
  if (method === "CASH") {
    return "Cash";
  }
  return rawMethod ? String(rawMethod) : "Not Available";
};

const isUndoableAdminCashPayment = (payment) => {
  if (!payment || String(payment.status || "").toLowerCase() !== "paid") {
    return false;
  }
  if (hasOnlinePaymentEvidence(payment)) {
    return false;
  }
  const provider = normalizePaymentMethod(payment.paymentProvider);
  return provider === "CASH" || !provider || Boolean(payment.teacherAdminId);
};

const isUnknownManualPaymentWithoutOnlineTrace = (payment) =>
  String(payment?.status || "").toLowerCase() === "paid" &&
  !normalizePaymentMethod(payment?.paymentProvider) &&
  !hasOnlinePaymentEvidence(payment);

const reverseAdminCashPayment = async (payment, requestedByUserId = null) => {
  const updateData = {
    status: "pending",
    paidAt: null,
    isLatePayment: false,
    paymentProvider: null,
    teacherAdminId: requestedByUserId ? Number(requestedByUserId) : payment.teacherAdminId,
  };

  try {
    return await prisma.payment.update({
      where: { id: payment.id },
      data: updateData,
    });
  } catch (error) {
    if (!isPaymentSchemaCompatibilityError(error)) throw error;
    logPaymentCompatibilityFallback("reverseAdminCashPayment", error);
    return prisma.payment.update({
      where: { id: payment.id },
      data: stripExtendedPaymentWriteData(updateData),
    });
  }
};

const runMarkUnpaidCommand = async (promptText, requestedByUserId = null) => {
  const month = extractMonth(promptText);
  if (!month) {
    return { ok: false, message: "Please mention month. Example: mark Rahul unpaid for March" };
  }

  const calendarYear = extractCalendarYear(promptText);
  const academicYear = resolveAcademicYearForMonth(month, calendarYear);
  const academicYearLabel = buildAcademicYearLabel(academicYear);

  if (isBulkMarkUnpaidPrompt(promptText)) {
    const paidPayments = await prisma.payment.findMany({
      where: {
        month,
        academicYear,
        status: "paid",
      },
      select: {
        ...PAYMENT_SELECT_FOR_UNDO,
        student: { select: { id: true, name: true } },
      },
      orderBy: { studentId: "asc" },
    });

    let reversedCount = 0;
    let skippedOnlineCount = 0;

    for (const payment of paidPayments) {
      if (!isUndoableAdminCashPayment(payment)) {
        skippedOnlineCount += 1;
        continue;
      }
      await reverseAdminCashPayment(payment, requestedByUserId);
      reversedCount += 1;
    }

    if (!reversedCount) {
      return {
        ok: true,
        message: `No admin-entered cash/manual payments were found for ${month}. Online/UPI/Cashfree payments cannot be marked unpaid from the chatbot.`,
      };
    }

    return {
      ok: true,
      message: `Done. Marked ${reversedCount} admin-entered cash/manual payments unpaid for ${month}, academic year ${academicYearLabel}. Skipped ${skippedOnlineCount} online/UPI/Cashfree payments because they cannot be undone from the chatbot.`,
    };
  }

  const allStudents = await prisma.student.findMany({
    select: { id: true, name: true, phone: true },
    orderBy: { id: "asc" },
  });
  const targets = matchStudentsFromPrompt(promptText, allStudents);

  if (!targets.length) {
    return { ok: false, message: "No student matched. Use full name or 'student id 12'." };
  }

  if (targets.length > 1) {
    return {
      ok: false,
      message: `Multiple students matched. Please use student id. Matches: ${targets
        .slice(0, 5)
        .map((student) => `${student.name} (ID ${student.id})`)
        .join(", ")}${targets.length > 5 ? ", ..." : ""}`,
    };
  }

  const student = targets[0];
  const payment = await prisma.payment.findUnique({
    where: {
      studentId_month_academicYear: {
        studentId: Number(student.id),
        month,
        academicYear,
      },
    },
    select: PAYMENT_SELECT_FOR_UNDO,
  });

  if (!payment || String(payment.status || "").toLowerCase() !== "paid") {
    return {
      ok: true,
      message: "This student is already marked unpaid for this month.",
    };
  }

  if (!isUndoableAdminCashPayment(payment)) {
    const paymentMethod = getUndoBlockedPaymentMethodLabel(payment);
    return {
      ok: false,
      message: `This payment was made through ${paymentMethod}. Only admin-entered cash/manual payments can be undone from the admin chatbot.`,
    };
  }

  const updatedPayment = await reverseAdminCashPayment(payment, requestedByUserId);

  return {
    ok: true,
    message: `Done. Marked ${student.name} unpaid for ${month}, academic year ${buildAcademicYearLabel(
      academicYear
    )}.${isUnknownManualPaymentWithoutOnlineTrace(payment) ? " The previous record had no online payment trace." : ""}`,
    payment: {
      id: updatedPayment.id,
      studentId: updatedPayment.studentId,
      month: updatedPayment.month,
      academicYear: updatedPayment.academicYear,
      status: updatedPayment.status,
    },
  };
};

const runReminderCommand = async (promptText) => {
  const month = extractMonth(promptText) || getCurrentReminderMonth();
  const calendarYear = extractCalendarYear(promptText);
  const academicYear = resolveAcademicYearForMonth(month, calendarYear);
  const settings = await prisma.appSettings.findUnique({
    where: { id: 1 },
    select: { monthlyFee: true },
  });

  const unpaidStudents = await prisma.student.findMany({
    where: {
      payments: {
        none: {
          academicYear,
          month,
          status: "paid",
        },
      },
    },
    select: {
      id: true,
      name: true,
      class: true,
      school: true,
      phone: true,
      monthlyFee: true,
    },
    orderBy: { name: "asc" },
  });

  const reminderLogs =
    unpaidStudents.length > 0
      ? await prisma.feeReminderLog.findMany({
          where: {
            studentId: {
              in: unpaidStudents.map((student) => Number(student.id)),
            },
            month,
            academicYear,
            channel: WHATSAPP_REMINDER_CHANNEL,
          },
          select: {
            studentId: true,
            lastRemindedAt: true,
          },
        })
      : [];
  const reminderLogMap = mapReminderLogsByStudentId(reminderLogs);

  if (!unpaidStudents.length) {
    return {
      ok: true,
      month,
      message: `All students are paid for ${month}. No reminders needed.`,
    };
  }

  return {
    ok: true,
    ui: "whatsapp_reminders",
    month,
    academicYear,
    title: `Unpaid Fee Reminders for ${month}`,
    subtitle: `Found ${unpaidStudents.length} unpaid student${
      unpaidStudents.length === 1 ? "" : "s"
    }. Click a button to open WhatsApp with a pre-filled reminder.`,
    helperText:
      "WhatsApp will open with a pre-filled message. Please review and press Send. Reminder buttons have a 24-hour cooldown after opening.",
    reminders: unpaidStudents.map((student) => ({
      id: Number(student.id),
      name: student.name,
      class: student.class,
      school: student.school,
      phone: student.phone || "",
      amountDue: Number(student.monthlyFee || settings?.monthlyFee || 0),
      status: "unpaid",
      whatsappReminder: buildWhatsAppReminderState({
        isPaid: false,
        lastRemindedAt:
          reminderLogMap.get(Number(student.id))?.lastRemindedAt || null,
      }),
    })),
  };
};

const runListUnpaidCommand = async (promptText) => {
  const month = extractMonth(promptText);
  if (!month) {
    return { ok: false, message: "Please mention month. Example: list unpaid for November." };
  }

  const academicYear = getAcademicYear();
  const unpaidWhere = {
    payments: {
      none: {
        academicYear,
        month,
        status: "paid",
      },
    },
  };

  const [unpaidCount, unpaidPreview] = await Promise.all([
    prisma.student.count({ where: unpaidWhere }),
    prisma.student.findMany({
      where: unpaidWhere,
      select: {
        id: true,
        name: true,
        phone: true,
      },
      orderBy: { name: "asc" },
      take: 80,
    }),
  ]);

  if (!unpaidCount) {
    return { ok: true, message: `No unpaid students found for ${month}.` };
  }

  const lines = unpaidPreview
    .map((s, index) => `${index + 1}. ${s.name} - ${s.phone || "No phone"}`);

  return {
    ok: true,
    message: `Unpaid for ${month}: ${unpaidCount} student(s)\n${lines.join("\n")}${unpaidCount > 80 ? "\n..." : ""}`,
  };
};

const runSummaryCommand = async () => {
  const [studentCount, revenueAgg, paidCount] = await Promise.all([
    prisma.student.count(),
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: { status: "paid" },
    }),
    prisma.payment.count({ where: { status: "paid" } }),
  ]);

  return {
    ok: true,
    message: `Summary: Students ${studentCount}, paid transactions ${paidCount}, total revenue INR ${revenueAgg._sum.amount || 0}.`,
  };
};

const runPromotionCheckCommand = async (requestedByUserId = null) => {
  const gate = getPromotionDateGate();

  if (!gate.allowed || !Number.isInteger(Number(gate.academicYear))) {
    return {
      ok: false,
      message: `Promotion check is locked until February 28 or later in Asia/Kolkata. Current date: ${gate.date}.`,
    };
  }

  const targetAcademicYear = Number(gate.academicYear);
  const activeJob = await findActivePromotionJobForAcademicYear(
    targetAcademicYear
  );

  if (activeJob) {
    return {
      ok: true,
      queued: true,
      jobId: activeJob.id,
      message: `Promotion check is already ${String(activeJob.status || "").toLowerCase()} for ${buildAcademicYearLabel(
        targetAcademicYear
      )}. Job ID: ${activeJob.id}.`,
    };
  }

  const { job } = await createBackgroundJob({
    type: BACKGROUND_JOB_TYPES.ANNUAL_STUDENT_PROMOTION,
    source: "admin-assistant",
    requestedByRole: "admin",
    requestedByUserId,
    payload: {
      targetAcademicYear,
      triggeredAt: gate.date,
    },
  });

  return {
    ok: true,
    queued: true,
    jobId: job.id,
    message: `Promotion check queued for ${buildAcademicYearLabel(
      targetAcademicYear
    )}. Job ID: ${job.id}. Use the job status endpoint to see promoted, unpaid, already-promoted, and class-12 review counts.`,
  };
};

const runSetFeeCommand = async (promptText) => {
  const fee = extractFeeAmount(promptText);
  if (!fee || fee <= 0) {
    return { ok: false, message: "Please provide valid fee amount. Example: set monthly fee 700" };
  }

  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: { monthlyFee: fee },
    create: { id: 1, monthlyFee: fee },
  });

  await prisma.student.updateMany({ data: { monthlyFee: fee } });
  return { ok: true, message: `Monthly fee updated to INR ${fee}.` };
};

const runStudentDetailsCommand = async (promptText) => {
  const studentId = extractStudentId(promptText);

  let student = null;
  if (studentId) {
    student = await prisma.student.findUnique({
      where: { id: Number(studentId) },
      include: { payments: { where: { status: "paid" }, select: { month: true } } },
    });
  } else {
    const all = await prisma.student.findMany({
      include: { payments: { where: { status: "paid" }, select: { month: true } } },
      orderBy: { name: "asc" },
    });
    const matched = matchStudentsFromPrompt(promptText, all);
    student = matched[0] || null;
  }

  if (!student) {
    return { ok: false, message: "Student not found. Use full name or student id." };
  }

  return {
    ok: true,
    message: `Student ${student.name} (ID ${student.id}) | Class: ${student.class} | School: ${student.school} | Phone: ${student.phone} | Email: ${student.email || "-"} | Paid months: ${student.payments.map((p) => p.month).join(", ") || "none"}.`,
  };
};

const runUpdateStudentCommand = async (promptText) => {
  const text = sanitizePrompt(promptText);
  const studentId = extractStudentId(promptText);
  if (!studentId) {
    return { ok: false, message: "Please include student id. Example: update student id 5 phone 9876543210" };
  }

  const updates = {};

  const phoneMatch = text.match(/\bphone\s+(\+?\d{10,15})\b/i);
  if (phoneMatch) updates.phone = phoneMatch[1];

  const classMatch = text.match(/\bclass\s+([A-Za-z0-9-]+)\b/i);
  if (classMatch) updates.class = classMatch[1];

  const emailMatch = text.match(/\bemail\s+([^\s]+@[^\s]+)\b/i);
  if (emailMatch) updates.email = emailMatch[1];

  const schoolMatch = text.match(/\bschool\s+([A-Za-z0-9 .'-]{3,})$/i);
  if (schoolMatch) updates.school = schoolMatch[1].trim();

  const nameMatch = text.match(/\bname\s+([A-Za-z .'-]{3,})$/i);
  if (nameMatch) updates.name = nameMatch[1].trim();

  if (!Object.keys(updates).length) {
    return {
      ok: false,
      message:
        "No valid update field found. Supported fields: phone, class, email, school, name.",
    };
  }

  const updated = await prisma.student.update({
    where: { id: studentId },
    data: updates,
  });

  return {
    ok: true,
    message: `Student updated: ${updated.name} (ID ${updated.id}).`,
  };
};

const detectIntent = (promptText) => {
  const text = lower(promptText);
  const tokenSet = new Set(words(promptText));

  const scores = {
    markPaid: 0,
    markUnpaid: 0,
    reminder: 0,
    listUnpaid: 0,
    updateStudent: 0,
    studentDetails: 0,
    setFee: 0,
    summary: 0,
    promotionCheck: 0,
  };

  if (hasAny(text, ["mark", "paid", "payment"])) scores.markPaid += 2;
  if (extractMonth(text)) scores.markPaid += 1;

  if (isUndoPaymentPrompt(text)) {
    scores.markUnpaid += 4;
  }
  if (hasAny(text, ["paid by mistake", "marked paid by mistake", "remove paid status"])) {
    scores.markUnpaid += 4;
  }
  if (extractMonth(text)) scores.markUnpaid += 1;

  if (hasAny(text, ["reminder", "notify", "message", "whatsapp", "ping"])) scores.reminder += 2;
  if (tokenSet.has("send") || tokenSet.has("trigger")) scores.reminder += 1;

  if (hasAny(text, ["unpaid", "pending", "due", "left"])) scores.listUnpaid += 2;
  if (hasAny(text, ["list", "show", "who"])) scores.listUnpaid += 1;
  if (extractMonth(text)) scores.listUnpaid += 1;

  if (hasAny(text, ["update", "change", "edit", "modify"])) scores.updateStudent += 2;
  if (hasAny(text, ["student", "phone", "class", "email", "school", "name"])) {
    scores.updateStudent += 1;
  }

  if (hasAny(text, ["detail", "details", "info", "profile", "record"])) scores.studentDetails += 2;
  if (tokenSet.has("student") || tokenSet.has("id") || tokenSet.has("name")) {
    scores.studentDetails += 1;
  }

  if (hasAny(text, ["fee", "monthly", "charge"])) scores.setFee += 2;
  if (hasAny(text, ["set", "update", "change"])) scores.setFee += 1;

  if (hasAny(text, ["summary", "stats", "dashboard", "report", "overview", "revenue"])) {
    scores.summary += 2;
  }

  if (hasAny(text, ["promote", "promotion"])) scores.promotionCheck += 2;
  if (hasAny(text, ["run", "check", "trigger"])) scores.promotionCheck += 1;

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [intent, score] = sorted[0];
  if (!score || score < 2) return null;

  if (intent === "markPaid" && isUndoPaymentPrompt(text)) {
    return "markUnpaid";
  }

  if (intent === "markPaid" && hasAny(text, ["unpaid", "pending", "due", "left"])) {
    return "listUnpaid";
  }

  return intent;
};

export const adminAssistantChat = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ ok: false, message: "Forbidden: Admin only" });
    }

    const prompt = sanitizePrompt(req.body?.prompt);
    if (!prompt) {
      return res.status(400).json({ ok: false, message: "Prompt is required" });
    }

    const intent = detectIntent(prompt);
    const adminUserId = Number(req.user?.id || 0) || null;

    let result;
    if (intent === "markPaid") {
      result = await runMarkPaidCommand(prompt, adminUserId);
    } else if (intent === "markUnpaid") {
      result = await runMarkUnpaidCommand(prompt, adminUserId);
    } else if (intent === "reminder") {
      result = await runReminderCommand(prompt, adminUserId);
    } else if (intent === "listUnpaid") {
      result = await runListUnpaidCommand(prompt);
    } else if (intent === "updateStudent") {
      result = await runUpdateStudentCommand(prompt);
    } else if (intent === "studentDetails") {
      result = await runStudentDetailsCommand(prompt);
    } else if (intent === "setFee") {
      result = await runSetFeeCommand(prompt);
    } else if (intent === "promotionCheck") {
      result = await runPromotionCheckCommand(adminUserId);
    } else if (intent === "summary") {
      result = await runSummaryCommand();
    } else {
      result = {
        ok: false,
        message:
          "Command not recognized. Use keywords like: 'paid id 3 march', 'send fee reminder for May', 'unpaid november', 'details id 3', 'update student id 3 phone 98...', 'fee 700', 'summary', 'run promotion check'.",
      };
    }

    return res.json(result);
  } catch (err) {
    console.error("adminAssistantChat error:", err);
    return res.status(500).json({ ok: false, message: "Assistant failed to process request" });
  }
};

export const getAdminAssistantJobStatus = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ ok: false, message: "Forbidden: Admin only" });
    }

    const job = await getBackgroundJobStatus(String(req.params.jobId || ""));
    if (!job) {
      return res.status(404).json({ ok: false, message: "Job not found" });
    }

    return res.json({ ok: true, job });
  } catch (err) {
    console.error("getAdminAssistantJobStatus error:", err);
    return res.status(500).json({ ok: false, message: "Failed to fetch job status" });
  }
};
