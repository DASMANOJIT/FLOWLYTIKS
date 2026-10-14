import prisma from "../prisma/client.js";
import { buildRequestLogMeta, logError, logInfo } from "../utils/appLogger.js";

import { attendanceWeek, attendancePayoutLocked, assertAttendanceDeadline, assertAttendanceMutable, refreshDraftAttendancePayroll, lockAttendanceDates, setDailyAttendance } from "../services/dailyAttendanceService.js";

const SHIFT_ORDER = ["DAILY", "MORNING", "AFTERNOON", "EVENING"];
const DAY_LABELS = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];

const entrySelect = {
  id: true,
  facultyId: true,
  date: true,
  shift: true,
  amount: true,
  remarks: true,
  createdBy: true,
  updatedBy: true,
  updatedByRole: true,
  updatedByName: true,
  updatedByFacultyId: true,
  updatedByAdminId: true,
  createdAt: true,
  updatedAt: true,
  faculty: {
    select: {
      id: true,
      facultyId: true,
      fullName: true,
      designation: true,
    },
  },
};

const toDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const parseDateOnly = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const getFridayWeekStart = (value = new Date()) => attendanceWeek(value).start;

const resolveMonthRange = (month) => {
  const [year, monthNumber] = String(month).split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    const start = getFridayWeekStart();
    return { start, end: addDays(start, 6) };
  }
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 0));
  return { start, end };
};

const actorKey = (req) => `${req.userRole}:${req.user?.id}`;

const actorMetadata = (req) => ({
  updatedBy: actorKey(req),
  updatedByRole: req.userRole === "admin" ? "ADMIN" : req.userRole === "faculty" ? "FACULTY" : null,
  updatedByName: req.user?.fullName || req.user?.name || req.user?.email || actorKey(req),
  updatedByFacultyId: req.userRole === "faculty" && req.user?.id ? String(req.user.id) : null,
  updatedByAdminId: req.userRole === "admin" && req.user?.id ? Number(req.user.id) : null,
});

const isAdmin = (req) => req.userRole === "admin";

const isFacultyActor = (req) => req.userRole === "faculty";

const assertLedgerRole = (req, res) => {
  if (isAdmin(req) || isFacultyActor(req)) return true;
  res.status(403).json({ success: false, message: "Forbidden" });
  return false;
};

const canMutateEntry = (req, entry) =>
  isAdmin(req) || (isFacultyActor(req) && String(entry.facultyId) === String(req.user?.id));

const getWeekLockState = async (start) => {
  const isLocked = await attendancePayoutLocked(prisma, null, start);
  return { isLocked, lockReason: isLocked ? "This week's payroll is approved, settled or processing. Attendance editing is locked." : null };
};

const assertLedgerUnlocked = async (tx, req, facultyId, dates) => {
  await lockAttendanceDates(tx, facultyId, dates.filter(Boolean));
  for (const date of dates.filter(Boolean)) await assertAttendanceMutable(tx, req.userRole, facultyId, date);
  return true;
};

const toEntryDto = (entry) => ({
  ...entry,
  date: toDateKey(entry.date),
  amount:
    entry?.amount === null || entry?.amount === undefined ? null : Number(entry.amount),
});

const serializableEntry = (entry) => {
  if (!entry) return null;
  const dto = toEntryDto(entry);
  return JSON.parse(JSON.stringify(dto));
};

const buildDateRange = (query = {}) => {
  if (query.week) {
    const start = getFridayWeekStart(query.week);
    return { start, end: addDays(start, 6) };
  }

  if (query.month) {
    return resolveMonthRange(query.month);
  }

  const start = parseDateOnly(query.startDate) || getFridayWeekStart();
  const end = parseDateOnly(query.endDate) || addDays(start, 6);
  return { start, end };
};

const normalizeListQuery = (query = {}) => {
  const limit = Number(query.limit);
  return {
    ...query,
    facultyId: query.facultyId === "all" ? "all" : query.facultyId,
    shift: SHIFT_ORDER.includes(query.shift) ? query.shift : "all",
    search: typeof query.search === "string" ? query.search.trim() : "",
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 1000) : 500,
  };
};

