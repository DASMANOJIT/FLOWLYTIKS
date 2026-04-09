import prisma from "../prisma/client.js";
import { getAcademicYear } from "../utils/academicYear.js";
import {
  markPaidForStudent,
  sendReminderToStudent,
} from "../services/feeOpsService.js";
import {
  BACKGROUND_JOB_TYPES,
  createBackgroundJob,
  getBackgroundJobStatus,
} from "../services/backgroundJobService.js";

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
  const month = extractMonth(promptText);
  if (!month) {
    return { ok: false, message: "Please mention month. Example: mark paid for Rahul for March" };
  }

  const academicYear = getAcademicYear();
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings?.monthlyFee) {
    return { ok: false, message: "Monthly fee not configured." };
  }

  const applyAll = /\ball\s+students\b/i.test(promptText) || /\ball\b/i.test(promptText);
  if (applyAll) {
    const { job, created } = await createBackgroundJob({
      type: BACKGROUND_JOB_TYPES.ASSISTANT_BULK_MARK_PAID,
      source: "admin-assistant",
      requestedByRole: "admin",
      requestedByUserId,
      payload: {
        month,
        academicYear,
        monthlyFee: settings.monthlyFee,
      },
    });

    return {
      ok: true,
      queued: true,
      jobId: job.id,
      message: created
        ? `Bulk mark-paid job queued for ${month}. Job ID: ${job.id}.`
        : `Bulk mark-paid job is already queued. Job ID: ${job.id}.`,
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
    message: `Done. Marked paid for ${created} student(s), already paid: ${alreadyPaid}, month: ${month}.`,
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
    } else if (intent === "summary") {
      result = await runSummaryCommand();
    } else {
      result = {
        ok: false,
        message:
          "Command not recognized. Use keywords like: 'paid id 3 march', 'reminder all', 'unpaid november', 'details id 3', 'update student id 3 phone 98...', 'fee 700', 'summary'.",
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
