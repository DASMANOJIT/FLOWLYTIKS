"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { ArrowLeft, Calculator, CheckCircle2, Download, LockOpen, XCircle } from "lucide-react";
import { apiCall } from "../../../../lib/api.js";
import { getAuthToken } from "../../../../lib/authStorage.js";
import "../faculty.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type PayrollRow = {
  id: string;
  totalEntries: number;
  totalAmount: number;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PAID" | "REJECTED" | "LOCKED";
  remarks?: string;
  faculty: {
    facultyId: string;
    fullName: string;
  } | null;
  ledgerDetails?: {
    shiftBreakdown: Record<string, { entries: number; amount: number }>;
    ledgerHistory: { id: string; date: string; shift: string; amount: number; remarks: string }[];
  };
};

type Batch = {
  id: string;
  batchNumber: string;
  weekStart: string;
  weekEnd: string;
  totalAmount: number;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PAID" | "REJECTED" | "LOCKED";
  ledgerLocked?: boolean;
  payrolls?: PayrollRow[];
};

type PayrollResponse = {
  batch?: Batch | null;
  summary?: {
    totalFaculty: number;
    pendingPayroll: number;
    approvedPayroll: number;
    paidPayroll: number;
    currentWeekTotal: number;
    currentMonthTotal: number;
    weeklyPayrollAmount?: number;
    monthlyPayrollExpense?: number;
  };
  recentBatches?: Batch[];
};

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getFridayWeekStart = () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysSinceFriday = (today.getUTCDay() + 2) % 7;
  return addDays(today, -daysSinceFriday);
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