const buildWhere = (query = {}) => {
  const normalizedQuery = normalizeListQuery(query);
  const { start, end } = buildDateRange(normalizedQuery);
  const where = {
    date: {
      gte: start,
      lte: end,
    },
  };

  if (normalizedQuery.facultyId && normalizedQuery.facultyId !== "all") {
    where.facultyId = normalizedQuery.facultyId;
  }

  if (normalizedQuery.shift && normalizedQuery.shift !== "all") {
    where.shift = normalizedQuery.shift;
  }

  if (normalizedQuery.search) {
    where.faculty = {
      fullName: { contains: normalizedQuery.search, mode: "insensitive" },
    };
  }

  return { where, start, end, limit: normalizedQuery.limit };
};

const buildSummary = (entries, rangeStart, rangeEnd) => {
  const facultyTotals = new Map();
  const safeRangeStart = parseDateOnly(rangeStart) || getFridayWeekStart();
  const safeRangeEnd = parseDateOnly(rangeEnd) || addDays(safeRangeStart, 6);
  const weekStart = getFridayWeekStart(safeRangeStart);
  const weekEnd = addDays(weekStart, 6);
  let totalAmount = 0;
  let currentWeekTotal = 0;

  for (const entry of entries) {
    const amount = Number(entry.amount || 0);
    totalAmount += amount;
    const date = parseDateOnly(entry.date);
    if (date && date >= weekStart && date <= weekEnd) {
      currentWeekTotal += amount;
    }

    const current = facultyTotals.get(entry.facultyId) || {
      facultyId: entry.facultyId,
      facultyName: entry.faculty?.fullName || "Unknown Faculty",
      weeklyTotal: 0,
      monthlyTotal: 0,
      totalAmount: 0,
      entries: 0,
    };
    current.totalAmount += amount;
    current.entries += 1;
    if (date && date >= weekStart && date <= weekEnd) current.weeklyTotal += amount;
    if (
      date &&
      date.getUTCFullYear() === safeRangeStart.getUTCFullYear() &&
      date.getUTCMonth() === safeRangeStart.getUTCMonth()
    ) {
      current.monthlyTotal += amount;
    }
    facultyTotals.set(entry.facultyId, current);
  }

  const rankedFaculty = [...facultyTotals.values()].sort(
    (left, right) => right.totalAmount - left.totalAmount
  );

  return {
    rangeStart: toDateKey(safeRangeStart),
    rangeEnd: toDateKey(safeRangeEnd),
    totalEntries: entries.length,
    totalAmount,
    totalAmountRecorded: totalAmount,
    totalFacultyParticipated: facultyTotals.size,
    currentWeekTotal,
    topFaculty: rankedFaculty.slice(0, 5),
    facultySummary: rankedFaculty,
    facultyTotals: rankedFaculty,
  };
};

const buildDayGrid = (entries, rangeStart, rangeEnd) => {
  const start = parseDateOnly(rangeStart) || getFridayWeekStart();
  const end = parseDateOnly(rangeEnd) || addDays(start, 6);
  const byCell = new Map();
  entries.forEach((entry) => {
    const date = toDateKey(entry.date);
    const key = `${date}:${entry.shift}`;
    const current = byCell.get(key) || [];
    current.push({
      id: entry.id,
      facultyId: entry.facultyId,
      date,
      shift: entry.shift,
      facultyCode: entry.faculty?.facultyId || "",
      facultyName: entry.faculty?.fullName || "Faculty",
      faculty: {
        id: entry.facultyId,
        facultyId: entry.faculty?.facultyId || "",
        fullName: entry.faculty?.fullName || "Faculty",
      },
      isPresent: true,
      amount: Number(entry.amount || 0),
      updatedAt: entry.updatedAt?.toISOString?.() || entry.updatedAt || null,
      updatedByRole: entry.updatedByRole || null,
      updatedByName: entry.updatedByName || entry.updatedBy || null,
      remarks: entry.remarks || null,
    });
    byCell.set(key, current);
  });

  const days = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const date = toDateKey(cursor);
    const shifts = {};
    let dailyTotal = 0;
    SHIFT_ORDER.forEach((shift) => {
      const rows = byCell.get(`${date}:${shift}`) || [];
      dailyTotal += rows.reduce((total, row) => total + Number(row.amount || 0), 0);
      shifts[shift] = rows;
    });
    days.push({
      date,
      day: cursor.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
      shifts,
      dailyTotal,
    });
  }
  return days;
};

