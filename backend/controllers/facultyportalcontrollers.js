import { attendanceDateKey, attendanceWeek, dailyAttendanceRate, attendancePayoutLocked, setDailyAttendance, refreshDraftAttendancePayroll, lockAttendanceDates, assertAttendanceDeadline, assertAttendanceMutable } from "../services/dailyAttendanceService.js";
import prisma from "../prisma/client.js";
import { toDateKey } from "../services/facultyPayrollService.js";
import { listFacultyNotificationLogs } from "../services/notificationService.js";

const moneyNumber = (value) => Number(value || 0);

const requireFaculty = (req, res) => {
  if (req.userRole === "faculty" && req.user?.id) return true;
  res.status(403).json({ success: false, message: "Faculty access only." });
  return false;
};

const requireFacultyOrAdmin = (req, res) => {
  if ((req.userRole === "faculty" || req.userRole === "admin") && req.user?.id) return true;
  res.status(403).json({ success: false, message: "Forbidden." });
  return false;
};

const dateOnly = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const monthRange = (month, year) => {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end };
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const fridayWeekStart = (value = new Date()) => {
  return attendanceWeek(value).start;
};

const sumAmounts = (entries) =>
  moneyNumber(entries.reduce((total, entry) => total + moneyNumber(entry.amount), 0));

const ATTENDANCE_LOCK_MESSAGE = "Attendance for this week is locked because payout has already been processed.";

const getActorMetadata = (req) => {
  if (req.userRole === "faculty") {
    return {
      updatedBy: req.user?.id ? String(req.user.id) : "faculty",
      updatedByRole: "FACULTY",
      updatedByName: req.user?.fullName || req.user?.name || req.user?.email || "Faculty",
      updatedByFacultyId: req.user?.id ? String(req.user.id) : null,
      updatedByAdminId: null,
    };
  }
  if (req.userRole === "admin") {
    return {
      updatedBy: req.user?.id ? String(req.user.id) : "admin",
      updatedByRole: "ADMIN",
      updatedByName: req.user?.name || req.user?.email || "Admin",
      updatedByFacultyId: null,
      updatedByAdminId: req.user?.id ? Number(req.user.id) : null,
    };
  }
  return {
    updatedBy: "system",
    updatedByRole: null,
    updatedByName: null,
    updatedByFacultyId: null,
    updatedByAdminId: null,
  };
};