export default function FacultyPayrollPage() {
  const router = useRouter();
  const token = useMemo(() => getAuthToken(), []);
  const defaultStart = useMemo(() => getFridayWeekStart(), []);
  const [weekStart, setWeekStart] = useState(toDateKey(defaultStart));
  const [weekEnd, setWeekEnd] = useState(toDateKey(addDays(defaultStart, 6)));
  const [batch, setBatch] = useState<Batch | null>(null);
  const [summary, setSummary] = useState({
    totalFaculty: 0,
    pendingPayroll: 0,
    approvedPayroll: 0,
    paidPayroll: 0,
    currentWeekTotal: 0,
    currentMonthTotal: 0,
  });
  const [recentBatches, setRecentBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadPayroll = useCallback(async () => {
    if (!token) {
      router.push("/login");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ weekStart, weekEnd });
      const data = await callApi<PayrollResponse>(`/faculty/payroll?${params}`, "GET", null, token);
      setBatch(data.batch || null);
      if (data.summary) setSummary(data.summary);
      setRecentBatches(Array.isArray(data.recentBatches) ? data.recentBatches : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load payroll.");
    } finally {
      setLoading(false);
    }
  }, [router, token, weekEnd, weekStart]);

  useEffect(() => {
    loadPayroll();
  }, [loadPayroll]);

  const generatePayroll = async () => {
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const data = await callApi<{ payrollCycleId: string; totalPayrollAmount: number }>(
        "/faculty/payroll/generate",
        "POST",
        { weekStart, weekEnd },
        token
      );
      setMessage(`Payroll generated from ledger entries: ${money(data.totalPayrollAmount)}.`);
      await loadPayroll();
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Failed to generate payroll.");
    } finally {
      setLoading(false);
    }
  };

  const reviewPayroll = async () => {
    if (!batch) return;
    setLoading(true);
    setError("");
    try {
      const data = await callApi<PayrollResponse>(`/faculty/payroll/review/${batch.id}`, "GET", null, token);
      setBatch(data.batch || batch);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Failed to load payroll review.");
    } finally {
      setLoading(false);
    }
  };

  const approvePayroll = async () => {
    if (!batch) return;
    setLoading(true);
    setMessage("");
    setError("");
    try {
      await callApi("/faculty/payroll/approve", "POST", { payrollCycleId: batch.id }, token);
      setMessage("Payroll approved and weekly ledger locked.");
      await loadPayroll();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Failed to approve payroll.");
    } finally {
      setLoading(false);
    }
  };

  const processPayroll = async () => {
    if (!batch) return;
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const data = await callApi<{ processedCount: number; totalPayrollAmount: number }>(
        "/faculty/payroll/process",
        "POST",
        { payrollCycleId: batch.id },
        token
      );
      setMessage(`Marked ${data.processedCount} faculty payroll records as paid totaling ${money(data.totalPayrollAmount)}.`);
      await loadPayroll();
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : "Failed to process payroll.");
    } finally {
      setLoading(false);
    }
  };

  const rejectPayroll = async () => {
    if (!batch) return;
    setLoading(true);
    setMessage("");
    setError("");
    try {
      await callApi("/faculty/payroll/reject", "POST", { payrollCycleId: batch.id, remarks: "Rejected during admin review." }, token);
      setMessage("Payroll rejected.");
      await loadPayroll();
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Failed to reject payroll.");
    } finally {
      setLoading(false);
    }
  };

  const unlockPayroll = async () => {
    if (!batch) return;
    setLoading(true);
    setMessage("");
    setError("");
    try {
      await callApi("/faculty/payroll/unlock", "POST", { payrollCycleId: batch.id }, token);
      setMessage("Ledger unlocked for this payroll cycle.");
      await loadPayroll();
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "Failed to unlock ledger.");
    } finally {
      setLoading(false);
    }
  };

  const exportReport = async (format: "csv" | "excel" | "pdf") => {
    if (!token) return;
    const params = new URLSearchParams({ format });
    if (batch?.id) params.set("cycleId", batch.id);
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/faculty/payroll/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Failed to export payroll report.");
      }
      const blob = await res.blob();
      const extension = format === "excel" ? "xls" : format;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `faculty-payroll-report.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Failed to export payroll report.");
    } finally {
      setLoading(false);
    }
  };

  const trendData = {
    labels: recentBatches.slice().reverse().map((item) => item.batchNumber),
    datasets: [
      {
        label: "Weekly Payroll",
        data: recentBatches.slice().reverse().map((item) => item.totalAmount),
        borderColor: "#1d4ed8",
        backgroundColor: "rgba(29, 78, 216, 0.16)",
      },
    ],
  };

  const expenseData = {
    labels: ["Pending", "Approved", "Paid", "Current Month"],
    datasets: [
      {
        label: "Payroll Analytics",
        data: [summary.pendingPayroll, summary.approvedPayroll, summary.paidPayroll, summary.currentMonthTotal],
        backgroundColor: ["#f59e0b", "#2563eb", "#10b981", "#1d4ed8"],
      },
    ],
  };

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <button className="faculty-button faculty-button--ghost" onClick={() => router.back()}>
            <ArrowLeft size={18} />
            Back
          </button>
          <div className="faculty-title-block">
            <h1>Faculty Payroll Automation</h1>
            <p>Convert work ledger records into weekly faculty earnings for review and payout readiness.</p>
          </div>
          <Link className="faculty-button faculty-button--ghost" href="/admin/faculty">
            Faculty List
          </Link>
        </header>

        <section className="ledger-summary">
          <SummaryCard label="Total Faculty" value={summary.totalFaculty} />
          <SummaryCard label="Current Week Total" value={money(summary.currentWeekTotal)} />
          <SummaryCard label="Pending Payroll" value={summary.pendingPayroll} />
          <SummaryCard label="Approved Payroll" value={summary.approvedPayroll} />
          <SummaryCard label="Paid Payroll" value={summary.paidPayroll} />
          <SummaryCard label="Current Month Total" value={money(summary.currentMonthTotal)} />
        </section>

        <section className="faculty-panel">
          <div className="payroll-actions">
            <div className="faculty-field">
              <label>Week Start</label>
              <input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} />
            </div>
            <div className="faculty-field">
              <label>Week End</label>
              <input type="date" value={weekEnd} onChange={(event) => setWeekEnd(event.target.value)} />
            </div>
            <button className="faculty-button faculty-button--primary" onClick={generatePayroll} disabled={loading}>
              <Calculator size={17} />
              Generate Payroll
            </button>
            <button className="faculty-button faculty-button--ghost" onClick={() => exportReport("csv")} disabled={loading}>
              <Download size={17} />
              CSV
            </button>
            <button className="faculty-button faculty-button--ghost" onClick={() => exportReport("excel")} disabled={loading}>
              Excel
            </button>
            <button className="faculty-button faculty-button--ghost" onClick={() => exportReport("pdf")} disabled={loading}>
              PDF
            </button>
          </div>
          {message ? <p className="faculty-toast--success">{message}</p> : null}
          {error ? <p className="faculty-toast--error">{error}</p> : null}
        </section>

        {batch ? (
          <section className="faculty-panel">
            <h2>Batch Summary</h2>
            <div className="payroll-batch-summary">
              <SummaryCard label="Batch Number" value={batch.batchNumber} />
              <SummaryCard label="Week" value={`${batch.weekStart} to ${batch.weekEnd}`} />
              <SummaryCard label="Faculty Count" value={batch.payrolls?.length || 0} />
              <SummaryCard label="Total Earnings" value={money(batch.totalAmount)} />
              <SummaryCard label="Status" value={batch.status.replace("_", " ")} />
              <SummaryCard label="Ledger" value={batch.ledgerLocked ? "Locked" : "Open"} />
            </div>
            <div className="ledger-nav">
              <button className="faculty-button faculty-button--ghost" onClick={reviewPayroll} disabled={loading}>
                Review
              </button>
              <button className="faculty-button faculty-button--primary" onClick={approvePayroll} disabled={loading || !["DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(batch.status)}>
                <CheckCircle2 size={17} />
                Approve Payroll
              </button>
              <button
                className="faculty-button faculty-button--primary"
                onClick={processPayroll}
                disabled={loading || !["APPROVED", "LOCKED"].includes(batch.status)}
              >
                <CheckCircle2 size={17} />
                Mark Paid
              </button>
              <button className="faculty-button faculty-button--ghost" onClick={rejectPayroll} disabled={loading || batch.status === "PAID"}>
                <XCircle size={17} />
                Reject
              </button>
              <button className="faculty-button faculty-button--ghost" onClick={unlockPayroll} disabled={loading || !batch.ledgerLocked}>
                <LockOpen size={17} />
                Unlock Ledger
              </button>
            </div>
          </section>
        ) : null}

        <section className="faculty-panel">
          <div className="faculty-table-wrap">
            <table className="faculty-table">
              <thead>
                <tr>
                  <th>Faculty ID</th>
                  <th>Faculty Name</th>
                  <th>Week</th>
                  <th>Total Entries</th>
                  <th>Total Amount</th>
                  <th>Remarks</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {batch?.payrolls?.length ? (
                  batch.payrolls.map((row) => (
                    <tr key={row.id}>
                      <td>{row.faculty?.facultyId || "-"}</td>
                      <td>{row.faculty?.fullName || "-"}</td>
                      <td>{batch.weekStart} to {batch.weekEnd}</td>
                      <td>{row.totalEntries}</td>
                      <td>{money(row.totalAmount)}</td>
                      <td>{row.remarks || "-"}</td>
                      <td>
                        <span className={`faculty-status faculty-status--${row.status === "PAID" || row.status === "APPROVED" ? "ACTIVE" : "INACTIVE"}`}>
                          {row.status.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="faculty-empty">
                        {loading ? "Loading payroll..." : "Generate payroll to view faculty salary rows."}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="payroll-chart-grid">
          <div className="faculty-panel payroll-chart-box">
            <h2>Weekly Payroll Trend</h2>
            <Line data={trendData} />
          </div>
          <div className="faculty-panel payroll-chart-box">
            <h2>Earnings Analytics</h2>
            <Bar data={expenseData} />
          </div>
        </section>
        {batch?.payrolls?.some((row) => row.ledgerDetails) ? (
          <section className="faculty-panel">
            <h2>Payroll Review</h2>
            <div className="ledger-rank-list">
              {batch.payrolls.map((row) => (
                <div className="ledger-rank-item" key={`review-${row.id}`}>
                  <div>
                    <strong>{row.faculty?.fullName || "-"}</strong>
                    <span>
                      Morning {row.ledgerDetails?.shiftBreakdown.MORNING.entries || 0} / {money(row.ledgerDetails?.shiftBreakdown.MORNING.amount || 0)} · Afternoon {row.ledgerDetails?.shiftBreakdown.AFTERNOON.entries || 0} / {money(row.ledgerDetails?.shiftBreakdown.AFTERNOON.amount || 0)} · Evening {row.ledgerDetails?.shiftBreakdown.EVENING.entries || 0} / {money(row.ledgerDetails?.shiftBreakdown.EVENING.amount || 0)}
                    </span>
                    <span>{row.ledgerDetails?.ledgerHistory.length || 0} ledger entries reviewed.</span>
                  </div>
                  <strong>{money(row.totalAmount)}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ledger-summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
