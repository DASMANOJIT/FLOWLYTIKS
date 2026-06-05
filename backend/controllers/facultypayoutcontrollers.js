import * as payoutService from "../services/facultyPayoutService.js";
import {
  handleCashfreePayoutWebhookPayload,
  verifyCashfreePayoutWebhookSignature,
} from "../services/cashfreePayoutService.js";
import prisma from "../prisma/client.js";

const statusForHttpError = (error) => {
  const status = Number(error?.statusCode || error?.status || 500);
  return status >= 400 && status <= 599 ? status : 500;
};

export const listPayouts = async (req, res) => {
  try {
    const { page = 1, limit = 20, status = "all" } = req.query;
    const [result, stats] = await Promise.all([
      payoutService.listFacultyPayouts({ page: Number(page), limit: Number(limit), status }),
      payoutService.getPayoutDashboardStats(),
    ]);
    return res.json({ success: true, payouts: result.rows, total: result.total, stats });
  } catch (err) {
    console.error("List payouts error:", err?.message || err);
    return res.status(500).json({ success: false, message: "Failed to list payouts." });
  }
};

export const createPayoutsFromPayrollCycle = async (req, res) => {
  try {
    const payouts = await payoutService.createPayoutsForApprovedPayrolls({
      payrollCycleId: req.body.payrollCycleId,
      createdBy: req.user?.id,
    });
    return res.status(201).json({ success: true, payouts, created: payouts.length });
  } catch (err) {
    console.error("Create payroll payouts error:", err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || "Failed to create payroll payouts." });
  }
};

export const createPayout = async (req, res) => {
  try {
    const { facultyId, payrollId, amount, paymentMethod } = req.body;
    const payout = await payoutService.createPayout({ facultyId, payrollId, amount, paymentMethod, createdBy: req.user?.id });
    return res.status(201).json({ success: true, payout });
  } catch (err) {
    console.error("Create payout error:", err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || "Failed to create payout." });
  }
};

export const getPayout = async (req, res) => {
  try {
    const payout = await prisma.facultyPayout.findUnique({ where: { id: req.params.id }, include: { faculty: true, payroll: true } });
    if (!payout) return res.status(404).json({ success: false, message: "Payout not found." });
    return res.json({ success: true, payout });
  } catch (err) {
    console.error("Get payout error:", err?.message || err);
    return res.status(500).json({ success: false, message: "Failed to fetch payout." });
  }
};

export const initiatePayoutController = async (req, res) => {
  try {
    const payoutId = req.params.id;
    const result = await payoutService.initiatePayout(payoutId, { paidBy: req.user?.id });
    return res.json({ success: true, result });
  } catch (err) {
    console.error("Initiate payout error:", err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || "Failed to initiate payout." });
  }
};

export const createBeneficiaryController = async (req, res) => {
  try {
    const result = await payoutService.createBeneficiary(req.params.facultyId);
    return res.json({ success: true, result });
  } catch (err) {
    console.error("Create payout beneficiary error:", err?.message || err);
    return res.status(statusForHttpError(err)).json({ success: false, message: err?.message || "Failed to create beneficiary." });
  }
};

export const initiateBulkPayoutController = async (req, res) => {
  try {
    const results = await payoutService.initiateBulkPayouts(req.body.payoutIds || [], { paidBy: req.user?.id });
    return res.json({ success: true, results });
  } catch (err) {
    console.error("Bulk payout error:", err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || "Failed to process payouts." });
  }
};

export const markPayoutPaidController = async (req, res) => {
  try {
    const result = await payoutService.markPayoutPaid(req.params.id, {
      transactionId: req.body.transactionId,
      paidBy: req.user?.id,
    });
    return res.json({ success: true, result });
  } catch (err) {
    console.error("Mark payout paid error:", err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || "Failed to mark payout paid." });
  }
};