const isFacultyWeekPayoutLocked = async (facultyId, weekStart, weekEnd) => {
  const startDate = new Date(weekStart);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(weekEnd);
  endDate.setUTCHours(0, 0, 0, 0);
  const lockedCycle = await prisma.payrollCycle.findFirst({
    where: {
      startDate,
      endDate,
      OR: [
        { ledgerLocked: true },
        { status: { in: ["PAID", "LOCKED"] } },
        {
          payrolls: {
            some: {
              facultyId,
              status: { in: ["PAID", "LOCKED"] },
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  if (lockedCycle) return true;

  const lockedPayout = await prisma.facultyPayout.findFirst({
    where: {
      facultyId,
      status: { in: ["PROCESSING", "SUCCESS", "FAILED"] },
      payroll: {
        payrollCycle: {
          startDate,
          endDate,
        },
      },
    },
    select: { id: true },
  });
  return Boolean(lockedPayout);
};

const buildAttendanceCell = (entry, fallbackAmount = 0) =>
  entry
    ? {
        present: true,
        id: entry.id,
        amount: moneyNumber(entry.amount),
        classesTaken: Number(entry.classesTaken || 1),
        updatedAt: entry.updatedAt?.toISOString?.() || null,
        updatedBy: entry.updatedBy || null,
        updatedByRole: entry.updatedByRole || null,
        updatedByName: entry.updatedByName || null,
      }
    : {
        present: false,
        amount: moneyNumber(fallbackAmount),
        updatedAt: null,
        updatedBy: null,
        updatedByRole: null,
        updatedByName: null,
      };

const facultyTableExists = async (tableName) => {
  const rows = await prisma.$queryRaw`SELECT to_regclass(${tableName})::text AS name`;
  return Boolean(rows?.[0]?.name);
};

const elapsedDaysInMonth = (month, year) => {
  const now = new Date();
  if (now.getUTCFullYear() === year && now.getUTCMonth() + 1 === month) {
    return now.getUTCDate();
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
};

const buildAttendanceSummary = ({ entries, month, year }) => {
  const byDate = new Map();
  entries.forEach((entry) => {
    const key = toDateKey(entry.date);
    const shifts = byDate.get(key) || new Set();
    shifts.add(entry.shift);
    byDate.set(key, shifts);
  });

  let presentDays = 0;
  let halfDays = 0;
  const calendar = [];
  const totalTrackedDays = elapsedDaysInMonth(month, year);

  for (let day = 1; day <= totalTrackedDays; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const key = toDateKey(date);
    const shifts = byDate.get(key);
    const shiftCount = shifts?.size || 0;
    const status = shifts?.has("DAILY") || shiftCount >= 2 ? "PRESENT" : shiftCount === 1 ? "HALF_DAY" : "ABSENT";
    if (status === "PRESENT") presentDays += 1;
    if (status === "HALF_DAY") halfDays += 1;
    calendar.push({ date: key, status, shiftCount });
  }

  const absentDays = Math.max(totalTrackedDays - presentDays - halfDays, 0);
  const attendancePercentage = totalTrackedDays
    ? Math.round(((presentDays + halfDays * 0.5) / totalTrackedDays) * 100)
    : 0;

  return { presentDays, halfDays, absentDays, attendancePercentage, calendar };
};

const toWorkLedgerDto = (entry) => ({
  id: entry.id,
  date: toDateKey(entry.date),
  shift: entry.shift,
  subject: entry.subject || entry.shift.replace("_", " "),
  classesTaken: Number(entry.classesTaken || 1),
  hoursWorked: moneyNumber(entry.hoursWorked || 1),
  remarks: entry.remarks || "",
});

const toPayrollDto = (payroll) => ({
  id: payroll.id,
  weekStart: toDateKey(payroll.payrollCycle.startDate),
  weekEnd: toDateKey(payroll.payrollCycle.endDate),
  batchNumber: payroll.payrollCycle.cycleNumber,
  presentDays: 0,
  halfDays: 0,
  absentDays: 0,
  totalEntries: Number(payroll.totalEntries || 0),
  totalAmount: moneyNumber(payroll.totalAmount),
  calculatedAmount: moneyNumber(payroll.totalAmount),
  bonus: moneyNumber(payroll.bonus),
  deduction: moneyNumber(payroll.deduction),
  netAmount: moneyNumber(payroll.totalAmount),
  paymentStatus: payroll.status === "PAID" ? "PAID" : "PENDING",
  status: payroll.status,
  approvedBy: payroll.approvedBy,
  approvedAt: payroll.approvedAt,
  paidBy: payroll.paidBy,
  paidAt: payroll.paidAt,
  generatedAt: payroll.createdAt,
});

const baseFacultySelect = {
  id: true,
  facultyId: true,
  username: true,
  fullName: true,
  phone: true,
  email: true,
  gender: true,
  dob: true,
  address: true,
  designation: true,
  qualification: true,
  experienceYears: true,
  joiningDate: true,
  employmentType: true,
  salaryType: true,
  salaryAmount: true,
  status: true,
  profilePictures: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { imageUrl: true, createdAt: true },
  },
};

const toProfileDto = (faculty) => ({
  ...faculty,
  profilePictureUrl: faculty.profilePictures?.[0]?.imageUrl || null,
  profilePictures: undefined,
});

export const getFacultyDashboard = async (req, res) => {
  try {
    if (!requireFaculty(req, res)) return null;
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const { start, end } = monthRange(month, year);
    const weekStart = fridayWeekStart(now);
    const weekEnd = addDays(weekStart, 6);
    const previousWeekStart = addDays(weekStart, -7);
    const previousWeekEnd = addDays(weekEnd, -7);
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    const facultyId = req.user.id;
    const hasFacultyPayoutTable = await facultyTableExists('public."FacultyPayout"');

    const [faculty, bankAccount, weekEntries, previousWeekEntries, monthEntries, yearEntries, allEntries, payrolls, payouts, notifications] = await Promise.all([
      prisma.faculty.findUnique({ where: { id: facultyId }, select: baseFacultySelect }),
      prisma.facultyBankAccount.findFirst({
        where: { facultyId },
        orderBy: { updatedAt: "desc" },
        select: {
          payoutMode: true,
          verificationStatus: true,
          payoutEligible: true,
        },
      }).catch(() => null),
      prisma.workLedgerEntry.findMany({
        where: { facultyId, date: { gte: weekStart, lte: weekEnd } },
        select: { date: true, shift: true, amount: true, classesTaken: true, hoursWorked: true },
      }),
      prisma.workLedgerEntry.findMany({
        where: { facultyId, date: { gte: previousWeekStart, lte: previousWeekEnd } },
        select: { date: true, shift: true, amount: true },
      }),
      prisma.workLedgerEntry.findMany({
        where: { facultyId, date: { gte: start, lte: end } },
        select: { date: true, shift: true, amount: true, classesTaken: true, hoursWorked: true },
      }),
      prisma.workLedgerEntry.findMany({
        where: { facultyId, date: { gte: yearStart, lte: yearEnd } },
        select: { date: true, shift: true, amount: true },
      }),
      prisma.workLedgerEntry.findMany({
        where: { facultyId },
        select: { date: true, shift: true, amount: true },
      }),
      prisma.facultyEarningsPayroll.findMany({
        where: { facultyId },
        orderBy: [{ payrollCycle: { startDate: "desc" } }],
        take: 8,
        include: { payrollCycle: true },
      }),
      hasFacultyPayoutTable
        ? prisma.facultyPayout.findMany({
          where: { facultyId },
          orderBy: { createdAt: "desc" },
          take: 12,
          include: {
            payroll: {
              include: { payrollCycle: true },
            },
          },
        })
        : Promise.resolve([]),
      prisma.notification.findMany({
        where: { facultyId },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const attendance = buildAttendanceSummary({ entries: monthEntries, month, year });
    const currentWeekIncome = sumAmounts(weekEntries);
    const previousWeekIncome = sumAmounts(previousWeekEntries);
    const currentMonthIncome = sumAmounts(monthEntries);
    const currentYearIncome = sumAmounts(yearEntries);
    const totalEarning = sumAmounts(allEntries);
    const paidAmount = moneyNumber(
      payrolls
        .filter((item) => item.status === "PAID")
        .reduce((sum, item) => sum + moneyNumber(item.totalAmount), 0)
    );
    const unpaidAmount = Math.max(totalEarning - paidAmount, 0);
    const processed = payrolls.find((item) => item.status === "PAID") || null;
    const pending = payrolls.find((item) => item.status !== "PAID") || null;
    const workLedger = monthEntries.reduce(
      (total, entry) => ({
        classesTaken: total.classesTaken + Number(entry.classesTaken || 1),
        hoursWorked: total.hoursWorked + moneyNumber(entry.hoursWorked || 1),
        workEntries: total.workEntries + 1,
      }),
      { classesTaken: 0, hoursWorked: 0, workEntries: 0 }
    );
    const payoutHistory = payouts.map((payout) => {
      const totalAmount = moneyNumber(payout.payroll?.totalAmount || payout.amount || 0);
      const paid = payout.status === "SUCCESS" ? moneyNumber(payout.amount) : 0;
      return {
        id: payout.id,
        weekPeriod: payout.payroll?.payrollCycle
          ? `${toDateKey(payout.payroll.payrollCycle.startDate)} to ${toDateKey(payout.payroll.payrollCycle.endDate)}`
          : "-",
        totalAttendanceAmount: totalAmount,
        paidAmount: paid,
        pendingAmount: Math.max(totalAmount - paid, 0),
        status:
          payout.status === "SUCCESS"
            ? "Paid"
            : payout.status === "PROCESSING"
            ? "Processing"
            : paid > 0
            ? "Partially Paid"
            : "Unpaid",
        paidDate: payout.paidAt ? payout.paidAt.toISOString() : null,
        transactionId: payout.utr || payout.transactionId || "",
        remark: payout.failureReason || payout.utr || payout.transactionId || payout.referenceId || payout.gatewayReference || "",
      };
    });
    const weeklyChart = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const key = toDateKey(date);
      return {
        label: key.slice(5),
        value: sumAmounts(weekEntries.filter((entry) => toDateKey(entry.date) === key)),
      };
    });
    const monthlyChart = Array.from({ length: 12 }, (_, index) => {
      const value = sumAmounts(yearEntries.filter((entry) => entry.date.getUTCMonth() === index));
      return { label: new Date(Date.UTC(year, index, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" }), value };
    });
    const yearlyChart = [{ label: String(year), value: currentYearIncome }];
    const summary = {
      currentWeekEarning: currentWeekIncome,
      previousWeekEarning: previousWeekIncome,
      pendingPayoutAmount: unpaidAmount,
      currentWeekIncome,
      previousWeekIncome,
      currentMonthIncome,
      currentYearIncome,
      totalEarning,
      paidAmount,
      unpaidAmount,
      totalAttendanceEntries: allEntries.length,
    };

    return res.json({
      success: true,
      profile: toProfileDto(faculty),
      faculty: toProfileDto(faculty),
      bankAccount: bankAccount
        ? {
            payoutMode: bankAccount.payoutMode,
            verificationStatus: bankAccount.verificationStatus,
            payoutEligible: bankAccount.payoutEligible,
          }
        : null,
      summary,
      attendance,
      attendanceGrid: [],
      salary: {
        currentWeekSalary: currentWeekIncome,
        currentMonthSalary: currentMonthIncome,
        lastProcessedSalary: moneyNumber(processed?.totalAmount || 0),
        paymentStatus: pending?.status || processed?.status || "DRAFT",
      },
      workLedger,
      charts: {
        weekly: weeklyChart,
        monthly: monthlyChart,
        yearly: yearlyChart,
        attendanceTrend: attendance.calendar.map((item) => ({
          label: item.date.slice(5),
          value: item.status === "PRESENT" ? 100 : item.status === "HALF_DAY" ? 50 : 0,
        })),
        salaryTrend: payrolls.slice().reverse().map((item) => ({
          label: item.payrollCycle.cycleNumber,
          value: moneyNumber(item.totalAmount),
        })),
      },
      payoutHistory,
      notifications,
    });
  } catch (error) {
    console.error("Faculty portal dashboard error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load faculty dashboard." });
  }
};

export const getMyFacultyProfileForPortal = async (req, res) => {
  try {
    if (!requireFaculty(req, res)) return null;
    const faculty = await prisma.faculty.findUnique({
      where: { id: req.user.id },
      select: baseFacultySelect,
    });
    return res.json({ success: true, faculty: toProfileDto(faculty) });
  } catch (error) {
    console.error("Faculty portal profile error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load faculty profile." });
  }
};

export const updateMyFacultyPortalProfile = async (req, res) => {
  try {
    if (!requireFaculty(req, res)) return null;
    const { profilePictureUrl, ...profileData } = req.body;
    const data = { ...profileData };
    if (data.phone) data.phone = String(data.phone).replace(/\D/g, "");

    const faculty = await prisma.$transaction(async (tx) => {
      if (profilePictureUrl) {
        await tx.profilePicture.create({
          data: { facultyId: req.user.id, imageUrl: profilePictureUrl },
        });
      }
      return tx.faculty.update({
        where: { id: req.user.id },
        data,
        select: baseFacultySelect,
      });
    });

    return res.json({ success: true, faculty: toProfileDto(faculty) });
  } catch (error) {
    if (error?.code === "P2002") {
      return res.status(409).json({ success: false, message: "This mobile number is already in use." });
    }
    console.error("Faculty portal profile update error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to update faculty profile." });
  }
};

export const getMyAttendance = async (req, res) => {
  try {
    if (!requireFaculty(req, res)) return null;
    const { month, year } = req.query;
    const { start, end } = monthRange(month, year);
    const entries = await prisma.workLedgerEntry.findMany({
      where: { facultyId: req.user.id, date: { gte: start, lte: end } },
      select: { date: true, shift: true },
      orderBy: { date: "asc" },
    });
    return res.json({
      success: true,
      month,
      year,
      attendance: buildAttendanceSummary({ entries, month, year }),
    });
  } catch (error) {
    console.error("Faculty portal attendance error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load attendance." });
  }
};

export const getMyWorkLedger = async (req, res) => {
  try {
    if (!requireFaculty(req, res)) return null;
    const now = new Date();
    let start = dateOnly(req.query.startDate);
    let end = dateOnly(req.query.endDate);
    if (!start || !end) {
      const range = monthRange(req.query.month || now.getUTCMonth() + 1, req.query.year || now.getUTCFullYear());
      start = range.start;
      end = range.end;
    }
    const entries = await prisma.workLedgerEntry.findMany({
      where: { facultyId: req.user.id, date: { gte: start, lte: end } },
      orderBy: [{ date: "desc" }, { shift: "asc" }],
    });
    const rows = entries.map(toWorkLedgerDto);
    return res.json({
      success: true,
      entries: rows,
      summary: rows.reduce(
        (total, entry) => ({
          totalClasses: total.totalClasses + entry.classesTaken,
          totalHours: total.totalHours + entry.hoursWorked,
        }),
        { totalClasses: 0, totalHours: 0 }
      ),
    });
  } catch (error) {
    console.error("Faculty portal work ledger error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load work ledger." });
  }
};

export const getMyPayrollHistory = async (req, res) => {
  try {
    if (!requireFaculty(req, res)) return null;
    const payrolls = await prisma.facultyEarningsPayroll.findMany({
      where: { facultyId: req.user.id },
      include: { payrollCycle: true },
      orderBy: [{ payrollCycle: { startDate: "desc" } }],
    });
    return res.json({ success: true, payrolls: payrolls.map(toPayrollDto) });
  } catch (error) {
    console.error("Faculty portal payroll error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load payroll history." });
  }
};

export const getMyPayoutHistory = async (req, res) => {
  try {
    if (!requireFaculty(req, res)) return null;
    const hasFacultyPayoutTable = await facultyTableExists('public."FacultyPayout"');
    if (!hasFacultyPayoutTable) {
      return res.json({ success: true, payoutHistory: [] });
    }
    const payouts = await prisma.facultyPayout.findMany({
      where: { facultyId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        payroll: {
          include: { payrollCycle: true },
        },
      },
    });
    return res.json({
      success: true,
      payoutHistory: payouts.map((payout) => {
        const totalAmount = moneyNumber(payout.payroll?.totalAmount || payout.amount || 0);
        const paid = payout.status === "SUCCESS" ? moneyNumber(payout.amount) : 0;
        return {
          id: payout.id,
          weekPeriod: payout.payroll?.payrollCycle
            ? `${toDateKey(payout.payroll.payrollCycle.startDate)} to ${toDateKey(payout.payroll.payrollCycle.endDate)}`
            : "-",
          amount: totalAmount,
          totalAttendanceAmount: totalAmount,
          paidAmount: paid,
          pendingAmount: Math.max(totalAmount - paid, 0),
          status: payout.status,
          paidDate: payout.paidAt ? payout.paidAt.toISOString() : null,
          transactionId: payout.utr || payout.transactionId || "",
          remarks: payout.failureReason || payout.utr || payout.transactionId || payout.referenceId || payout.gatewayReference || "",
        };
      }),
    });
  } catch (error) {
    console.error("Faculty payout history error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load payout history." });
  }
};

export const getMyNotifications = async (req, res) => {
  try {
    if (!requireFaculty(req, res)) return null;
    const [inAppNotifications, deliveryLogs] = await Promise.all([
      prisma.notification.findMany({
        where: { facultyId: req.user.id },
        orderBy: { createdAt: "desc" },
      }),
      listFacultyNotificationLogs(req.user.id),
    ]);
    const notifications = [
      ...deliveryLogs.map((log) => ({
        id: log.id,
        title: log.title,
        message: log.message,
        type: log.eventType,
        isRead: true,
        createdAt: log.createdAt,
        channel: log.channel,
        status: log.status,
        weekStart: log.relatedWeekStart,
        weekEnd: log.relatedWeekEnd,
        whatsappLink: log.whatsappLink,
      })),
      ...inAppNotifications.map((notification) => ({
        ...notification,
        channel: "IN_APP",
        status: notification.isRead ? "READ" : "UNREAD",
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json({ success: true, notifications });
  } catch (error) {
    console.error("Faculty portal notification error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load notifications." });
  }
};

// Returns a weekly attendance grid (Friday -> Thursday) for the requested weekStart (YYYY-MM-DD) or current week.
export const getWeekAttendance = async (req, res) => {
  try {
    if (!requireFacultyOrAdmin(req, res)) return null;
    const { start, end: weekEnd, deadline } = attendanceWeek(req.query.weekStart || new Date());
    const end = new Date(weekEnd); end.setUTCHours(23, 59, 59, 999);
    const faculties = await prisma.faculty.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        facultyId: true,
        fullName: true,
        status: true,
        salaryType: true,
        salaryAmount: true,
      },
      orderBy: { fullName: "asc" },
    });

    const entries = await prisma.workLedgerEntry.findMany({
      where: { date: { gte: start, lte: end }, facultyId: { in: faculties.map((faculty) => faculty.id) } },
      select: {
        id: true,
        facultyId: true,
        date: true,
        shift: true,
        amount: true,
        classesTaken: true,
        updatedAt: true,
        updatedBy: true,
        updatedByRole: true,
        updatedByName: true,
      },
    });

    const days = Array.from({ length: 7 }, (_, index) => attendanceDateKey(addDays(start, index)));
    const byFacultyDate = new Map();
    for (const entry of entries) {
      const key = entry.facultyId + ":" + attendanceDateKey(entry.date);
      const list = byFacultyDate.get(key) || []; list.push(entry); byFacultyDate.set(key, list);
    }
    const dailyCell = (facultyId, date) => {
      const records = byFacultyDate.get(facultyId + ":" + date) || [];
      const historical = records.some(entry => ["DAILY", "AFTERNOON"].includes(entry.shift));
      return { present: records.length > 0, amount: sumAmounts(records), defaultAmount: dailyAttendanceRate(date),
        legacy: historical,
        shifts: Object.fromEntries(["MORNING", "EVENING"].map(shift => {
          const selected = records.filter(entry => entry.shift === shift);
          return [shift, { present: selected.length > 0, amount: sumAmounts(selected) }];
        })),
        records: records.map(entry => ({ ...buildAttendanceCell(entry), id: entry.id, shift: entry.shift })) };
    };
    const primaryFaculty = req.userRole === "faculty" ? faculties.find(faculty => faculty.id === String(req.user.id)) : faculties[0];
    const payoutLocked = primaryFaculty ? await attendancePayoutLocked(prisma, primaryFaculty.id, start) : false;
    const timeLocked = req.userRole === "faculty" && new Date() >= deadline;
    const isLocked = payoutLocked || timeLocked;
    const grid = faculties.map(faculty => ({
      id: faculty.id, facultyId: faculty.facultyId, fullName: faculty.fullName, status: faculty.status,
      canEdit: !isLocked && (req.userRole === "admin" || faculty.id === String(req.user.id)),
      weeklyTotal: days.reduce((sum, date) => sum + dailyCell(faculty.id, date).amount, 0),
      daily: Object.fromEntries(days.map(date => [date, dailyCell(faculty.id, date)])),
    }));
    const rows = days.map(date => ({
      date, dayName: new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "Asia/Kolkata" }),
      attendance: primaryFaculty ? dailyCell(primaryFaculty.id, date) : { present: false, amount: 0, defaultAmount: dailyAttendanceRate(date), records: [] },
      dailyTotal: primaryFaculty ? dailyCell(primaryFaculty.id, date).amount : 0,
    }));

    return res.json({
      success: true,
      weekStart: days[0],
      weekEnd: days[6],
      days,
      grid,
      rows,
      isLocked,
      editDeadline: deadline.toISOString(),
      serverNow: new Date().toISOString(),
      lockReason: payoutLocked ? ATTENDANCE_LOCK_MESSAGE : timeLocked ? "Faculty attendance editing closed at Friday 12:00 noon Asia/Kolkata for this week." : null,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Week attendance error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load weekly attendance." });
  }
};

// Daily attendance uses the same ledger and immutable recorded amounts on repeat submission.
export const upsertWeekAttendance = async (req, res) => {
  try {
    if (!requireFacultyOrAdmin(req, res)) return null;
    const result = await setDailyAttendance({
      role: req.userRole, actorId: req.user.id, facultyId: req.body?.facultyId,
      date: req.body?.date, shift: req.body?.shift, present: req.body?.present, amount: req.body?.amount,
      actor: getActorMetadata(req),
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Daily attendance error:", { code: error.code || "QUERY_FAILED" });
    return res.status(500).json({ success: false, message: "Failed to update attendance." });
  }
};

export const deleteWeekAttendanceEntry = async (req, res) => {
  try {
    if (!requireFacultyOrAdmin(req, res)) return null;
    const entry = await prisma.workLedgerEntry.findUnique({
      where: { id: req.params.id },
      select: { id: true, facultyId: true, date: true },
    });
    if (!entry) {
      return res.status(404).json({ success: false, message: "Attendance entry not found." });
    }
    if (req.userRole === "faculty" && String(entry.facultyId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Faculty members can only delete their own attendance." });
    }
    const weekStart = fridayWeekStart(entry.date);
    const weekEnd = addDays(weekStart, 6);
    weekEnd.setUTCHours(23, 59, 59, 999);
    if (await isFacultyWeekPayoutLocked(entry.facultyId, weekStart, weekEnd)) {
      return res.status(403).json({ success: false, message: ATTENDANCE_LOCK_MESSAGE });
    }
    await prisma.$transaction(async tx => {
      await lockAttendanceDates(tx, entry.facultyId, [entry.date]);
      await assertAttendanceMutable(tx, req.userRole, entry.facultyId, entry.date);
      const current = await tx.workLedgerEntry.findUnique({ where: { id: entry.id } });
      if (current) {
        await tx.workLedgerEntryAudit.create({ data: { entryId: entry.id, action: "DELETE", changedBy: getActorMetadata(req).updatedBy, previousData: JSON.parse(JSON.stringify(current)) } });
        assertAttendanceDeadline(req.userRole, entry.date);
        await tx.workLedgerEntry.delete({ where: { id: entry.id } });
        await refreshDraftAttendancePayroll(tx, entry.facultyId, entry.date);
      }
    });
    return res.json({ success: true, message: "Attendance entry cleared." });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Delete attendance error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to clear attendance." });
  }
};
