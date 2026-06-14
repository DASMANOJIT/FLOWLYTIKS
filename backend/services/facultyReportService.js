import PDFDocument from "pdfkit";
import prisma from "../prisma/client.js";
import { dateOnly, normalizeMoney, toDateKey } from "./facultyPayrollService.js";

const SHIFTS = ["MORNING", "AFTERNOON", "EVENING"];
const PAID_PAYOUT_STATUSES = new Set(["SUCCESS"]);
const PROCESSING_PAYOUT_STATUSES = new Set(["PROCESSING"]);
const FAILED_PAYOUT_STATUSES = new Set(["FAILED", "CANCELLED", "REVERSED"]);
const VALID_PAYOUT_STATUSES = new Set(["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "REVERSED"]);

const money = (value) => normalizeMoney(Number(value || 0));

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const currentMonthRange = () => {
  const now = new Date();
  return {
    startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    endDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)),
  };
};

const parseMonthRange = (month) => {
  const raw = String(month || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11) return null;
  return {
    startDate: new Date(Date.UTC(year, monthIndex, 1)),
    endDate: new Date(Date.UTC(year, monthIndex + 1, 0)),
  };
};

export const resolveReportFilters = (query = {}) => {
  const monthRange = parseMonthRange(query.month);
  const fallback = currentMonthRange();
  const startDate = dateOnly(query.startDate) || monthRange?.startDate || fallback.startDate;
  const endDate = dateOnly(query.endDate) || monthRange?.endDate || fallback.endDate;
  if (startDate > endDate) {
    const error = new Error("Start date must be before end date.");
    error.statusCode = 400;
    throw error;
  }
  return {
    reportType: String(query.reportType || "monthly").trim(),
    facultyId: String(query.facultyId || "all").trim(),
    status: String(query.status || "all").trim().toUpperCase(),
    month: String(query.month || "").trim(),
    startDate,
    endDate,
    page: Math.max(Number(query.page || 1), 1),
    limit: Math.min(Math.max(Number(query.limit || 50), 1), 200),
  };
};

const fridayWeekStart = (dateValue) => {
  const date = dateOnly(dateValue);
  const daysSinceFriday = (date.getUTCDay() + 2) % 7;
  return addDays(date, -daysSinceFriday);
};

const getWeekKey = (dateValue) => toDateKey(fridayWeekStart(dateValue));

const formatWeekPeriod = (weekStart, weekEnd) => `${toDateKey(weekStart)} to ${toDateKey(weekEnd)}`;

const getPayoutPaidAmount = (payout) =>
  PAID_PAYOUT_STATUSES.has(payout.status) ? money(payout.paidAmount || payout.amount) : 0;

const getPayoutFailedAmount = (payout) =>
  FAILED_PAYOUT_STATUSES.has(payout.status) ? money(payout.unpaidAmount || payout.amount) : 0;

const getPayrollStats = (payrolls = []) => {
  const payouts = payrolls.flatMap((payroll) => payroll.payouts || []);
  const totalPayable = payrolls.reduce((sum, payroll) => sum + money(payroll.totalAmount), 0);
  const paidAmount = payouts.reduce((sum, payout) => sum + getPayoutPaidAmount(payout), 0);
  const failedAmount = payouts.reduce((sum, payout) => sum + getPayoutFailedAmount(payout), 0);
  const pendingAmount = Math.max(totalPayable - paidAmount, 0);
  const hasProcessing = payouts.some((payout) => PROCESSING_PAYOUT_STATUSES.has(payout.status));
  const hasFailed = payouts.some((payout) => FAILED_PAYOUT_STATUSES.has(payout.status));
  const allPaid = payrolls.length > 0 && payrolls.every((payroll) =>
    payroll.status === "PAID" || payroll.payouts?.some((payout) => PAID_PAYOUT_STATUSES.has(payout.status))
  );

  let status = "UNPAID";
  if (allPaid) status = "PAID";
  else if (paidAmount > 0 && pendingAmount > 0) status = "PARTIALLY_PAID";
  else if (hasProcessing) status = "PROCESSING";
  else if (hasFailed) status = "FAILED";
  else if (payrolls.some((payroll) => ["DRAFT", "PENDING_APPROVAL", "APPROVED", "LOCKED"].includes(payroll.status))) status = "PENDING";

  return { totalPayable: money(totalPayable), paidAmount: money(paidAmount), pendingAmount: money(pendingAmount), failedAmount: money(failedAmount), status };
};

