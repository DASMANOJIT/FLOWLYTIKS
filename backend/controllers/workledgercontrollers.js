import prisma from "../prisma/client.js";
import { buildRequestLogMeta, logError, logInfo } from "../utils/appLogger.js";

const SHIFT_ORDER = ["MORNING", "AFTERNOON", "EVENING"];

const entrySelect = {
  id: true,
  facultyId: true,
  date: true,
  shift: true,
  amount: true,
  remarks: true,
  createdBy: true,
  updatedBy: true,
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

const getFridayWeekStart = (value = new Date()) => {
  const date = parseDateOnly(toDateKey(value)) || new Date();
  const day = date.getUTCDay();
  const daysSinceFriday = (day + 2) % 7;
  return addDays(date, -daysSinceFriday);
};

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

const isAdmin = (req) => req.userRole === "admin";

const isFacultyActor = (req) => req.userRole === "faculty";

const assertLedgerRole = (req, res) => {
  if (isAdmin(req) || isFacultyActor(req)) return true;
  res.status(403).json({ success: false, message: "Forbidden" });
  return false;
};

const canMutateEntry = (req, entry) =>
  isAdmin(req) || (isFacultyActor(req) && String(entry.facultyId) === String(req.user?.id));

const findLockedPayrollCycle = async (tx, date) =>
  tx.payrollCycle.findFirst({
    where: {
      startDate: { lte: date },
      endDate: { gte: date },
      ledgerLocked: true,
      status: { in: ["APPROVED", "PAID", "LOCKED"] },
    },
    select: { cycleNumber: true, startDate: true, endDate: true, status: true },
  });

const assertLedgerUnlocked = async (tx, res, dates) => {
  for (const date of dates) {
    const parsedDate = parseDateOnly(date);
    if (!parsedDate) continue;
    const lockedCycle = await findLockedPayrollCycle(tx, parsedDate);
    if (lockedCycle) {
      res.status(423).json({
        success: false,
        message: `${lockedCycle.cycleNumber} is ${String(lockedCycle.status).toLowerCase()} and locked. Unlock payroll before editing this week's ledger.`,
      });
      return false;
    }
  }
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

const buildWhere = (query = {}) => {
  const { start, end } = buildDateRange(query);
  const where = {
    date: {
      gte: start,
      lte: end,
    },
  };

  if (query.facultyId && query.facultyId !== "all") {
    where.facultyId = query.facultyId;
  }

  if (query.shift && query.shift !== "all") {
    where.shift = query.shift;
  }

  if (query.search) {
    where.faculty = {
      fullName: { contains: query.search, mode: "insensitive" },
    };
  }

  return { where, start, end };
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

const handleLedgerError = (res, error) => {
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

const emptyLedgerResponse = (start, end) => {
  const summary = buildSummary([], start || getFridayWeekStart(), end || addDays(start || getFridayWeekStart(), 6));
  return {
    success: true,
    entries: [],
    summary,
    topFaculty: [],
    facultySummary: [],
  };
};

export const createWorkLedgerEntry = async (req, res) => {
  try {
    if (!assertLedgerRole(req, res)) return null;
    if (isFacultyActor(req) && String(req.body.facultyId) !== String(req.user?.id)) {
      return res.status(403).json({ success: false, message: "Faculty members can only create their own entries." });
    }

    const entry = await prisma.$transaction(async (tx) => {
      if (!(await assertLedgerUnlocked(tx, res, [req.body.date]))) return null;
      const created = await tx.workLedgerEntry.create({
        data: {
          ...req.body,
          createdBy: actorKey(req),
          updatedBy: actorKey(req),
        },
        select: entrySelect,
      });
      await tx.workLedgerEntryAudit.create({
        data: {
          entryId: created.id,
          action: "CREATE",
          changedBy: actorKey(req),
          newData: serializableEntry(created),
        },
      });
      return created;
    });

    if (!entry) return null;
    return res.status(201).json({ success: true, entry: toEntryDto(entry) });
  } catch (error) {
    return handleLedgerError(res, error);
  }
};

export const getWorkLedgerEntries = async (req, res) => {
  try {
    if (!assertLedgerRole(req, res)) return null;
    const { where, start, end } = buildWhere(req.query);
    logInfo("work_ledger.fetch.start", buildRequestLogMeta(req, {
      rangeStart: toDateKey(start),
      rangeEnd: toDateKey(end),
      facultyId: req.query.facultyId || "all",
      shift: req.query.shift || "all",
    }));
    const entries = await prisma.workLedgerEntry.findMany({
      where,
      orderBy: [{ date: "asc" }, { shift: "asc" }, { createdAt: "asc" }],
      take: req.query.limit,
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

    return res.json({
      success: true,
      entries: safeEntries,
      summary: safeSummary,
      topFaculty: safeSummary.topFaculty,
      facultySummary: safeSummary.facultySummary,
    });
  } catch (error) {
    if (isMissingColumnOrTableError(error)) {
      const { start, end } = buildDateRange(req.query);
      logError("work_ledger.fetch.schema_missing", buildRequestLogMeta(req, {
        error: error?.message || String(error),
      }));
      return res.json(emptyLedgerResponse(start, end));
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
    const existing = await prisma.workLedgerEntry.findUnique({
      where: { id: req.params.id },
      select: entrySelect,
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Ledger entry not found." });
    }
    if (!canMutateEntry(req, existing)) {
      return res.status(403).json({ success: false, message: "You can only edit your own ledger entries." });
    }
    if (isFacultyActor(req) && String(req.body.facultyId) !== String(existing.facultyId)) {
      return res.status(403).json({ success: false, message: "Faculty members cannot move entries to another faculty member." });
    }

    const entry = await prisma.$transaction(async (tx) => {
      if (!(await assertLedgerUnlocked(tx, res, [existing.date, req.body.date]))) return null;
      const updated = await tx.workLedgerEntry.update({
        where: { id: req.params.id },
        data: {
          ...req.body,
          updatedBy: actorKey(req),
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
      return updated;
    });

    if (!entry) return null;
    return res.json({ success: true, entry: toEntryDto(entry) });
  } catch (error) {
    return handleLedgerError(res, error);
  }
};

export const deleteWorkLedgerEntry = async (req, res) => {
  try {
    if (!assertLedgerRole(req, res)) return null;
    const existing = await prisma.workLedgerEntry.findUnique({
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
      if (!(await assertLedgerUnlocked(tx, res, [existing.date]))) return null;
      await tx.workLedgerEntryAudit.create({
        data: {
          entryId: existing.id,
          action: "DELETE",
          changedBy: actorKey(req),
          previousData: serializableEntry(existing),
        },
      });
      await tx.workLedgerEntry.delete({ where: { id: existing.id } });
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
    const { where } = buildWhere(req.query);
    const entries = await prisma.workLedgerEntry.findMany({
      where,
      orderBy: [{ date: "asc" }, { shift: "asc" }, { createdAt: "asc" }],
      select: entrySelect,
    });
    const rows = [
      ["Date", "Shift", "Faculty ID", "Faculty Name", "Amount", "Remarks", "Created By", "Updated By", "Created At", "Updated At"],
      ...entries.map((entry) => [
        toDateKey(entry.date),
        entry.shift,
        entry.faculty?.facultyId || "",
        entry.faculty?.fullName || "",
        Number(entry.amount || 0),
        entry.remarks || "",
        entry.createdBy,
        entry.updatedBy || "",
        entry.createdAt?.toISOString?.() || "",
        entry.updatedAt?.toISOString?.() || "",
      ]),
    ];
    const csv = rows.map((row) => row.map(safeCsvCell).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="faculty-work-ledger-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (error) {
    return handleLedgerError(res, error);
  }
};
