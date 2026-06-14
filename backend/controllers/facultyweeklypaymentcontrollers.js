import prisma from "../prisma/client.js";
import { createPayoutsForApprovedPayrolls, initiateBulkPayouts } from "../services/facultyPayoutService.js";

const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const toDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};
const dateOnly = (value) => {
  const date = new Date(`${String(value || "").slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
};
const actorKey = (req) => `admin:${req.user?.id || "unknown"}`;
const adminName = (req) => req.user?.name || req.user?.email || "Admin";

const requireAdmin = (req, res) => {
  if (req.userRole === "admin") return true;
  res.status(403).json({ success: false, message: "Admins only." });
  return false;
};

const parseWeek = (req, res) => {
  const weekStart = dateOnly(req.query.weekStart || req.body?.weekStart);
  const weekEnd = dateOnly(req.query.weekEnd || req.body?.weekEnd);
  if (!weekStart || !weekEnd || weekEnd < weekStart) {
    res.status(400).json({ success: false, message: "Valid weekStart and weekEnd are required." });
    return null;
  }
  return { weekStart, weekEnd };
};

const buildCycleNumber = async (tx) => {
  const count = await tx.payrollCycle.count();
  return `FP-${new Date().getUTCFullYear()}-${String(count + 1).padStart(5, "0")}`;
};

const groupAttendance = (entries) => {
  const map = new Map();
  for (const entry of entries) {
    const current = map.get(entry.facultyId) || {
      faculty: entry.faculty,
      attendanceEntries: 0,
      amount: 0,
    };
    current.attendanceEntries += 1;
    current.amount = money(current.amount + money(entry.amount));
    map.set(entry.facultyId, current);
  }
  return [...map.entries()].map(([facultyId, group]) => ({
    facultyId,
    facultyCode: group.faculty?.facultyId || "",
    facultyName: group.faculty?.fullName || "",
    attendanceEntries: group.attendanceEntries,
    amount: money(group.amount),
  }));
};

const getAttendanceBreakdown = async (weekStart, weekEnd) => {
  const entries = await prisma.workLedgerEntry.findMany({
    where: { date: { gte: weekStart, lte: weekEnd } },
    include: {
      faculty: {
        select: {
          id: true,
          facultyId: true,
          fullName: true,
          bankAccounts: {
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { verificationStatus: true, payoutEligible: true, cashfreeBeneficiaryStatus: true },
          },
        },
      },
    },
  });
  const facultyBreakdown = groupAttendance(entries).filter((row) => row.amount > 0);
  const totalAmount = money(facultyBreakdown.reduce((sum, row) => sum + row.amount, 0));
  return {
    entries,
    facultyBreakdown,
    totalEntries: entries.length,
    facultyCount: facultyBreakdown.length,
    totalAmount,
  };
};

const getExistingRecord = (weekStart, weekEnd) =>
  prisma.weeklyFacultyPaymentRecord.findUnique({
    where: { weekStart_weekEnd: { weekStart, weekEnd } },
    include: { facultyRecords: { orderBy: { facultyName: "asc" } } },
  });

const paymentRecordDto = (record) =>
  record
    ? {
        id: record.id,
        weekStart: toDateKey(record.weekStart),
        weekEnd: toDateKey(record.weekEnd),
        totalEntries: record.totalEntries,
        facultyCount: record.facultyCount,
        totalAmount: money(record.totalAmount),
        paidAmount: money(record.paidAmount),
        pendingAmount: money(record.pendingAmount),
        paymentMode: record.paymentMode,
        status: record.status,
        paidAt: record.paidAt,
        paidByAdminId: record.paidByAdminId,
        paidByAdminName: record.paidByAdminName,
        remarks: record.remarks || "",
        payrollCycleId: record.payrollCycleId || "",
        facultyRecords: (record.facultyRecords || []).map((row) => ({
          id: row.id,
          facultyId: row.facultyId,
          facultyCode: row.facultyCode || "",
          facultyName: row.facultyName || "",
          attendanceEntries: row.attendanceEntries,
          amount: money(row.amount),
          paymentMode: row.paymentMode,
          status: row.status,
          cashfreeTransferId: row.cashfreeTransferId || "",
          cashfreeReferenceId: row.cashfreeReferenceId || "",
          utr: row.utr || "",
          transactionId: row.transactionId || "",
          failureReason: row.failureReason || "",
          paidAt: row.paidAt,
          remarks: row.remarks || "",
        })),
      }
    : null;

const buildStatusPayload = async (weekStart, weekEnd) => {
  const [breakdown, record] = await Promise.all([getAttendanceBreakdown(weekStart, weekEnd), getExistingRecord(weekStart, weekEnd)]);
  const status = record?.status || (breakdown.totalAmount > 0 ? "UNPAID" : "UNPAID");
  return {
    success: true,
    weekStart: toDateKey(weekStart),
    weekEnd: toDateKey(weekEnd),
    totalEntries: record?.totalEntries ?? breakdown.totalEntries,
    facultyCount: record?.facultyCount ?? breakdown.facultyCount,
    totalAmount: record ? money(record.totalAmount) : breakdown.totalAmount,
    paidAmount: record ? money(record.paidAmount) : 0,
    pendingAmount: record ? money(record.pendingAmount) : breakdown.totalAmount,
    paymentMode: record?.paymentMode || null,
    status,
    paidAt: record?.paidAt || null,
    paidByAdminName: record?.paidByAdminName || "",
    remarks: record?.remarks || "",
    canPay: breakdown.totalAmount > 0 && !["PAID", "PROCESSING"].includes(status),
    facultyBreakdown: record?.facultyRecords?.length
      ? paymentRecordDto(record).facultyRecords
      : breakdown.facultyBreakdown,
    record: paymentRecordDto(record),
  };
};

const ensurePayable = async (weekStart, weekEnd) => {
  const existing = await getExistingRecord(weekStart, weekEnd);
  if (existing && ["PAID", "PROCESSING"].includes(existing.status)) {
    const error = new Error("This week has already been paid or is processing.");
    error.statusCode = 409;
    throw error;
  }
  const breakdown = await getAttendanceBreakdown(weekStart, weekEnd);
  if (breakdown.totalAmount <= 0 || !breakdown.totalEntries) {
    const error = new Error("No payable attendance records found for this week.");
    error.statusCode = 400;
    throw error;
  }
  return { existing, breakdown };
};

const ensurePayrollCycle = async (req, weekStart, weekEnd, breakdown) => {
  let cycle = await prisma.payrollCycle.findUnique({
    where: { startDate_endDate: { startDate: weekStart, endDate: weekEnd } },
    include: { payrolls: { include: { faculty: { include: { bankAccounts: { orderBy: { updatedAt: "desc" }, take: 1 } } }, payouts: true } } },
  });
  if (cycle) return cycle;

  const created = await prisma.$transaction(async (tx) => {
    const payrollCycle = await tx.payrollCycle.create({
      data: {
        cycleNumber: await buildCycleNumber(tx),
        startDate: weekStart,
        endDate: weekEnd,
        status: "DRAFT",
        createdBy: actorKey(req),
        updatedBy: actorKey(req),
      },
    });
    await tx.facultyEarningsPayroll.createMany({
      data: breakdown.facultyBreakdown.map((row) => ({
        facultyId: row.facultyId,
        payrollCycleId: payrollCycle.id,
        totalEntries: row.attendanceEntries,
        totalAmount: row.amount,
        status: "DRAFT",
        createdBy: actorKey(req),
        updatedBy: actorKey(req),
      })),
    });
    return payrollCycle;
  });

  return prisma.payrollCycle.findUnique({
    where: { id: created.id },
    include: { payrolls: { include: { faculty: { include: { bankAccounts: { orderBy: { updatedAt: "desc" }, take: 1 } } }, payouts: true } } },
  });
};

const upsertRecord = async ({ weekStart, weekEnd, breakdown, paymentMode, status, paidAt, req, remarks, payrollCycleId, payoutRows = [] }) => {
  const paid = status === "PAID" ? breakdown.totalAmount : 0;
  const record = await prisma.weeklyFacultyPaymentRecord.upsert({
    where: { weekStart_weekEnd: { weekStart, weekEnd } },
    update: {
      totalEntries: breakdown.totalEntries,
      facultyCount: breakdown.facultyCount,
      totalAmount: breakdown.totalAmount,
      paidAmount: paid,
      pendingAmount: Math.max(0, money(breakdown.totalAmount - paid)),
      paymentMode,
      status,
      paidAt,
      paidByAdminId: req.user?.id || null,
      paidByAdminName: adminName(req),
      remarks,
      payrollCycleId,
    },
    create: {
      weekStart,
      weekEnd,
      totalEntries: breakdown.totalEntries,
      facultyCount: breakdown.facultyCount,
      totalAmount: breakdown.totalAmount,
      paidAmount: paid,
      pendingAmount: Math.max(0, money(breakdown.totalAmount - paid)),
      paymentMode,
      status,
      paidAt,
      paidByAdminId: req.user?.id || null,
      paidByAdminName: adminName(req),
      remarks,
      payrollCycleId,
    },
    include: { facultyRecords: true },
  });

  const payoutByFaculty = new Map(payoutRows.map((payout) => [payout.facultyId, payout]));
  await Promise.all(
    breakdown.facultyBreakdown.map((row) => {
      const payout = payoutByFaculty.get(row.facultyId);
      return prisma.facultyPaymentRecord.upsert({
        where: { weeklyPaymentRecordId_facultyId: { weeklyPaymentRecordId: record.id, facultyId: row.facultyId } },
        update: {
          facultyCode: row.facultyCode,
          facultyName: row.facultyName,
          attendanceEntries: row.attendanceEntries,
          amount: row.amount,
          paymentMode,
          status: status === "PAID" ? "PAID" : payout?.status || status,
          cashfreeTransferId: payout?.cashfreeTransferId || null,
          cashfreeReferenceId: payout?.cashfreeReferenceId || null,
          utr: payout?.utr || null,
          transactionId: payout?.transactionId || null,
          failureReason: payout?.failureReason || null,
          paidAt,
          remarks,
        },
        create: {
          weeklyPaymentRecordId: record.id,
          facultyId: row.facultyId,
          facultyCode: row.facultyCode,
          facultyName: row.facultyName,
          attendanceEntries: row.attendanceEntries,
          amount: row.amount,
          paymentMode,
          status: status === "PAID" ? "PAID" : payout?.status || status,
          cashfreeTransferId: payout?.cashfreeTransferId || null,
          cashfreeReferenceId: payout?.cashfreeReferenceId || null,
          utr: payout?.utr || null,
          transactionId: payout?.transactionId || null,
          failureReason: payout?.failureReason || null,
          paidAt,
          remarks,
        },
      });
    })
  );
  return getExistingRecord(weekStart, weekEnd);
};

export const getWeeklyPaymentStatus = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const week = parseWeek(req, res);
    if (!week) return null;
    return res.json(await buildStatusPayload(week.weekStart, week.weekEnd));
  } catch (error) {
    console.error("Weekly payment status error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load weekly payment status." });
  }
};

export const payWeeklyCash = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const week = parseWeek(req, res);
    if (!week) return null;
    const { breakdown } = await ensurePayable(week.weekStart, week.weekEnd);
    const paidAt = req.body?.paidAt ? new Date(`${req.body.paidAt}T00:00:00.000Z`) : new Date();
    const cycle = await ensurePayrollCycle(req, week.weekStart, week.weekEnd, breakdown);
    await prisma.$transaction(async (tx) => {
      await tx.facultyEarningsPayroll.updateMany({
        where: { payrollCycleId: cycle.id },
        data: { status: "PAID", paidBy: actorKey(req), paidAt, updatedBy: actorKey(req) },
      });
      await tx.payrollCycle.update({
        where: { id: cycle.id },
        data: { status: "PAID", ledgerLocked: true, paidBy: actorKey(req), paidAt, updatedBy: actorKey(req) },
      });
    });
    const record = await upsertRecord({
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      breakdown,
      paymentMode: "CASH",
      status: "PAID",
      paidAt,
      req,
      remarks: req.body?.remarks || "",
      payrollCycleId: cycle.id,
    });
    return res.json({ success: true, message: "Faculty week marked paid in cash.", record: paymentRecordDto(record) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Failed to record cash payment." });
  }
};

export const payWeeklyOnline = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const week = parseWeek(req, res);
    if (!week) return null;
    const { breakdown } = await ensurePayable(week.weekStart, week.weekEnd);
    const cycle = await ensurePayrollCycle(req, week.weekStart, week.weekEnd, breakdown);
    const notReady = cycle.payrolls.filter((payroll) => {
      const bank = payroll.faculty?.bankAccounts?.[0];
      return !bank || bank.verificationStatus !== "VERIFIED" || !bank.payoutEligible;
    });
    if (notReady.length) {
      return res.status(400).json({ success: false, message: "Payout details not verified for selected faculty." });
    }
    if (cycle.status !== "APPROVED") {
      const approvedAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.facultyEarningsPayroll.updateMany({
          where: { payrollCycleId: cycle.id },
          data: { status: "APPROVED", approvedBy: actorKey(req), approvedAt, updatedBy: actorKey(req) },
        });
        await tx.payrollCycle.update({
          where: { id: cycle.id },
          data: { status: "APPROVED", ledgerLocked: true, approvedBy: actorKey(req), approvedAt, updatedBy: actorKey(req) },
        });
      });
    }
    const existingPayouts = await prisma.facultyPayout.findMany({
      where: { payroll: { payrollCycleId: cycle.id }, status: { in: ["PENDING", "PROCESSING", "SUCCESS"] } },
    });
    const payouts = existingPayouts.length
      ? existingPayouts
      : await createPayoutsForApprovedPayrolls({ payrollCycleId: cycle.id, createdBy: req.user?.id });
    const results = await initiateBulkPayouts(payouts.map((payout) => payout.id), { paidBy: req.user?.id });
    const refreshedPayouts = await prisma.facultyPayout.findMany({ where: { payroll: { payrollCycleId: cycle.id } } });
    const hasFailed = refreshedPayouts.some((payout) => ["FAILED", "CANCELLED", "REVERSED"].includes(payout.status));
    const hasSuccess = refreshedPayouts.some((payout) => payout.status === "SUCCESS");
    const status = hasFailed ? "FAILED" : hasSuccess && refreshedPayouts.every((payout) => payout.status === "SUCCESS") ? "PAID" : "PROCESSING";
    const record = await upsertRecord({
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      breakdown,
      paymentMode: "ONLINE",
      status,
      paidAt: status === "PAID" ? new Date() : null,
      req,
      remarks: "",
      payrollCycleId: cycle.id,
      payoutRows: refreshedPayouts,
    });
    return res.json({ success: true, message: "Faculty online payouts initiated.", results, record: paymentRecordDto(record) });
  } catch (error) {
    const message =
      error.statusCode === 503
        ? "Cashfree payout configuration is not available."
        : error.message || "Failed to initiate online payment.";
    return res.status(error.statusCode || 500).json({ success: false, message });
  }
};

export const listWeeklyPaymentRecords = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const where = {};
    if (req.query.paymentMode && req.query.paymentMode !== "all") where.paymentMode = String(req.query.paymentMode).toUpperCase();
    if (req.query.status && req.query.status !== "all") where.status = String(req.query.status).toUpperCase();
    if (req.query.weekStart) where.weekStart = dateOnly(req.query.weekStart);
    if (req.query.weekEnd) where.weekEnd = dateOnly(req.query.weekEnd);
    const records = await prisma.weeklyFacultyPaymentRecord.findMany({
      where,
      orderBy: { weekStart: "desc" },
      include: { facultyRecords: { orderBy: { facultyName: "asc" } } },
      take: 200,
    });
    return res.json({ success: true, records: records.map(paymentRecordDto) });
  } catch (error) {
    console.error("Weekly payment records error:", error?.message || error);
    return res.status(500).json({ success: false, message: "Failed to load payment records." });
  }
};

export const getWeeklyPaymentRecord = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return null;
    const record = await prisma.weeklyFacultyPaymentRecord.findUnique({
      where: { id: req.params.id },
      include: { facultyRecords: { orderBy: { facultyName: "asc" } } },
    });
    if (!record) return res.status(404).json({ success: false, message: "Payment record not found." });
    return res.json({ success: true, record: paymentRecordDto(record) });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to load payment record." });
  }
};
