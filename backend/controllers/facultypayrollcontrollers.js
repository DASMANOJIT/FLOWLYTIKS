import PDFDocument from "pdfkit";
import prisma from "../prisma/client.js";
import {
  actorKey,
  dateOnly,
  normalizeMoney,
  toDateKey,
} from "../services/facultyPayrollService.js";

const requireAdmin = (req, res) => {
  if (req.userRole === "admin") return true;
  res.status(403).json({ success: false, message: "Admins only." });
  return false;
};

const safeDate = (value) => dateOnly(value);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getFridayWeekStart = (value = new Date()) => {
  const date = safeDate(value);
  const daysSinceFriday = (date.getUTCDay() + 2) % 7;
  return addDays(date, -daysSinceFriday);
};

const money = (value) => normalizeMoney(Number(value || 0));

const statusToPaymentStatus = (status) => (status === "PAID" ? "PAID" : "PENDING");

const humanStatus = (status) =>
  String(status || "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const toPayrollDto = (payroll, ledgerDetails = null) => ({
  id: payroll.id,
  facultyId: payroll.facultyId,
  payrollCycleId: payroll.payrollCycleId,
  totalEntries: Number(payroll.totalEntries || 0),
  totalAmount: money(payroll.totalAmount),
  status: payroll.status,
  statusLabel: humanStatus(payroll.status),
  approvedBy: payroll.approvedBy,
  approvedAt: payroll.approvedAt,
  paidBy: payroll.paidBy,
  paidAt: payroll.paidAt,
  remarks: payroll.remarks || "",
  createdAt: payroll.createdAt,
  updatedAt: payroll.updatedAt,
  faculty: payroll.faculty
    ? {
        id: payroll.faculty.id,
        facultyId: payroll.faculty.facultyId,
        fullName: payroll.faculty.fullName,
        designation: payroll.faculty.designation,
      }
    : null,
  weekStart: payroll.payrollCycle ? toDateKey(payroll.payrollCycle.startDate) : null,
  weekEnd: payroll.payrollCycle ? toDateKey(payroll.payrollCycle.endDate) : null,
  batchNumber: payroll.payrollCycle?.cycleNumber || "",
  calculatedAmount: money(payroll.totalAmount),
  bonus: 0,
  deduction: 0,
  netAmount: money(payroll.totalAmount),
  paymentStatus: statusToPaymentStatus(payroll.status),
  ledgerDetails,
});

const toCycleDto = (cycle) => {
  const payrolls = Array.isArray(cycle.payrolls) ? cycle.payrolls : [];
  const totalAmount = payrolls.reduce((sum, payroll) => sum + money(payroll.totalAmount), 0);
  return {
    id: cycle.id,
    cycleNumber: cycle.cycleNumber,
    batchNumber: cycle.cycleNumber,
    weekStart: toDateKey(cycle.startDate),
    weekEnd: toDateKey(cycle.endDate),
    startDate: toDateKey(cycle.startDate),
    endDate: toDateKey(cycle.endDate),
    totalAmount: money(totalAmount),
    status: cycle.status,
    statusLabel: humanStatus(cycle.status),
    ledgerLocked: Boolean(cycle.ledgerLocked),
    approvedBy: cycle.approvedBy,
    approvedAt: cycle.approvedAt,
    paidBy: cycle.paidBy,
    paidAt: cycle.paidAt,
    createdAt: cycle.createdAt,
    updatedAt: cycle.updatedAt,
    payrolls: payrolls.map((payroll) => toPayrollDto({ ...payroll, payrollCycle: cycle })),
  };
};

const handlePayrollError = (res, error) => {
  console.error("Faculty earnings payroll API error:", {
    code: error?.code,
    message: error?.message || error,
    meta: error?.meta,
  });
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error?.code === "P2025") {
    return res.status(404).json({ success: false, message: "Payroll record not found." });
  }
  if (error?.code === "P2002") {
    return res.status(409).json({ success: false, message: "Payroll cycle already exists for this week." });
  }
  return res.status(500).json({
    success: false,
    message: "Faculty earnings payroll request failed. Please try again.",
  });
};

const buildLedgerGroups = (faculty, ledgerEntries) => {
  const groups = new Map(
    faculty.map((item) => [
      item.id,
      {
        faculty: item,
        totalEntries: 0,
        totalAmount: 0,
      },
    ])
  );

  for (const entry of ledgerEntries) {
    const group = groups.get(entry.facultyId);
    if (!group) continue;
    group.totalEntries += 1;
    group.totalAmount += money(entry.amount);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    totalAmount: money(group.totalAmount),
  }));
};