const toFacultyBank = (faculty) => {
  const bank = faculty?.bankAccounts?.[0] || null;
  return {
    payoutDetailsStatus: bank?.verificationStatus || "MISSING",
    payoutEligible: Boolean(bank?.payoutEligible),
    beneficiaryStatus: bank?.cashfreeBeneficiaryStatus || "MISSING",
  };
};

const buildAttendanceWeeks = async (filters) => {
  const entries = await prisma.workLedgerEntry.findMany({
    where: {
      date: { gte: filters.startDate, lte: filters.endDate },
      ...(filters.facultyId !== "all" ? { facultyId: filters.facultyId } : {}),
    },
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
    orderBy: [{ date: "asc" }, { shift: "asc" }],
  });

  const weekMap = new Map();
  for (const entry of entries) {
    const weekStart = fridayWeekStart(entry.date);
    const weekEnd = addDays(weekStart, 6);
    const key = toDateKey(weekStart);
    const week = weekMap.get(key) || {
      weekStart,
      weekEnd,
      attendanceEntries: 0,
      facultyIds: new Set(),
      totalPayable: 0,
      facultyBreakdown: new Map(),
    };
    week.attendanceEntries += 1;
    week.facultyIds.add(entry.facultyId);
    week.totalPayable += money(entry.amount);

    const facultyRow = week.facultyBreakdown.get(entry.facultyId) || {
      facultyId: entry.faculty?.facultyId || "",
      facultyRecordId: entry.facultyId,
      facultyName: entry.faculty?.fullName || "Faculty",
      attendanceEntries: 0,
      totalAmount: 0,
      paidAmount: 0,
      pendingAmount: 0,
      failedAmount: 0,
      payoutStatus: "UNPAID",
      utr: "",
      transactionId: "",
      failureReason: "",
      ...toFacultyBank(entry.faculty),
    };
    facultyRow.attendanceEntries += 1;
    facultyRow.totalAmount += money(entry.amount);
    week.facultyBreakdown.set(entry.facultyId, facultyRow);
    weekMap.set(key, week);
  }
  return weekMap;
};

const getPayrollCycles = async (filters) =>
  prisma.payrollCycle.findMany({
    where: {
      startDate: { gte: filters.startDate, lte: filters.endDate },
      ...(filters.facultyId !== "all" ? { payrolls: { some: { facultyId: filters.facultyId } } } : {}),
    },
    include: {
      payrolls: {
        where: filters.facultyId !== "all" ? { facultyId: filters.facultyId } : undefined,
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
          payouts: true,
        },
      },
    },
    orderBy: { startDate: "desc" },
  });