const buildCalendarRows = (entries, rangeStart, rangeEnd) =>
  buildDayGrid(entries, rangeStart, rangeEnd).map((day) => {
    const dayEntries = SHIFT_ORDER.flatMap((shift) => day.shifts[shift] || []);
    const cells = DAY_LABELS.reduce((current, label) => {
      const entriesForCell = label === day.day ? dayEntries : [];
      current[label] = {
        entries: entriesForCell,
        totalAmount: entriesForCell.reduce((total, entry) => total + Number(entry.amount || 0), 0),
        entryCount: entriesForCell.length,
      };
      return current;
    }, {});

    return {
      date: day.date,
      displayDate: day.date
        ? `${day.date.slice(8, 10)}/${day.date.slice(5, 7)}/${day.date.slice(2, 4)}`
        : "",
      dayName: day.day,
      cells,
      dailyTotal: day.dailyTotal,
    };
  });

const handleLedgerError = (res, error) => {
  if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
  if (error?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Ledger entry not found." });
  }
  if (error?.code === "P2003") {
    return res.status(400).json({ success: false, message: "Selected faculty member was not found." });
  }
  console.error("Work ledger API error:", error?.message || error);
  return res.status(500).json({
    success: false,
    message: "Work ledger request failed. Please try again.",
  });
};

const isMissingColumnOrTableError = (error) =>
  error?.code === "P2021" ||
  error?.code === "P2022" ||
  /does not exist|column .* does not exist|relation .* does not exist/i.test(String(error?.message || ""));

export const createWorkLedgerEntry = async (req, res) => {
  try {
    if (!assertLedgerRole(req, res)) return null;
    if (req.body.shift && req.body.shift !== "DAILY") return res.status(400).json({ success: false, message: "New attendance entries must be daily." });
    const result = await setDailyAttendance({ ...req.body, role: req.userRole, actorId: req.user?.id, present: true, actor: actorMetadata(req) });
    return res.status(201).json({ success: true, entry: toEntryDto(result.entry) });
  } catch (error) { return handleLedgerError(res, error); }
};

export const getWorkLedgerEntries = async (req, res) => {
  try {
    if (!assertLedgerRole(req, res)) return null;
    const { where, start, end, limit } = buildWhere(req.query);
    logInfo("work_ledger.fetch.start", buildRequestLogMeta(req, {
      rangeStart: toDateKey(start),
      rangeEnd: toDateKey(end),
      facultyId: req.query.facultyId || "all",
      shift: req.query.shift || "all",
    }));
    const entries = await prisma.workLedgerEntry.findMany({
      where,
      orderBy: [{ date: "asc" }, { shift: "asc" }, { createdAt: "asc" }],
      ...(req.query.week ? {} : { take: limit }),
      select: entrySelect,
    });

    const orderedEntries = entries
      .map(toEntryDto)
      .sort((left, right) => {
        if (left.date !== right.date) return left.date.localeCompare(right.date);
        return SHIFT_ORDER.indexOf(left.shift) - SHIFT_ORDER.indexOf(right.shift);
      });

    // Defensive: ensure we always return a consistent JSON shape even if something unexpected happens
    const safeEntries = Array.isArray(orderedEntries) ? orderedEntries : [];
    const safeSummary = safeEntries.length ? buildSummary(safeEntries, start, end) : buildSummary([], start || new Date(), end || new Date());
    const lockState = await getWeekLockState(start, end);

    return res.json({
      success: true,
      weekStart: toDateKey(start),
      weekEnd: toDateKey(end),
      ...lockState,
      entries: safeEntries,
      days: buildDayGrid(safeEntries, start, end),
      calendarRows: buildCalendarRows(safeEntries, start, end),
      summary: safeSummary,
      topFaculty: safeSummary.topFaculty,
      facultySummary: safeSummary.facultySummary,
    });
  } catch (error) {
    if (isMissingColumnOrTableError(error)) {
      logError("work_ledger.fetch.schema_missing", buildRequestLogMeta(req, {
        code: error?.code,
      }));
      return res.status(503).json({ success: false, message: "Work ledger database setup is incomplete. Please contact admin." });
    }
    return handleLedgerError(res, error);
  }
};