const buildCycleNumber = async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(734003)`;
  const count = await tx.payrollCycle.count();
  return `Payroll Week #${String(count + 1).padStart(3, "0")}`;
};

const getCycleWithPayrolls = (where) =>
  prisma.payrollCycle.findFirst({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      payrolls: {
        orderBy: { createdAt: "asc" },
        include: {
          faculty: {
            select: {
              id: true,
              facultyId: true,
              fullName: true,
              designation: true,
            },
          },
        },
      },
    },
  });

const buildReportWhere = (query = {}) => {
  const where = {};
  if (query.facultyId) where.facultyId = query.facultyId;
  if (query.cycleId) where.payrollCycleId = query.cycleId;
  if (query.status) where.status = query.status;
  if (query.startDate || query.endDate) {
    where.payrollCycle = {
      startDate: {
        gte: query.startDate ? safeDate(query.startDate) : undefined,
      },
      endDate: {
        lte: query.endDate ? safeDate(query.endDate) : undefined,
      },
    };
  }
  return where;
};

const fetchReportRows = async (query = {}) =>
  prisma.facultyEarningsPayroll.findMany({
    where: buildReportWhere(query),
    orderBy: [{ payrollCycle: { startDate: "desc" } }, { faculty: { fullName: "asc" } }],
    include: {
      faculty: {
        select: {
          id: true,
          facultyId: true,
          fullName: true,
          designation: true,
        },
      },
      payrollCycle: true,
    },
  });

const safeCsvCell = (value) => {
  const normalized = value === null || value === undefined ? "" : String(value);
  const formulaSafe = /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
};

export const generateFacultyPayroll = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const weekStart = safeDate(req.body.weekStart || getFridayWeekStart());
    const weekEnd = safeDate(req.body.weekEnd || addDays(weekStart, 6));

    const result = await prisma.$transaction(async (tx) => {
      const existingCycle = await tx.payrollCycle.findUnique({
        where: { startDate_endDate: { startDate: weekStart, endDate: weekEnd } },
        include: { payrolls: true },
      });

      if (existingCycle?.ledgerLocked || existingCycle?.status === "PAID") {
        const error = new Error("This payroll cycle is approved or locked. Unlock it before regenerating.");
        error.statusCode = 423;
        throw error;
      }

      const faculty = await tx.faculty.findMany({
        where: { status: "ACTIVE" },
        orderBy: { fullName: "asc" },
        select: { id: true, facultyId: true, fullName: true, designation: true },
      });
      const ledgerEntries = await tx.workLedgerEntry.findMany({
        where: {
          date: { gte: weekStart, lte: weekEnd },
          facultyId: { in: faculty.map((item) => item.id) },
        },
        select: { facultyId: true, amount: true },
      });
      const grouped = buildLedgerGroups(faculty, ledgerEntries);

      const cycle = existingCycle
        ? await tx.payrollCycle.update({
            where: { id: existingCycle.id },
            data: {
              status: "DRAFT",
              ledgerLocked: false,
              updatedBy: actorKey(req),
            },
          })
        : await tx.payrollCycle.create({
            data: {
              cycleNumber: await buildCycleNumber(tx),
              startDate: weekStart,
              endDate: weekEnd,
              status: "DRAFT",
              createdBy: actorKey(req),
              updatedBy: actorKey(req),
            },
          });

      await tx.facultyEarningsPayroll.deleteMany({ where: { payrollCycleId: cycle.id } });
      await tx.facultyEarningsPayroll.createMany({
        data: grouped.map((group) => ({
          facultyId: group.faculty.id,
          payrollCycleId: cycle.id,
          totalEntries: group.totalEntries,
          totalAmount: group.totalAmount,
          status: "DRAFT",
          createdBy: actorKey(req),
          updatedBy: actorKey(req),
        })),
      });

      return tx.payrollCycle.findUnique({
        where: { id: cycle.id },
        include: {
          payrolls: {
            orderBy: { createdAt: "asc" },
            include: { faculty: { select: { id: true, facultyId: true, fullName: true, designation: true } } },
          },
        },
      });
    });

    const dto = toCycleDto(result);
    return res.status(201).json({
      success: true,
      totalFaculty: dto.payrolls.length,
      totalPayrollAmount: dto.totalAmount,
      payrollBatchId: dto.id,
      payrollCycleId: dto.id,
      batch: dto,
    });
  } catch (error) {
    return handlePayrollError(res, error);
  }
};