export const buildWeeklyReportRows = async (filters) => {
  const [attendanceWeeks, cycles] = await Promise.all([
    buildAttendanceWeeks(filters),
    getPayrollCycles(filters),
  ]);

  const rows = [];
  for (const cycle of cycles) {
    const key = toDateKey(cycle.startDate);
    const attendanceWeek = attendanceWeeks.get(key);
    const stats = getPayrollStats(cycle.payrolls || []);
    const payouts = (cycle.payrolls || []).flatMap((payroll) => payroll.payouts || []);
    const facultyBreakdown = (cycle.payrolls || []).map((payroll) => {
      const payout = payroll.payouts?.[0] || null;
      const paidAmount = payout ? getPayoutPaidAmount(payout) : payroll.status === "PAID" ? money(payroll.totalAmount) : 0;
      const failedAmount = payout ? getPayoutFailedAmount(payout) : 0;
      return {
        payrollId: payroll.id,
        facultyRecordId: payroll.facultyId,
        facultyId: payroll.faculty?.facultyId || "",
        facultyName: payroll.faculty?.fullName || "Faculty",
        attendanceEntries: Number(payroll.totalEntries || 0),
        totalAmount: money(payroll.totalAmount),
        paidAmount,
        pendingAmount: Math.max(money(payroll.totalAmount) - paidAmount, 0),
        failedAmount,
        payoutStatus: payout?.status || payroll.status,
        utr: payout?.utr || "",
        transactionId: payout?.transactionId || "",
        failureReason: payout?.failureReason || "",
        ...toFacultyBank(payroll.faculty),
      };
    });
    rows.push({
      id: cycle.id,
      weekStart: toDateKey(cycle.startDate),
      weekEnd: toDateKey(cycle.endDate),
      weekPeriod: formatWeekPeriod(cycle.startDate, cycle.endDate),
      attendanceEntries: attendanceWeek?.attendanceEntries || cycle.payrolls.reduce((sum, payroll) => sum + Number(payroll.totalEntries || 0), 0),
      facultyCount: cycle.payrolls.length || attendanceWeek?.facultyIds.size || 0,
      totalPayable: stats.totalPayable || money(attendanceWeek?.totalPayable),
      paidAmount: stats.paidAmount,
      pendingAmount: stats.pendingAmount,
      failedAmount: stats.failedAmount,
      status: cycle.status === "PAID" ? "PAID" : stats.status,
      paidDate: cycle.paidAt || payouts.find((payout) => payout.paidAt)?.paidAt || null,
      receiptUtr: payouts.map((payout) => payout.utr || payout.transactionId).filter(Boolean).join(", ") || "",
      facultyBreakdown,
    });
    attendanceWeeks.delete(key);
  }

  for (const week of attendanceWeeks.values()) {
    const facultyBreakdown = Array.from(week.facultyBreakdown.values()).map((row) => ({
      ...row,
      totalAmount: money(row.totalAmount),
      pendingAmount: money(row.totalAmount),
    }));
    rows.push({
      id: `attendance-${toDateKey(week.weekStart)}`,
      weekStart: toDateKey(week.weekStart),
      weekEnd: toDateKey(week.weekEnd),
      weekPeriod: formatWeekPeriod(week.weekStart, week.weekEnd),
      attendanceEntries: week.attendanceEntries,
      facultyCount: week.facultyIds.size,
      totalPayable: money(week.totalPayable),
      paidAmount: 0,
      pendingAmount: money(week.totalPayable),
      failedAmount: 0,
      status: "UNPAID",
      paidDate: null,
      receiptUtr: "",
      facultyBreakdown,
    });
  }

  return rows
    .filter((row) => filters.status === "ALL" || filters.status === "all".toUpperCase() || row.status === filters.status)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));
};

const paginate = (rows, filters) => {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const start = (filters.page - 1) * filters.limit;
  return {
    rows: rows.slice(start, start + filters.limit),
    pagination: { page: filters.page, limit: filters.limit, total, totalPages },
  };
};

export const summarizeRows = (rows = []) => {
  const totalPayrollAmount = rows.reduce((sum, row) => sum + money(row.totalPayable ?? row.totalEarning ?? row.amount), 0);
  const totalPaidAmount = rows.reduce((sum, row) => sum + money(row.paidAmount), 0);
  const totalPendingAmount = rows.reduce((sum, row) => sum + money(row.pendingAmount), 0);
  const totalFailedAmount = rows.reduce((sum, row) => sum + money(row.failedAmount), 0);
  const paidFacultyIds = new Set();
  rows.forEach((row) => {
    if (money(row.paidAmount) > 0) {
      if (row.facultyRecordId) paidFacultyIds.add(row.facultyRecordId);
      row.facultyBreakdown?.forEach((item) => item.paidAmount > 0 && paidFacultyIds.add(item.facultyRecordId || item.facultyId));
    }
  });
  return {
    totalPayrollAmount: money(totalPayrollAmount),
    totalPaidAmount: money(totalPaidAmount),
    totalPendingAmount: money(totalPendingAmount),
    totalFailedAmount: money(totalFailedAmount),
    totalFacultyPaid: paidFacultyIds.size,
    totalUnpaidWeeks: rows.filter((row) => ["UNPAID", "PENDING", "PARTIALLY_PAID"].includes(row.status)).length,
    totalFailedPayouts: rows.filter((row) => row.status === "FAILED" || money(row.failedAmount) > 0).length,
  };
};

