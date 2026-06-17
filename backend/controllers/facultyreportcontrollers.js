import {
  REPORT_COLUMNS,
  buildCsv,
  buildPdfBuffer,
  buildWeeklyReportRows,
  getFacultyEarningsReport as buildFacultyEarningsReport,
  getMonthlyReport,
  getPayoutReport,
  getUnpaidReport,
  getWeeklyReport,
  resolveReportFilters,
  summarizeRows,
} from "../services/facultyReportService.js";

const reportHandlers = {
  weekly: getWeeklyReport,
  monthly: getMonthlyReport,
  faculty: buildFacultyEarningsReport,
  payouts: getPayoutReport,
  unpaid: getUnpaidReport,
  failed: (filters) => getPayoutReport(filters, { failedOnly: true }),
};

const normalizeReportType = (value) => {
  const type = String(value || "monthly").trim();
  if (["weekly", "monthly", "faculty", "payouts", "unpaid", "failed"].includes(type)) return type;
  return "monthly";
};

const safeError = (res, error) => {
  console.error("Faculty report API error:", error?.message || error);
  return res.status(error?.statusCode || 500).json({
    success: false,
    message: error?.statusCode ? error.message : "Faculty report request failed. Please try again.",
  });
};

export const getFacultyReportSummary = async (req, res) => {
  try {
    const filters = resolveReportFilters(req.query);
    const rows = await buildWeeklyReportRows(filters);
    return res.json({ success: true, summary: summarizeRows(rows) });
  } catch (error) {
    return safeError(res, error);
  }
};

export const getWeeklyFacultyReport = async (req, res) => {
  try {
    const filters = resolveReportFilters(req.query);
    const data = await getWeeklyReport(filters);
    return res.json({ success: true, ...data });
  } catch (error) {
    return safeError(res, error);
  }
};

export const getMonthlyFacultyReport = async (req, res) => {
  try {
    const filters = resolveReportFilters(req.query);
    const data = await getMonthlyReport(filters);
    return res.json({ success: true, ...data });
  } catch (error) {
    return safeError(res, error);
  }
};

export const getFacultyEarningsReport = async (req, res) => {
  try {
    const filters = resolveReportFilters(req.query);
    const data = await buildFacultyEarningsReport(filters);
    return res.json({ success: true, ...data });
  } catch (error) {
    return safeError(res, error);
  }
};

export const getFacultyPayoutReport = async (req, res) => {
  try {
    const filters = resolveReportFilters(req.query);
    const data = await getPayoutReport(filters);
    return res.json({ success: true, ...data });
  } catch (error) {
    return safeError(res, error);
  }
};

export const getUnpaidFacultyPayoutReport = async (req, res) => {
  try {
    const filters = resolveReportFilters(req.query);
    const data = await getUnpaidReport(filters);
    return res.json({ success: true, ...data });
  } catch (error) {
    return safeError(res, error);
  }
};

export const getFailedFacultyPayoutReport = async (req, res) => {
  try {
    const filters = resolveReportFilters(req.query);
    const data = await getPayoutReport(filters, { failedOnly: true });
    return res.json({ success: true, ...data });
  } catch (error) {
    return safeError(res, error);
  }
};

const getExportColumns = (reportType) => {
  if (reportType === "faculty") return REPORT_COLUMNS.faculty;
  if (reportType === "payouts" || reportType === "failed") return REPORT_COLUMNS.payout;
  if (reportType === "unpaid") return REPORT_COLUMNS.unpaid;
  return REPORT_COLUMNS.weekly;
};

export const exportFacultyReportCsv = async (req, res) => {
  try {
    const filters = resolveReportFilters({ ...req.query, limit: 10000, page: 1 });
    const reportType = normalizeReportType(req.query.reportType);
    const data = await reportHandlers[reportType](filters);
    const columns = getExportColumns(reportType);
    const csv = buildCsv({ rows: data.rows || [], columns });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="faculty-${reportType}-report.csv"`);
    return res.send(csv);
  } catch (error) {
    return safeError(res, error);
  }
};

export const exportFacultyReportPdf = async (req, res) => {
  try {
    const filters = resolveReportFilters({ ...req.query, limit: 1000, page: 1 });
    const reportType = normalizeReportType(req.query.reportType);
    const data = await reportHandlers[reportType](filters);
    const columns = getExportColumns(reportType).slice(0, 8);
    const buffer = await buildPdfBuffer({
      title: `${reportType.replace(/^\w/, (char) => char.toUpperCase())} Faculty Report`,
      filters,
      summary: data.summary,
      rows: data.rows || [],
      columns,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="faculty-${reportType}-report.pdf"`);
    return res.send(buffer);
  } catch (error) {
    return safeError(res, error);
  }
};