export const approveFacultyPayroll = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const payrollCycleId = req.body.payrollCycleId || req.params.id;
    const approvedAt = new Date();

    const cycle = await prisma.$transaction(async (tx) => {
      const existing = await tx.payrollCycle.findUnique({ where: { id: payrollCycleId } });
      if (!existing) {
        const error = new Error("Payroll cycle not found.");
        error.statusCode = 404;
        throw error;
      }
      if (existing.status === "PAID") {
        const error = new Error("Paid payroll cycles cannot be approved again.");
        error.statusCode = 400;
        throw error;
      }

      await tx.facultyEarningsPayroll.updateMany({
        where: { payrollCycleId },
        data: {
          status: "APPROVED",
          approvedBy: actorKey(req),
          approvedAt,
          updatedBy: actorKey(req),
        },
      });
      return tx.payrollCycle.update({
        where: { id: payrollCycleId },
        data: {
          status: "APPROVED",
          ledgerLocked: true,
          approvedBy: actorKey(req),
          approvedAt,
          updatedBy: actorKey(req),
        },
        include: {
          payrolls: {
            include: { faculty: { select: { id: true, facultyId: true, fullName: true, designation: true } } },
          },
        },
      });
    });

    return res.json({ success: true, message: "Payroll approved and ledger locked.", batch: toCycleDto(cycle) });
  } catch (error) {
    return handlePayrollError(res, error);
  }
};

export const processFacultyPayroll = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const payrollCycleId = req.body.payrollCycleId || req.body.payrollBatchId;
    const paidAt = new Date();

    const cycle = await prisma.$transaction(async (tx) => {
      const existing = await tx.payrollCycle.findUnique({
        where: { id: payrollCycleId },
        include: { payrolls: true },
      });
      if (!existing) {
        const error = new Error("Payroll cycle not found.");
        error.statusCode = 404;
        throw error;
      }
      if (!["APPROVED", "LOCKED"].includes(existing.status)) {
        const error = new Error("Only approved payroll cycles can be marked paid.");
        error.statusCode = 400;
        throw error;
      }

      await tx.facultyEarningsPayroll.updateMany({
        where: { payrollCycleId },
        data: {
          status: "PAID",
          paidBy: actorKey(req),
          paidAt,
          updatedBy: actorKey(req),
        },
      });
      await tx.notification.createMany({
        data: existing.payrolls.map((payroll) => ({
          facultyId: payroll.facultyId,
          title: "Faculty earnings paid",
          message: `${existing.cycleNumber} has been marked paid for INR ${Number(payroll.totalAmount || 0)}.`,
          type: "PAYROLL_PAID",
        })),
      });
      return tx.payrollCycle.update({
        where: { id: payrollCycleId },
        data: {
          status: "PAID",
          ledgerLocked: true,
          paidBy: actorKey(req),
          paidAt,
          updatedBy: actorKey(req),
        },
        include: {
          payrolls: {
            include: { faculty: { select: { id: true, facultyId: true, fullName: true, designation: true } } },
          },
        },
      });
    });

    const dto = toCycleDto(cycle);
    return res.json({
      success: true,
      payrollBatchId: dto.id,
      payrollCycleId: dto.id,
      processedCount: dto.payrolls.length,
      totalPayrollAmount: dto.totalAmount,
      batch: dto,
    });
  } catch (error) {
    return handlePayrollError(res, error);
  }
};

export const rejectFacultyPayroll = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const payrollCycleId = req.body.payrollCycleId || req.params.id;
    const remarks = req.body.remarks || "Rejected by admin.";
    const cycle = await prisma.$transaction(async (tx) => {
      await tx.facultyEarningsPayroll.updateMany({
        where: { payrollCycleId },
        data: { status: "REJECTED", remarks, updatedBy: actorKey(req) },
      });
      return tx.payrollCycle.update({
        where: { id: payrollCycleId },
        data: { status: "REJECTED", ledgerLocked: false, updatedBy: actorKey(req) },
        include: {
          payrolls: {
            include: { faculty: { select: { id: true, facultyId: true, fullName: true, designation: true } } },
          },
        },
      });
    });
    return res.json({ success: true, message: "Payroll rejected.", batch: toCycleDto(cycle) });
  } catch (error) {
    return handlePayrollError(res, error);
  }
};

