import prisma from "../prisma/client.js";
import { createAuditLog } from "../services/auditLogService.js";

const ATTENDANCE_LOCK_MESSAGE = "Attendance for this week is locked because payout has already been processed.";
const SHIFT_LABELS = {
  MORNING: "Morning Shift",
  AFTERNOON: "Afternoon Shift",
  EVENING: "Evening Shift",
};

const MONTHS = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const moneyNumber = (value) => Number(value || 0);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const dateOnly = (value = new Date()) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const toDateKey = (value) => {
  const date = dateOnly(value);
  return date ? date.toISOString().slice(0, 10) : "";
};

const formatDate = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));

const formatDay = (value) =>
  new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(value));

const formatMoney = (value) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    moneyNumber(value)
  );

const fridayWeekStart = (value = new Date()) => {
  const date = dateOnly(value);
  const delta = (date.getUTCDay() - 5 + 7) % 7;
  return addDays(date, -delta);
};

const weekEndThursday = (weekStart) => addDays(weekStart, 6);

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[₹,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseShift = (message) => {
  if (/\bmorning\b/i.test(message)) return "MORNING";
  if (/\bafternoon\b/i.test(message)) return "AFTERNOON";
  if (/\bevening\b/i.test(message)) return "EVENING";
  return null;
};

const parseStatus = (message) => {
  if (/\b(absent|remove|clear|delete)\b/i.test(message)) return false;
  if (/\b(present|mark|set|update|change|edit|attendance)\b/i.test(message)) return true;
  return null;
};

const parseAmount = (message) => {
  const amountMatch =
    message.match(/\b(?:amount|amt|charge|to|rs|inr)\s*(?:is|as|=|:)?\s*(\d+(?:\.\d{1,2})?)\b/i) ||
    message.match(/\b(\d+(?:\.\d{1,2})?)\s*(?:rs|inr|rupees)\b/i) ||
    message.match(/\b(\d+(?:\.\d{1,2})?)\s*$/);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1]);
  if (!Number.isFinite(amount) || amount < 0) return Number.NaN;
  return Math.round(amount * 100) / 100;
};

const parseDateFromMessage = (message, now = new Date()) => {
  const lower = normalize(message);
  const today = dateOnly(now);
  if (/\btoday\b/.test(lower)) return today;
  if (/\byesterday\b/.test(lower)) return addDays(today, -1);

  const numeric = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : today.getUTCFullYear();
    const parsed = new Date(Date.UTC(year, month, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month && parsed.getUTCDate() === day) {
      return parsed;
    }
    return null;
  }

  const monthName = lower.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?\b/);
  if (monthName) {
    const day = Number(monthName[1]);
    const month = MONTHS[monthName[2]];
    const year = monthName[3] ? Number(monthName[3]) : today.getUTCFullYear();
    const parsed = new Date(Date.UTC(year, month, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month && parsed.getUTCDate() === day) {
      return parsed;
    }
    return null;
  }

  const currentWeekStart = fridayWeekStart(today);
  for (const [weekday, index] of Object.entries(WEEKDAY_INDEX)) {
    if (new RegExp(`\\b${weekday}\\b`).test(lower)) {
      const delta = (index - currentWeekStart.getUTCDay() + 7) % 7;
      return addDays(currentWeekStart, delta);
    }
  }

  return undefined;
};

const actionResponse = (res, reply, action, data = {}) => res.json({ success: true, reply, action, data });

const isFacultyWeekPayoutLocked = async (facultyId, weekStart, weekEnd) => {
  const lockedCycle = await prisma.payrollCycle.findFirst({
    where: {
      startDate: weekStart,
      endDate: weekEnd,
      OR: [
        { ledgerLocked: true },
        { status: { in: ["PAID", "LOCKED"] } },
        { payrolls: { some: { facultyId, status: { in: ["PAID", "LOCKED"] } } } },
      ],
    },
    select: { id: true, status: true },
  });
  if (lockedCycle) return lockedCycle.status === "LOCKED" ? "PAID" : lockedCycle.status;

  const lockedPayout = await prisma.facultyPayout.findFirst({
    where: {
      facultyId,
      status: { in: ["PROCESSING", "SUCCESS", "FAILED"] },
      payroll: { payrollCycle: { startDate: weekStart, endDate: weekEnd } },
    },
    select: { status: true },
  });
  return lockedPayout?.status || null;
};