export const getWorkLedgerEntryById = async (req, res) => {
  try {
    if (!assertLedgerRole(req, res)) return null;
    const entry = await prisma.workLedgerEntry.findUnique({
      where: { id: req.params.id },
      select: entrySelect,
    });
    if (!entry) {
      return res.status(404).json({ success: false, message: "Ledger entry not found." });
    }
    return res.json({ success: true, entry: toEntryDto(entry) });
  } catch (error) {
    return handleLedgerError(res, error);
  }
};

export const updateWorkLedgerEntry = async (req, res) => {
  try {
    if (!assertLedgerRole(req, res)) return null;
    let existing = await prisma.workLedgerEntry.findUnique({
      where: { id: req.params.id },
      select: entrySelect,
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Ledger entry not found." });
    }
    if (!canMutateEntry(req, existing)) {
      return res.status(403).json({ success: false, message: "You can only edit your own ledger entries." });
    }
    if (String(req.body.facultyId) !== String(existing.facultyId) || toDateKey(req.body.date) !== toDateKey(existing.date) || (req.body.shift !== existing.shift && !(req.body.shift === "DAILY" && existing.shift !== "DAILY"))) {
      return res.status(403).json({ success: false, message: "Attendance entries cannot be moved to another faculty, date or entry type." });
    }

    if (isFacultyActor(req) && req.body.amount !== undefined) return res.status(400).json({ success: false, message: "Only admins can override attendance amounts." });
    const entry = await prisma.$transaction(async (tx) => {
      await assertLedgerUnlocked(tx, req, existing.facultyId, [existing.date]);
      existing = await tx.workLedgerEntry.findUnique({ where: { id: existing.id }, select: entrySelect });
      if (!existing) throw Object.assign(new Error("Ledger entry not found."), { status: 404 });
      assertAttendanceDeadline(req.userRole, existing.date);
      const updated = await tx.workLedgerEntry.update({
        where: { id: req.params.id },
        data: {
          ...req.body,
          shift: existing.shift,
          ...actorMetadata(req),
        },
        select: entrySelect,
      });
      await tx.workLedgerEntryAudit.create({
        data: {
          entryId: updated.id,
          action: "UPDATE",
          changedBy: actorKey(req),
          previousData: serializableEntry(existing),
          newData: serializableEntry(updated),
        },
      });
      await refreshDraftAttendancePayroll(tx, existing.facultyId, existing.date);
      return updated;
    });

    if (!entry) return null;
    return res.json({ success: true, entry: toEntryDto(entry) });
  } catch (error) {
    return handleLedgerError(res, error);
  }
};

export const updateWorkLedgerAttendanceEntry = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Only admins can edit attendance from work ledger." });
    }
    let existing = await prisma.workLedgerEntry.findUnique({
      where: { id: req.params.attendanceId },
      select: entrySelect,
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Ledger entry not found." });
    }

    const result = await prisma.$transaction(async (tx) => {
      await assertLedgerUnlocked(tx, req, existing.facultyId, [existing.date]);
      existing = await tx.workLedgerEntry.findUnique({ where: { id: existing.id }, select: entrySelect });
      if (!existing) throw Object.assign(new Error("Ledger entry not found."), { status: 404 });

      if (req.body.isPresent === false) {
        await tx.workLedgerEntryAudit.create({
          data: {
            entryId: existing.id,
            action: "DELETE",
            changedBy: actorKey(req),
            previousData: serializableEntry(existing),
          },
        });
        assertAttendanceDeadline(req.userRole, existing.date);
        await tx.workLedgerEntry.delete({ where: { id: existing.id } });
        await refreshDraftAttendancePayroll(tx, existing.facultyId, existing.date);
        return { deleted: true, attendance: null };
      }

      assertAttendanceDeadline(req.userRole, existing.date);
      const updated = await tx.workLedgerEntry.update({
        where: { id: existing.id },
        data: {
          ...(req.body.amount === undefined ? {} : { amount: Number(req.body.amount) }),
          remarks: req.body.remarks ?? null,
          ...actorMetadata(req),
        },
        select: entrySelect,
      });
      await tx.workLedgerEntryAudit.create({
        data: {
          entryId: updated.id,
          action: "UPDATE",
          changedBy: actorKey(req),
          previousData: serializableEntry(existing),
          newData: serializableEntry(updated),
        },
      });
      await refreshDraftAttendancePayroll(tx, existing.facultyId, existing.date);
      return { deleted: false, attendance: updated };
    });

    if (!result) return null;
    if (result.deleted) {
      return res.json({ success: true, message: "Attendance marked absent successfully.", attendance: null });
    }
    return res.json({
      success: true,
      message: "Attendance updated successfully.",
      attendance: toEntryDto(result.attendance),
    });
  } catch (error) {
    return handleLedgerError(res, error);
  }
};