export const markBulkPayoutPaidController = async (req, res) => {
  try {
    const results = await payoutService.markBulkPayoutsPaid(req.body.payoutIds || [], {
      transactionId: req.body.transactionId,
      paidBy: req.user?.id,
    });
    return res.json({ success: true, results });
  } catch (err) {
    console.error("Bulk mark paid error:", err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || "Failed to mark payouts paid." });
  }
};

export const markPayoutFailedController = async (req, res) => {
  try {
    const result = await payoutService.markPayoutFailed(req.params.id, {
      failureReason: req.body.failureReason,
      modifiedBy: req.user?.id,
    });
    return res.json({ success: true, result });
  } catch (err) {
    console.error("Mark payout failed error:", err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || "Failed to mark payout failed." });
  }
};

export const retryPayoutController = async (req, res) => {
  try {
    const payoutId = req.params.id;
    const result = await payoutService.retryPayout(payoutId, { paidBy: req.user?.id });
    return res.json({ success: true, result });
  } catch (err) {
    console.error("Retry payout error:", err?.message || err);
    return res.status(500).json({ success: false, message: err?.message || "Failed to retry payout." });
  }
};

export const syncPayoutStatusController = async (req, res) => {
  try {
    const result = await payoutService.fetchPayoutStatus(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: "Payout not found." });
    return res.json({ success: true, result });
  } catch (err) {
    console.error("Sync payout status error:", err?.message || err);
    return res.status(statusForHttpError(err)).json({ success: false, message: err?.message || "Failed to sync payout status." });
  }
};

export const handleCashfreePayoutWebhook = async (req, res) => {
  try {
    if (!verifyCashfreePayoutWebhookSignature(req)) {
      return res.status(401).json({ success: false, message: "Invalid payout webhook signature." });
    }
    const result = await handleCashfreePayoutWebhookPayload(req.body || {});
    return res.json({ success: true, result });
  } catch (err) {
    console.error("Cashfree payout webhook error:", err?.message || err);
    return res.status(500).json({ success: false, message: "Failed to process payout webhook." });
  }
};

const safeCsvCell = (value) => {
  const normalized = value === null || value === undefined ? "" : String(value);
  const formulaSafe = /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
};

export const exportPayoutsCsv = async (req, res) => {
  try {
    const result = await payoutService.listFacultyPayouts({ page: 1, limit: 1000, status: req.query.status || "all" });
    const rows = [
      ["Faculty", "Payroll Week", "Amount", "Payment Method", "Status", "Reference", "UTR / Transaction ID", "Created", "Paid"],
      ...result.rows.map((payout) => [
        payout.faculty?.fullName || "",
        payout.payroll?.payrollCycle?.cycleNumber || "",
        Number(payout.amount || 0),
        payout.paymentMethod || "",
        payout.status === "SUCCESS" ? "PAID" : payout.status,
        payout.referenceId || "",
        payout.transactionId || "",
        payout.createdAt?.toISOString?.() || "",
        payout.paidAt?.toISOString?.() || "",
      ]),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="faculty-payouts-${Date.now()}.csv"`);
    return res.send(rows.map((row) => row.map(safeCsvCell).join(",")).join("\n"));
  } catch (err) {
    console.error("Export payouts error:", err?.message || err);
    return res.status(500).json({ success: false, message: "Failed to export payouts." });
  }
};

export const getPayoutReceipt = async (req, res) => {
  try {
    const payout = await prisma.facultyPayout.findUnique({
      where: { id: req.params.id },
      include: { faculty: true, payroll: { include: { payrollCycle: true } } },
    });
    if (!payout) return res.status(404).json({ success: false, message: "Payout not found." });
    return res.json({
      success: true,
      receipt: {
        facultyName: payout.faculty?.fullName,
        amount: Number(payout.amount || 0),
        payrollWeek: payout.payroll?.payrollCycle?.cycleNumber || "",
        transactionId: payout.transactionId || "",
        paymentDate: payout.paidAt,
        status: payout.status,
      },
    });
  } catch (err) {
    console.error("Payout receipt error:", err?.message || err);
    return res.status(500).json({ success: false, message: "Failed to fetch receipt." });
  }
};