export const unlockFacultyPayrollLedger = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const payrollCycleId = req.body.payrollCycleId || req.params.id;
    const cycle = await prisma.payrollCycle.update({
      where: { id: payrollCycleId },
      data: { ledgerLocked: false, updatedBy: actorKey(req) },
      include: {
        payrolls: {
          include: { faculty: { select: { id: true, facultyId: true, fullName: true, designation: true } } },
        },
      },
    });
    return res.json({ success: true, message: "Payroll ledger unlocked for edits.", batch: toCycleDto(cycle) });
  } catch (error) {
    return handlePayrollError(res, error);
  }
};

export const getPayrollCycleReview = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const cycle = await getCycleWithPayrolls({ id: req.params.id });
    if (!cycle) {
      return res.status(404).json({ success: false, message: "Payroll cycle not found." });
    }

    const ledgerEntries = await prisma.workLedgerEntry.findMany({
      where: { date: { gte: cycle.startDate, lte: cycle.endDate } },
      orderBy: [{ date: "asc" }, { shift: "asc" }, { createdAt: "asc" }],
      include: {
        faculty: {
          select: { id: true, facultyId: true, fullName: true, designation: true },
        },
      },
    });

    const detailsByFaculty = new Map();
    for (const entry of ledgerEntries) {
      const current = detailsByFaculty.get(entry.facultyId) || {
        ledgerHistory: [],
        shiftBreakdown: { MORNING: { entries: 0, amount: 0 }, AFTERNOON: { entries: 0, amount: 0 }, EVENING: { entries: 0, amount: 0 } },
      };
      const amount = money(entry.amount);
      current.ledgerHistory.push({
        id: entry.id,
        date: toDateKey(entry.date),
        shift: entry.shift,
        amount,
        remarks: entry.remarks || "",
      });
      current.shiftBreakdown[entry.shift].entries += 1;
      current.shiftBreakdown[entry.shift].amount = money(current.shiftBreakdown[entry.shift].amount + amount);
      detailsByFaculty.set(entry.facultyId, current);
    }

    return res.json({
      success: true,
      batch: {
        ...toCycleDto(cycle),
        payrolls: cycle.payrolls.map((payroll) =>
          toPayrollDto({ ...payroll, payrollCycle: cycle }, detailsByFaculty.get(payroll.facultyId) || {
            ledgerHistory: [],
            shiftBreakdown: { MORNING: { entries: 0, amount: 0 }, AFTERNOON: { entries: 0, amount: 0 }, EVENING: { entries: 0, amount: 0 } },
          })
        ),
      },
    });
  } catch (error) {
    return handlePayrollError(res, error);
  }
};