const updateAttendanceFromChat = async ({ req, res, message }) => {
  const shift = parseShift(message);
  if (!shift) {
    return actionResponse(res, "Please mention the shift: morning, afternoon, or evening.", "ATTENDANCE_NEEDS_CLARIFICATION");
  }

  const attendanceDate = parseDateFromMessage(message);
  if (attendanceDate === undefined) {
    return actionResponse(res, "Please mention the exact date for attendance.", "ATTENDANCE_NEEDS_CLARIFICATION");
  }
  if (!attendanceDate) {
    return actionResponse(res, "Please mention a valid exact date for attendance.", "ATTENDANCE_NEEDS_CLARIFICATION");
  }

  const present = parseStatus(message);
  if (present === null) {
    return actionResponse(res, "Please mention whether the attendance is Present or Absent.", "ATTENDANCE_NEEDS_CLARIFICATION");
  }

  const amount = parseAmount(message);
  if (Number.isNaN(amount)) {
    return actionResponse(res, "Amount must be numeric and cannot be negative.", "ATTENDANCE_NEEDS_CLARIFICATION");
  }
  if (present && amount === null) {
    const existing = await prisma.workLedgerEntry.findUnique({
      where: { facultyId_date_shift: { facultyId: String(req.user.id), date: attendanceDate, shift } },
      select: { amount: true },
    });
    if (!existing) {
      return actionResponse(res, "Please mention the amount for this Present attendance.", "ATTENDANCE_NEEDS_CLARIFICATION");
    }
  }

  const weekStart = fridayWeekStart(attendanceDate);
  const weekEnd = weekEndThursday(weekStart);
  const lockedStatus = await isFacultyWeekPayoutLocked(String(req.user.id), weekStart, weekEnd);
  if (lockedStatus) {
    const processing = lockedStatus === "PROCESSING";
    const reply = processing
      ? `Payout for this week has already been initiated for ${formatDate(weekStart)} to ${formatDate(weekEnd)}. Attendance editing is locked.`
      : `This week is already paid for ${formatDate(weekStart)} to ${formatDate(weekEnd)}. Attendance editing is locked for this week.`;
    return actionResponse(res, reply, "ATTENDANCE_BLOCKED_LOCKED_WEEK", {
      weekStart: toDateKey(weekStart),
      weekEnd: toDateKey(weekEnd),
    });
  }

  const actorName = req.user?.fullName || req.user?.email || "Faculty";
  if (!present) {
    await prisma.workLedgerEntry.deleteMany({
      where: { facultyId: String(req.user.id), date: attendanceDate, shift },
    });
    await createAuditLog({
      req,
      action: "FACULTY_CHATBOT_ATTENDANCE_UPDATE",
      entityType: "WorkLedgerEntry",
      description: "Faculty marked attendance absent through chatbot.",
      metadata: { date: toDateKey(attendanceDate), shift, present: false },
    });
    return actionResponse(
      res,
      `Done, I marked your ${SHIFT_LABELS[shift]} as Absent for ${formatDate(attendanceDate)}.`,
      "ATTENDANCE_UPDATED",
      { date: toDateKey(attendanceDate), shift, present: false, amount: 0 }
    );
  }

  const data = {
    facultyId: String(req.user.id),
    date: attendanceDate,
    shift,
    classesTaken: 1,
    hoursWorked: 1,
    amount: amount === null ? undefined : amount,
    createdBy: String(req.user.id),
    updatedBy: String(req.user.id),
    updatedByRole: "FACULTY",
    updatedByName: actorName,
    updatedByFacultyId: String(req.user.id),
    updatedByAdminId: null,
  };

  const entry = await prisma.workLedgerEntry.upsert({
    where: { facultyId_date_shift: { facultyId: String(req.user.id), date: attendanceDate, shift } },
    update: {
      ...(amount === null ? {} : { amount }),
      updatedBy: data.updatedBy,
      updatedByRole: data.updatedByRole,
      updatedByName: data.updatedByName,
      updatedByFacultyId: data.updatedByFacultyId,
      updatedByAdminId: data.updatedByAdminId,
    },
    create: {
      ...data,
      amount: amount === null ? 0 : amount,
    },
  });

  await createAuditLog({
    req,
    action: "FACULTY_CHATBOT_ATTENDANCE_UPDATE",
    entityType: "WorkLedgerEntry",
    entityId: entry.id,
    description: "Faculty updated attendance through chatbot.",
    metadata: { date: toDateKey(attendanceDate), shift, present: true, amount: moneyNumber(entry.amount) },
  });

  return actionResponse(
    res,
    `Done, I marked your ${SHIFT_LABELS[shift]} attendance as Present for ${formatDate(attendanceDate)} with ${formatMoney(entry.amount)}.`,
    "ATTENDANCE_UPDATED",
    { id: entry.id, date: toDateKey(attendanceDate), shift, present: true, amount: moneyNumber(entry.amount) }
  );
};

