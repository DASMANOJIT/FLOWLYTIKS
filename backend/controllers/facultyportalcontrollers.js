import prisma from "../prisma/client.js";
import { toDateKey } from "../services/facultyPayrollService.js";

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
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  const delta = (date.getUTCDay() - 5 + 7) % 7;
  return addDays(date, -delta);
};

const sumAmounts = (entries) =>
  moneyNumber(entries.reduce((total, entry) => total + moneyNumber(entry.amount), 0));

const calculateShiftAmount = (faculty) => {
  const amount = moneyNumber(faculty?.salaryAmount || 0);
  if (!amount) return 0;
  if (faculty.salaryType === "MONTHLY_FIXED") {
    return Math.round((amount / 25 / 3) * 100) / 100;
  }
  return amount;
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
    const status = shiftCount >= 2 ? "PRESENT" : shiftCount === 1 ? "HALF_DAY" : "ABSENT";
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

    const [faculty, weekEntries, previousWeekEntries, monthEntries, yearEntries, allEntries, payrolls, payouts, notifications] = await Promise.all([
      prisma.faculty.findUnique({ where: { id: facultyId }, select: baseFacultySelect }),
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
    const notifications = await prisma.notification.findMany({
      where: { facultyId: req.user.id },
      orderBy: { createdAt: "desc" },
    });
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
    // parse weekStart if provided
    const q = req.query.weekStart ? String(req.query.weekStart) : null;
    const weekStartDate = q ? new Date(q) : null;
    const now = new Date();
    let start = weekStartDate;
    if (!start || Number.isNaN(start.getTime())) {
      // compute current week start (Friday)
      start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      // shift to Friday of current week
      const dow = start.getUTCDay(); // 0=Sun..6=Sat
      // Friday index is 5; compute delta to previous Friday
      const delta = (dow - 5 + 7) % 7;
      start.setUTCDate(start.getUTCDate() - delta);
      start.setUTCHours(0, 0, 0, 0);
    } else {
      start.setUTCHours(0, 0, 0, 0);
    }
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);

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
      select: { id: true, facultyId: true, date: true, shift: true, amount: true, classesTaken: true },
    });

    // build a map facultyId -> { dateKey_shift -> entry }
    const byFaculty = new Map();
    faculties.forEach((f) => byFaculty.set(f.id, new Map()));
    entries.forEach((e) => {
      const key = `${e.date.toISOString().slice(0, 10)}_${e.shift}`;
      const map = byFaculty.get(e.facultyId) || new Map();
      map.set(key, {
        id: e.id,
        amount: Number(e.amount || 0),
        classesTaken: Number(e.classesTaken || 1),
      });
      byFaculty.set(e.facultyId, map);
    });

    // build days array
    const days = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }

    const grid = faculties.map((f) => {
      const map = byFaculty.get(f.id) || new Map();
      let weeklyTotal = 0;
      const row = {
        facultyId: f.facultyId,
        id: f.id,
        fullName: f.fullName,
        status: f.status,
        canEdit: req.userRole === "admin" || String(req.user?.id) === String(f.id),
        weeklyTotal: 0,
        shifts: {},
      };
      days.forEach((date) => {
        ["MORNING", "AFTERNOON", "EVENING"].forEach((shift) => {
          const key = `${date}_${shift}`;
          const e = map.get(key);
          const amount = e ? moneyNumber(e.amount) : 0;
          weeklyTotal += amount;
          row.shifts[key] = e
            ? { present: true, id: e.id, amount, classesTaken: e.classesTaken }
            : { present: false, amount: calculateShiftAmount(f) };
        });
      });
      row.weeklyTotal = moneyNumber(weeklyTotal);
      return row;
    });
    const primaryFaculty = faculties[0] || null;
    const primaryMap = primaryFaculty ? byFaculty.get(primaryFaculty.id) || new Map() : new Map();
    const rows = days.map((date) => {
      const shifts = {};
      let dailyTotal = 0;
      ["MORNING", "AFTERNOON", "EVENING"].forEach((shift) => {
        const entry = primaryMap.get(`${date}_${shift}`);
        const amount = entry ? moneyNumber(entry.amount) : 0;
        dailyTotal += amount;
        shifts[shift] = entry
          ? { present: true, id: entry.id, amount, classesTaken: entry.classesTaken }
          : { present: false, amount: calculateShiftAmount(primaryFaculty) };
      });
      return {
        date,
        dayName: new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
        shifts,
        dailyTotal: moneyNumber(dailyTotal),
      };
    });

    return res.json({ success: true, weekStart: days[0], weekEnd: days[6], days, grid, rows });
  } catch (error) {
    console.error("Week attendance error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load weekly attendance." });
  }
};

// Upsert attendance for a faculty and shift (faculty may be the authenticated faculty or admin can specify facultyId)
export const upsertWeekAttendance = async (req, res) => {
  try {
    if (!requireFacultyOrAdmin(req, res)) return null;
    const { facultyId, date, shift, present } = req.body || {};
    if (!date || !shift) return res.status(400).json({ success: false, message: "Invalid request." });

    // Determine target faculty
    let targetFacultyId = facultyId;
    if (req.userRole === "faculty") {
      // ensure faculty can only modify their own
      if (String(req.user.id) !== String(facultyId) && facultyId) {
        return res.status(403).json({ success: false, message: "Forbidden." });
      }
      targetFacultyId = req.user.id;
    }
    if (!targetFacultyId) return res.status(400).json({ success: false, message: "Faculty id required." });

    const dateObj = new Date(date);
    dateObj.setUTCHours(0, 0, 0, 0);

    const uniqueWhere = {
      facultyId_date_shift: {
        facultyId: String(targetFacultyId),
        date: dateObj,
        shift,
      },
    };

    if (present) {
      const faculty = await prisma.faculty.findUnique({
        where: { id: String(targetFacultyId) },
        select: { salaryType: true, salaryAmount: true },
      });
      const amount = calculateShiftAmount(faculty);
      const entry = await prisma.workLedgerEntry.upsert({
        where: uniqueWhere,
        update: {
          amount,
          updatedBy: req.user?.id ? String(req.user.id) : "system",
        },
        create: {
          facultyId: String(targetFacultyId),
          date: dateObj,
          shift,
          classesTaken: 1,
          hoursWorked: 1,
          amount,
          createdBy: req.user?.id ? String(req.user.id) : "system",
          updatedBy: req.user?.id ? String(req.user.id) : "system",
        },
      });
      return res.json({ success: true, entry: { id: entry.id, date: entry.date, shift: entry.shift } });
    }

    // not present -> delete if exists
    await prisma.workLedgerEntry.deleteMany({
      where: { facultyId: String(targetFacultyId), date: dateObj, shift },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error("Upsert attendance error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to update attendance." });
  }
};

export const deleteWeekAttendanceEntry = async (req, res) => {
  try {
    if (!requireFacultyOrAdmin(req, res)) return null;
    const entry = await prisma.workLedgerEntry.findUnique({
      where: { id: req.params.id },
      select: { id: true, facultyId: true },
    });
    if (!entry) {
      return res.status(404).json({ success: false, message: "Attendance entry not found." });
    }
    if (req.userRole === "faculty" && String(entry.facultyId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Faculty members can only delete their own attendance." });
    }
    await prisma.workLedgerEntry.delete({ where: { id: entry.id } });
    return res.json({ success: true, message: "Attendance entry cleared." });
  } catch (error) {
    console.error("Delete attendance error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to clear attendance." });
  }
};