export const getWeeklyReport = async (filters) => {
  const rows = await buildWeeklyReportRows(filters);
  const result = paginate(rows, filters);
  return { summary: summarizeRows(rows), ...result };
};

export const getMonthlyReport = async (filters) => {
  const weeklyRows = await buildWeeklyReportRows(filters);
  const rows = weeklyRows.map((row) => ({
    ...row,
    month: row.weekStart.slice(0, 7),
  }));
  const result = paginate(rows, filters);
  return { summary: summarizeRows(rows), rows: result.rows, pagination: result.pagination };
};

export const getFacultyEarningsReport = async (filters) => {
  const weeklyRows = await buildWeeklyReportRows(filters);
  const map = new Map();
  for (const week of weeklyRows) {
    for (const faculty of week.facultyBreakdown || []) {
      const key = faculty.facultyRecordId || faculty.facultyId;
      const row = map.get(key) || {
        facultyRecordId: faculty.facultyRecordId,
        facultyId: faculty.facultyId,
        facultyName: faculty.facultyName,
        attendanceEntries: 0,
        totalEarning: 0,
        paidAmount: 0,
        pendingAmount: 0,
        failedAmount: 0,
        lastPaidDate: null,
        payoutDetailsStatus: faculty.payoutDetailsStatus,
        payoutEligible: faculty.payoutEligible,
        weeks: [],
      };
      row.attendanceEntries += Number(faculty.attendanceEntries || 0);
      row.totalEarning += money(faculty.totalAmount);
      row.paidAmount += money(faculty.paidAmount);
      row.pendingAmount += money(faculty.pendingAmount);
      row.failedAmount += money(faculty.failedAmount);
      if (faculty.paidAmount > 0) row.lastPaidDate = week.paidDate || row.lastPaidDate;
      row.weeks.push({
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        attendanceEntries: faculty.attendanceEntries,
        totalAmount: money(faculty.totalAmount),
        paidAmount: money(faculty.paidAmount),
        pendingAmount: money(faculty.pendingAmount),
        status: faculty.payoutStatus,
        utr: faculty.utr,
        transactionId: faculty.transactionId,
      });
      map.set(key, row);
    }
  }
  const rows = Array.from(map.values()).map((row) => ({
    ...row,
    totalEarning: money(row.totalEarning),
    paidAmount: money(row.paidAmount),
    pendingAmount: money(row.pendingAmount),
    failedAmount: money(row.failedAmount),
  })).sort((a, b) => b.totalEarning - a.totalEarning);
  const result = paginate(rows, filters);
  return { summary: summarizeRows(rows.map((row) => ({ ...row, totalPayable: row.totalEarning }))), rows: result.rows, pagination: result.pagination };
};