const payoutStatus = async ({ req, res, message }) => {
  const requestedDate = parseDateFromMessage(message);
  const baseDate = requestedDate || new Date();
  const weekStart = fridayWeekStart(baseDate);
  const weekEnd = weekEndThursday(weekStart);
  const now = dateOnly(new Date());

  const payroll = await prisma.facultyEarningsPayroll.findFirst({
    where: {
      facultyId: String(req.user.id),
      payrollCycle: { startDate: weekStart, endDate: weekEnd },
    },
    include: {
      payrollCycle: true,
      payouts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!payroll) {
    const stillRunning = now <= weekEnd;
    const reply = stillRunning
      ? `Record does not exist for this week yet. This week is still in progress from ${formatDate(weekStart)} to ${formatDate(weekEnd)}. The record may appear after the week is completed and admin generates payroll.`
      : `Record does not exist for this week yet for ${formatDate(weekStart)} to ${formatDate(weekEnd)}.`;
    return actionResponse(res, reply, "PAYOUT_STATUS", { weekStart: toDateKey(weekStart), weekEnd: toDateKey(weekEnd) });
  }

  const payout = payroll.payouts?.[0] || null;
  const status = payout?.status || payroll.status;
  const amount = payout?.amount || payroll.totalAmount;
  const weekText = `${formatDate(weekStart)} to ${formatDate(weekEnd)}`;

  if (payout?.status === "SUCCESS" || payroll.status === "PAID") {
    const paidDate = payout?.paidAt || payout?.payoutCompletedAt || payroll.paidAt;
    const utr = payout?.utr || payout?.transactionId || payout?.cashfreeReferenceId;
    const suffix = `${paidDate ? ` Paid date: ${formatDate(paidDate)}.` : ""}${utr ? ` UTR/Transaction ID: ${utr}.` : ""}`;
    return actionResponse(res, `Your payout for ${weekText} is paid. Amount: ${formatMoney(amount)}.${suffix}`, "PAYOUT_STATUS", {
      weekStart: toDateKey(weekStart),
      weekEnd: toDateKey(weekEnd),
      status: "PAID",
    });
  }

  if (payout?.status === "PROCESSING") {
    return actionResponse(res, `Your payout for ${weekText} has been initiated and is processing. Amount: ${formatMoney(amount)}.`, "PAYOUT_STATUS", {
      weekStart: toDateKey(weekStart),
      weekEnd: toDateKey(weekEnd),
      status: "PROCESSING",
    });
  }

  if (payout?.status === "FAILED") {
    const reason = payout.failureReason ? ` Reason: ${payout.failureReason}.` : "";
    return actionResponse(res, `Your payout for ${weekText} failed. Amount: ${formatMoney(amount)}.${reason} Please contact admin.`, "PAYOUT_STATUS", {
      weekStart: toDateKey(weekStart),
      weekEnd: toDateKey(weekEnd),
      status: "FAILED",
    });
  }

  if (now <= weekEnd) {
    return actionResponse(
      res,
      `This week is still running from ${formatDate(weekStart)} to ${formatDate(weekEnd)}. Your payout status should be available after ${formatDate(weekEnd)} once admin generates payroll.`,
      "PAYOUT_STATUS",
      { weekStart: toDateKey(weekStart), weekEnd: toDateKey(weekEnd), status }
    );
  }

  return actionResponse(res, `Your payout for ${weekText} is pending. Amount: ${formatMoney(amount)}. Please wait for admin to initiate payout.`, "PAYOUT_STATUS", {
    weekStart: toDateKey(weekStart),
    weekEnd: toDateKey(weekEnd),
    status,
  });
};

const adminContact = async (res) => {
  const admin = await prisma.admin.findFirst({
    orderBy: { id: "asc" },
    select: { email: true, name: true },
  });
  if (!admin?.email) {
    return actionResponse(res, "Please contact your institute admin for further assistance.", "ADMIN_CONTACT");
  }
  return actionResponse(res, `For further assistance, please contact the admin. Email: ${admin.email}.`, "ADMIN_CONTACT", {
    email: admin.email,
  });
};

export const facultyChatbotMessage = async (req, res) => {
  try {
    if (req.userRole !== "faculty" || !req.user?.id) {
      return res.status(403).json({ success: false, message: "Faculty access only." });
    }

    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({ success: false, message: "Message is required." });
    }
    if (message.length > 500) {
      return res.status(400).json({ success: false, message: "Message is too long." });
    }

    const lower = normalize(message);
    const hasAttendanceWords = /\b(attendance|mark|present|absent|shift|morning|afternoon|evening|amount|remove|clear|change|edit|set)\b/.test(lower);
    const hasPayoutWords = /\b(payout|paid|payment|salary|earning|utr|transaction|pending|processing|failed|received|pay)\b/.test(lower);
    const hasPayoutDetailsWords = /\b(upi|bank|account|payout details|payout detail)\b/.test(lower);
    const hasPasswordWords = /\b(password|reset|otp|login)\b/.test(lower);
    const hasDateWords = /\b(today|date|day|week|which week|what is today)\b/.test(lower);
    const hasContactWords = /\b(admin|contact|help|support)\b/.test(lower);

    if (hasPayoutDetailsWords && /\b(update|add|change|edit|where|how)\b/.test(lower)) {
      return actionResponse(
        res,
        "Go to My Profile → Payout Details → Update Payout Details. Add or update your UPI ID/bank details and save. After you update it, the status will become Pending Review. Admin must verify it before payouts can be sent.",
        "PAYOUT_DETAILS_HELP"
      );
    }

    if (hasPasswordWords) {
      return actionResponse(
        res,
        "Go to My Profile → Security Settings. You can use Change Password if you know your current password, or Reset with OTP if you want to verify by email.",
        "PASSWORD_HELP"
      );
    }

    if (hasAttendanceWords && (parseShift(message) || /\b(attendance|present|absent|mark|remove|clear|change|edit|set)\b/.test(lower))) {
      return updateAttendanceFromChat({ req, res, message });
    }

    if (hasPayoutWords) {
      return payoutStatus({ req, res, message });
    }

    if (hasDateWords) {
      const today = dateOnly(new Date());
      const weekStart = fridayWeekStart(today);
      const weekEnd = weekEndThursday(weekStart);
      return actionResponse(
        res,
        `Today is ${formatDay(today)}, ${formatDate(today)}. Your current attendance week is ${formatDate(weekStart)} to ${formatDate(weekEnd)}.`,
        "DATE_INFO",
        { today: toDateKey(today), weekStart: toDateKey(weekStart), weekEnd: toDateKey(weekEnd) }
      );
    }

    if (hasContactWords) {
      return adminContact(res);
    }

    return actionResponse(res, "Please be professional.", "PROFESSIONAL_FALLBACK");
  } catch (error) {
    console.error("Faculty chatbot error:", error?.message || error);
    return res.status(500).json({ success: false, reply: "Assistant request failed. Please try again.", action: "ERROR" });
  }
};
