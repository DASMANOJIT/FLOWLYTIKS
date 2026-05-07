import prisma from "../prisma/client.js";
import { getAcademicYear, getPromotionDateGate } from "../utils/academicYear.js";
import { isLatePaymentForPeriod } from "../utils/paymentPeriod.js";
import {
  markPaidForStudent,
  sendReminderToStudent,
} from "../services/feeOpsService.js";
import {
  BACKGROUND_JOB_TYPES,
  createBackgroundJob,
  getBackgroundJobStatus,
} from "../services/backgroundJobService.js";
import { findActivePromotionJobForAcademicYear } from "../services/promotionService.js";
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

const isBulkAllStudentsPrompt = (promptText) =>
  /\beveryone\b/i.test(promptText) ||
  /\ball\s+students\b/i.test(promptText) ||
  /\ball\b/i.test(promptText);

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
  return matched;
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

const runReminderCommand = async (promptText, requestedByUserId = null) => {
  const month = extractMonth(promptText);
  const academicYear = getAcademicYear();
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  const monthlyFee = settings?.monthlyFee || 0;

  const applyAll = /\ball\s+students\b/i.test(promptText) || /\ball\b/i.test(promptText);
  if (applyAll) {
    const { job, created } = await createBackgroundJob({
      type: BACKGROUND_JOB_TYPES.ASSISTANT_BULK_REMINDER,
      source: "admin-assistant",
      requestedByRole: "admin",
      requestedByUserId,
      payload: {
        month,
        academicYear,
        monthlyFee,
      },
    });

    return {
      ok: true,
      queued: true,
      jobId: job.id,
      message: created
        ? `Reminder job queued${month ? ` for ${month}` : ""}. Job ID: ${job.id}.`
        : `Reminder job is already queued. Job ID: ${job.id}.`,
    };
  }

  const allStudents = await prisma.student.findMany({
    include: {
      payments: {
        where: { academicYear, status: "paid" },
        select: { month: true, status: true },
      },
    },
    orderBy: { id: "asc" },
  });

  const targets = applyAll ? allStudents : matchStudentsFromPrompt(promptText, allStudents);

  if (!targets.length) {
    return { ok: false, message: "No student matched. Try 'send reminder to all students'." };
  }

  let sent = 0;
  let skipped = 0;
  for (const student of targets) {
    try {
      const result = await sendReminderToStudent({
        student,
        month,
        academicYear,
        monthlyFee,
      });
      if (result.sent) sent += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      console.error(`Assistant reminder failed for ${student.id}:`, err.message);
    }
  }

  const monthInfo = month ? ` for ${month}` : "";
  return {
    ok: true,
    message: `Reminder job done${monthInfo}. Sent: ${sent}, skipped: ${skipped}.`,
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
          "Command not recognized. Use keywords like: 'paid id 3 march', 'reminder all', 'unpaid november', 'details id 3', 'update student id 3 phone 98...', 'fee 700', 'summary', 'run promotion check'.",
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