export const getPayoutReport = async (filters, { failedOnly = false } = {}) => {
  const mappedStatus = filters.status === "PAID" ? "SUCCESS" : filters.status;
  if (!failedOnly && filters.status !== "ALL" && !VALID_PAYOUT_STATUSES.has(mappedStatus)) {
    return { summary: summarizeRows([]), rows: [], pagination: { page: filters.page, limit: filters.limit, total: 0, totalPages: 1 } };
  }
  const payouts = await prisma.facultyPayout.findMany({
    where: {
      createdAt: { gte: filters.startDate, lte: addDays(filters.endDate, 1) },
      ...(filters.facultyId !== "all" ? { facultyId: filters.facultyId } : {}),
      ...(filters.status !== "ALL" ? { status: mappedStatus } : {}),
      ...(failedOnly ? { status: { in: Array.from(FAILED_PAYOUT_STATUSES) } } : {}),
    },
    include: {
      faculty: { select: { id: true, facultyId: true, fullName: true, bankAccounts: { orderBy: { updatedAt: "desc" }, take: 1, select: { verificationStatus: true, payoutEligible: true } } } },
      payroll: { include: { payrollCycle: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = payouts.map((payout) => {
    const paidAmount = getPayoutPaidAmount(payout);
    const failedAmount = getPayoutFailedAmount(payout);
    return {
      id: payout.id,
      weekStart: payout.payroll?.payrollCycle ? toDateKey(payout.payroll.payrollCycle.startDate) : "",
      weekEnd: payout.payroll?.payrollCycle ? toDateKey(payout.payroll.payrollCycle.endDate) : "",
      weekPeriod: payout.payroll?.payrollCycle ? formatWeekPeriod(payout.payroll.payrollCycle.startDate, payout.payroll.payrollCycle.endDate) : "-",
      facultyRecordId: payout.facultyId,
      facultyId: payout.faculty?.facultyId || "",
      facultyName: payout.faculty?.fullName || "Faculty",
      amount: money(payout.amount),
      totalPayable: money(payout.amount),
      paidAmount,
      pendingAmount: PAID_PAYOUT_STATUSES.has(payout.status) ? 0 : money(payout.unpaidAmount ?? payout.amount),
      failedAmount,
      status: payout.status === "SUCCESS" ? "PAID" : payout.status,
      cashfreeTransferId: payout.cashfreeTransferId || "",
      cashfreeReferenceId: payout.cashfreeReferenceId || "",
      utr: payout.utr || "",
      transactionId: payout.transactionId || "",
      initiatedAt: payout.payoutRequestedAt || payout.createdAt,
      paidAt: payout.paidAt || payout.payoutCompletedAt,
      failedAt: payout.payoutFailedAt,
      failureReason: payout.failureReason || "",
      retryCount: payout.retryCount || 0,
      lastRetryAt: payout.lastRetryAt,
      ...toFacultyBank(payout.faculty),
    };
  });
  const result = paginate(rows, filters);
  return { summary: summarizeRows(rows), rows: result.rows, pagination: result.pagination };
};

export const getUnpaidReport = async (filters) => {
  const weeklyRows = await buildWeeklyReportRows({ ...filters, status: "ALL" });
  const rows = [];
  for (const week of weeklyRows) {
    if (week.status === "PAID" || week.pendingAmount <= 0) continue;
    for (const faculty of week.facultyBreakdown || []) {
      if (faculty.pendingAmount <= 0) continue;
      let reasonNotPaid = "Admin delayed";
      if (faculty.payoutDetailsStatus === "MISSING") reasonNotPaid = "Payout details missing";
      else if (faculty.payoutDetailsStatus !== "VERIFIED") reasonNotPaid = "Payout details pending review";
      else if (!faculty.payoutEligible) reasonNotPaid = "Faculty not eligible";
      else if (["UNPAID", "DRAFT", "PENDING"].includes(faculty.payoutStatus)) reasonNotPaid = "Not initiated";
      rows.push({
        id: `${week.id}-${faculty.facultyRecordId || faculty.facultyId}`,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        weekPeriod: week.weekPeriod,
        facultyRecordId: faculty.facultyRecordId,
        facultyId: faculty.facultyId,
        facultyName: faculty.facultyName,
        attendanceEntries: faculty.attendanceEntries,
        payableAmount: money(faculty.totalAmount),
        totalPayable: money(faculty.totalAmount),
        paidAmount: money(faculty.paidAmount),
        pendingAmount: money(faculty.pendingAmount),
        failedAmount: money(faculty.failedAmount),
        payoutDetailsStatus: faculty.payoutDetailsStatus,
        payoutEligible: faculty.payoutEligible,
        reasonNotPaid,
        status: week.status,
      });
    }
  }
  const result = paginate(rows, filters);
  return { summary: summarizeRows(rows), rows: result.rows, pagination: result.pagination };
};

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export const buildCsv = ({ rows, columns }) => [
  columns.map((column) => csvEscape(column.header)).join(","),
  ...rows.map((row) => columns.map((column) => csvEscape(column.value(row))).join(",")),
].join("\n");

export const buildPdfBuffer = ({ title, filters, summary, rows, columns }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(18).text("Flowlytiks", { continued: true }).fontSize(14).text(`  ${title}`);
    doc.moveDown(0.4).fontSize(9).fillColor("#475569").text(`Generated: ${new Date().toLocaleString("en-IN")}`);
    doc.text(`Period: ${toDateKey(filters.startDate)} to ${toDateKey(filters.endDate)}`);
    doc.moveDown(0.5).fillColor("#0f172a").fontSize(10)
      .text(`Total Payroll: INR ${summary.totalPayrollAmount} | Paid: INR ${summary.totalPaidAmount} | Pending: INR ${summary.totalPendingAmount} | Failed: INR ${summary.totalFailedAmount}`);
    doc.moveDown();
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const columnWidth = usableWidth / columns.length;
    doc.fontSize(8).fillColor("#0f172a");
    columns.forEach((column, index) => doc.text(column.header, doc.page.margins.left + index * columnWidth, doc.y, { width: columnWidth - 4 }));
    doc.moveDown();
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#cbd5e1").stroke();
    rows.slice(0, 120).forEach((row) => {
      if (doc.y > doc.page.height - 70) doc.addPage();
      const y = doc.y + 4;
      columns.forEach((column, index) => doc.text(String(column.value(row) ?? ""), doc.page.margins.left + index * columnWidth, y, { width: columnWidth - 4, height: 34 }));
      doc.y = y + 36;
    });
    doc.end();
  });

export const REPORT_COLUMNS = {
  weekly: [
    { header: "Week Start", value: (row) => row.weekStart },
    { header: "Week End", value: (row) => row.weekEnd },
    { header: "Entries", value: (row) => row.attendanceEntries },
    { header: "Faculty", value: (row) => row.facultyCount },
    { header: "Total Payable", value: (row) => row.totalPayable },
    { header: "Paid", value: (row) => row.paidAmount },
    { header: "Pending", value: (row) => row.pendingAmount },
    { header: "Failed", value: (row) => row.failedAmount },
    { header: "Status", value: (row) => row.status },
    { header: "UTR", value: (row) => row.receiptUtr || row.utr },
    { header: "Paid Date", value: (row) => row.paidDate || row.paidAt || "" },
  ],
  faculty: [
    { header: "Faculty ID", value: (row) => row.facultyId },
    { header: "Faculty Name", value: (row) => row.facultyName },
    { header: "Entries", value: (row) => row.attendanceEntries },
    { header: "Total Earning", value: (row) => row.totalEarning },
    { header: "Paid", value: (row) => row.paidAmount },
    { header: "Pending", value: (row) => row.pendingAmount },
    { header: "Failed", value: (row) => row.failedAmount },
    { header: "Payout Eligible", value: (row) => (row.payoutEligible ? "Yes" : "No") },
    { header: "Payout Details", value: (row) => row.payoutDetailsStatus },
  ],
  payout: [
    { header: "Week Start", value: (row) => row.weekStart },
    { header: "Week End", value: (row) => row.weekEnd },
    { header: "Faculty ID", value: (row) => row.facultyId },
    { header: "Faculty Name", value: (row) => row.facultyName },
    { header: "Amount", value: (row) => row.amount },
    { header: "Status", value: (row) => row.status },
    { header: "Transfer ID", value: (row) => row.cashfreeTransferId },
    { header: "Reference ID", value: (row) => row.cashfreeReferenceId },
    { header: "UTR", value: (row) => row.utr },
    { header: "Transaction ID", value: (row) => row.transactionId },
    { header: "Failure Reason", value: (row) => row.failureReason },
    { header: "Retry Count", value: (row) => row.retryCount },
  ],
  unpaid: [
    { header: "Week Start", value: (row) => row.weekStart },
    { header: "Week End", value: (row) => row.weekEnd },
    { header: "Faculty ID", value: (row) => row.facultyId },
    { header: "Faculty Name", value: (row) => row.facultyName },
    { header: "Entries", value: (row) => row.attendanceEntries },
    { header: "Payable", value: (row) => row.payableAmount },
    { header: "Pending", value: (row) => row.pendingAmount },
    { header: "Payout Details", value: (row) => row.payoutDetailsStatus },
    { header: "Eligible", value: (row) => (row.payoutEligible ? "Yes" : "No") },
    { header: "Reason", value: (row) => row.reasonNotPaid },
  ],
};