export const deleteWorkLedgerEntry = async (req, res) => {
  try {
    if (!assertLedgerRole(req, res)) return null;
    let existing = await prisma.workLedgerEntry.findUnique({
      where: { id: req.params.id },
      select: entrySelect,
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Ledger entry not found." });
    }
    if (!canMutateEntry(req, existing)) {
      return res.status(403).json({ success: false, message: "You can only delete your own ledger entries." });
    }

    await prisma.$transaction(async (tx) => {
      await assertLedgerUnlocked(tx, req, existing.facultyId, [existing.date]);
      existing = await tx.workLedgerEntry.findUnique({ where: { id: existing.id }, select: entrySelect });
      if (!existing) throw Object.assign(new Error("Ledger entry not found."), { status: 404 });
      await tx.workLedgerEntryAudit.create({
        data: {
          entryId: existing.id,
          action: "DELETE",
          changedBy: actorKey(req),
          previousData: serializableEntry(existing),
        },
      });
      assertAttendanceDeadline(req.userRole, existing.date);
      await tx.workLedgerEntry.delete({ where: { id: existing.id } });
      await refreshDraftAttendancePayroll(tx, existing.facultyId, existing.date);
    });

    if (res.headersSent) return null;

    return res.json({ success: true, message: "Ledger entry deleted successfully." });
  } catch (error) {
    return handleLedgerError(res, error);
  }
};

export const getWorkLedgerWeek = async (req, res) => {
  req.query.week = req.params.weekId;
  return getWorkLedgerEntries(req, res);
};

export const getWorkLedgerFaculty = async (req, res) => {
  req.query.facultyId = req.params.facultyId;
  return getWorkLedgerEntries(req, res);
};

const safeCsvCell = (value) => {
  const normalized = value === null || value === undefined ? "" : String(value);
  const formulaSafe = /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
};

export const exportWorkLedgerCsv = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Only admins can export work ledger data." });
    }
    const { where, start, end } = buildWhere(req.query.week ? { week: req.query.week } : req.query);
    const entries = await prisma.workLedgerEntry.findMany({
      where,
      orderBy: [{ date: "asc" }, { shift: "asc" }, { createdAt: "asc" }],
      select: entrySelect,
    });
    const rows = [
      ["Week Start", "Week End", "Date", "Entry Type", "Faculty ID", "Faculty Name", "Status", "Amount", "Remarks", "Created By", "Updated By", "Updated By Role", "Created At", "Updated At"],
      ...entries.map((entry) => [
        toDateKey(start),
        toDateKey(end),
        toDateKey(entry.date),
        entry.shift,
        entry.faculty?.facultyId || "",
        entry.faculty?.fullName || "",
        "Present",
        Number(entry.amount || 0),
        entry.remarks || "",
        entry.createdBy,
        entry.updatedByName || entry.updatedBy || "",
        entry.updatedByRole || "",
        entry.createdAt?.toISOString?.() || "",
        entry.updatedAt?.toISOString?.() || "",
      ]),
    ];
    for (const day of buildDayGrid(entries, start, end)) rows.push([toDateKey(start), toDateKey(end), day.date, "DAILY TOTAL", "", "", "", day.dailyTotal]);
    rows.push([toDateKey(start), toDateKey(end), "TOTAL", "", "", "", "", entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)]);
    const csv = rows.map((row) => row.map(safeCsvCell).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="faculty-work-ledger-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (error) {
    return handleLedgerError(res, error);
  }
};

export const exportWorkLedgerReport = async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ success: false, message: "Only admins can export work ledger data." });
    const { where, start, end } = buildWhere({ week: req.query.week || toDateKey(getFridayWeekStart()) });
    const entries = (await prisma.workLedgerEntry.findMany({ where, select: entrySelect, orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }] })).map(toEntryDto);
    return res.json({ success: true, weekStart: toDateKey(start), weekEnd: toDateKey(end), entries, days: buildDayGrid(entries, start, end), summary: buildSummary(entries, start, end) });
  } catch (error) { return handleLedgerError(res, error); }
};