export const getFacultyPayroll = async (req, res) => {
  try {
    if (req.userRole === "faculty") {
      const payrolls = await prisma.facultyEarningsPayroll.findMany({
        where: { facultyId: req.user.id },
        include: { payrollCycle: true },
        orderBy: [{ payrollCycle: { startDate: "desc" } }],
      });
      return res.json({
        success: true,
        payrolls: payrolls.map((payroll) => toPayrollDto(payroll)),
        earnings: {
          currentWeek: payrolls.find((payroll) => {
            const currentStart = getFridayWeekStart();
            return toDateKey(payroll.payrollCycle.startDate) === toDateKey(currentStart);
          })?.totalAmount || 0,
          currentMonth: money(
            payrolls
              .filter((payroll) => payroll.payrollCycle.startDate.getUTCMonth() === new Date().getUTCMonth())
              .reduce((sum, payroll) => sum + money(payroll.totalAmount), 0)
          ),
          previousPayrolls: payrolls.slice(0, 5).map((payroll) => toPayrollDto(payroll)),
        },
      });
    }

    if (!requireAdmin(req, res)) return null;
    const where = {};
    if (req.query.batchId || req.query.cycleId) where.id = req.query.batchId || req.query.cycleId;
    if (req.query.weekStart && req.query.weekEnd) {
      where.startDate = safeDate(req.query.weekStart);
      where.endDate = safeDate(req.query.weekEnd);
    }

    const cycle = await getCycleWithPayrolls(where);
    const currentWeekStart = getFridayWeekStart();
    const currentWeekEnd = addDays(currentWeekStart, 6);
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0));

    const [
      totalFaculty,
      pendingPayroll,
      approvedPayroll,
      paidPayroll,
      currentWeekRows,
      currentMonthRows,
      recentCycles,
    ] = await Promise.all([
      prisma.faculty.count({ where: { status: "ACTIVE" } }),
      prisma.facultyEarningsPayroll.count({ where: { status: { in: ["DRAFT", "PENDING_APPROVAL"] } } }),
      prisma.facultyEarningsPayroll.count({ where: { status: "APPROVED" } }),
      prisma.facultyEarningsPayroll.count({ where: { status: "PAID" } }),
      prisma.facultyEarningsPayroll.findMany({
        where: { payrollCycle: { startDate: currentWeekStart, endDate: currentWeekEnd } },
        select: { totalAmount: true },
      }),
      prisma.facultyEarningsPayroll.findMany({
        where: { payrollCycle: { startDate: { gte: monthStart }, endDate: { lte: monthEnd } } },
        select: { totalAmount: true },
      }),
      prisma.payrollCycle.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { payrolls: true },
      }),
    ]);

    const currentWeekTotal = money(currentWeekRows.reduce((sum, row) => sum + money(row.totalAmount), 0));
    const currentMonthTotal = money(currentMonthRows.reduce((sum, row) => sum + money(row.totalAmount), 0));

    return res.json({
      success: true,
      batch: cycle ? toCycleDto(cycle) : null,
      summary: {
        totalFaculty,
        pendingPayroll,
        approvedPayroll,
        paidPayroll,
        processedPayroll: paidPayroll,
        currentWeekTotal,
        currentMonthTotal,
        weeklyPayrollAmount: cycle ? toCycleDto(cycle).totalAmount : currentWeekTotal,
        monthlyPayrollExpense: currentMonthTotal,
      },
      recentBatches: recentCycles.map(toCycleDto),
    });
  } catch (error) {
    return handlePayrollError(res, error);
  }
};

export const getPayrollReports = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const rows = await fetchReportRows(req.query);
    const totalAmount = rows.reduce((sum, row) => sum + money(row.totalAmount), 0);
    return res.json({
      success: true,
      reportType: req.query.type || "summary",
      totalRows: rows.length,
      totalAmount: money(totalAmount),
      rows: rows.map((row) => toPayrollDto(row)),
    });
  } catch (error) {
    return handlePayrollError(res, error);
  }
};

export const exportPayrollReport = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const format = String(req.query.format || "csv").toLowerCase();
    const rows = await fetchReportRows(req.query);
    const tableRows = [
      ["Week", "Faculty ID", "Faculty Name", "Entries", "Total Amount", "Status", "Approved By", "Approved At", "Paid By", "Paid At", "Remarks"],
      ...rows.map((row) => [
        `${toDateKey(row.payrollCycle.startDate)} to ${toDateKey(row.payrollCycle.endDate)}`,
        row.faculty?.facultyId || "",
        row.faculty?.fullName || "",
        row.totalEntries,
        money(row.totalAmount),
        humanStatus(row.status),
        row.approvedBy || "",
        row.approvedAt?.toISOString?.() || "",
        row.paidBy || "",
        row.paidAt?.toISOString?.() || "",
        row.remarks || "",
      ]),
    ];

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="faculty-payroll-report-${Date.now()}.pdf"`);
      const doc = new PDFDocument({ margin: 36, size: "A4" });
      doc.pipe(res);
      doc.fontSize(16).text("Flowlytiks Faculty Payroll Report");
      doc.moveDown();
      tableRows.forEach((row) => {
        doc.fontSize(9).text(row.join(" | "));
      });
      doc.end();
      return null;
    }

    if (format === "excel" || format === "xlsx") {
      const html = `<table>${tableRows
        .map((row) => `<tr>${row.map((cell) => `<td>${String(cell).replace(/</g, "&lt;")}</td>`).join("")}</tr>`)
        .join("")}</table>`;
      res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="faculty-payroll-report-${Date.now()}.xls"`);
      return res.send(html);
    }

    const csv = tableRows.map((row) => row.map(safeCsvCell).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="faculty-payroll-report-${Date.now()}.csv"`);
    return res.send(csv);
  } catch (error) {
    return handlePayrollError(res, error);
  }
};
