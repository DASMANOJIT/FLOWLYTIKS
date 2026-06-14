"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, X } from "lucide-react";
import { apiCall } from "../../../../lib/api.js";
import { getAuthRole, getAuthToken } from "../../../../lib/authStorage.js";
import PremiumLoader from "../../../components/ui/PremiumLoader";
import "../faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type FacultyPaymentRecord = {
  id: string;
  facultyCode: string;
  facultyName: string;
  attendanceEntries: number;
  amount: number;
  paymentMode: string;
  status: string;
  cashfreeTransferId?: string;
  cashfreeReferenceId?: string;
  utr?: string;
  transactionId?: string;
  failureReason?: string;
  remarks?: string;
};

type WeeklyRecord = {
  id: string;
  weekStart: string;
  weekEnd: string;
  paymentMode: string;
  status: string;
  facultyCount: number;
  totalEntries: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  paidAt: string | null;
  paidByAdminName?: string;
  remarks?: string;
  facultyRecords: FacultyPaymentRecord[];
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
};

export default function FacultyPaymentRecordsPage() {
  const [token, setToken] = useState("");
  const [records, setRecords] = useState<WeeklyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<WeeklyRecord | null>(null);
  const [filters, setFilters] = useState({ weekStart: "", weekEnd: "", paymentMode: "all", status: "all" });

  useEffect(() => {
    const authToken = getAuthToken();
    if (!authToken || getAuthRole() !== "admin") {
      window.location.href = "/login";
      return;
    }
    setToken(authToken);
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "all") params.set(key, value);
    });
    return params.toString();
  }, [filters]);

  const loadRecords = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const data = await callApi<{ records?: WeeklyRecord[] }>(`/faculty-weekly-payments/records?${query}`, "GET", null, token);
      setRecords(data.records || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load faculty payment records.");
    } finally {
      setLoading(false);
    }
  }, [query, token]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const resetFilters = () => setFilters({ weekStart: "", weekEnd: "", paymentMode: "all", status: "all" });

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <Link className="faculty-button faculty-button--ghost" href="/admin/faculty">
            <ArrowLeft size={18} />
            Back
          </Link>
          <div className="faculty-title-block">
            <h1>Faculty Payment Records</h1>
            <p>View weekly online and cash payment records for faculty payouts.</p>
          </div>
          <Link className="faculty-button faculty-button--soft" href="/admin/faculty/work-ledger">
            Work Ledger
          </Link>
        </header>

        <section className="faculty-panel">
          <div className="faculty-toolbar">
            <div className="faculty-field">
              <label>Week Start</label>
              <input type="date" value={filters.weekStart} onChange={(event) => setFilters((current) => ({ ...current, weekStart: event.target.value }))} />
            </div>
            <div className="faculty-field">
              <label>Week End</label>
              <input type="date" value={filters.weekEnd} onChange={(event) => setFilters((current) => ({ ...current, weekEnd: event.target.value }))} />
            </div>
            <div className="faculty-field">
              <label>Payment Mode</label>
              <select value={filters.paymentMode} onChange={(event) => setFilters((current) => ({ ...current, paymentMode: event.target.value }))}>
                <option value="all">All</option>
                <option value="ONLINE">Online</option>
                <option value="CASH">Cash</option>
              </select>
            </div>
            <div className="faculty-field">
              <label>Status</label>
              <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
                <option value="all">All</option>
                <option value="PROCESSING">Processing</option>
                <option value="PAID">Paid</option>
                <option value="FAILED">Failed</option>
              </select>
            </div>
            <div className="faculty-field faculty-field--actions">
              <label>Filters</label>
              <button className="faculty-button faculty-button--ghost" onClick={resetFilters}>
                <RotateCcw size={16} />
                Reset Filters
              </button>
            </div>
          </div>
        </section>

        <section className="faculty-panel faculty-table-card">
          {error ? <div className="faculty-toast--error">{error}</div> : null}
          <div className="faculty-table-wrap">
            <table className="faculty-table">
              <thead>
                <tr>
                  <th>Week Period</th>
                  <th>Payment Mode</th>
                  <th>Faculty Count</th>
                  <th>Total Entries</th>
                  <th>Total Amount</th>
                  <th>Paid Amount</th>
                  <th>Status</th>
                  <th>Paid At</th>
                  <th>Paid By</th>
                  <th>Receipt / UTR</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={11}><PremiumLoader label="Loading payment records" compact /></td></tr>
                ) : records.length ? records.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDate(record.weekStart)} to {formatDate(record.weekEnd)}</td>
                    <td>{record.paymentMode}</td>
                    <td>{record.facultyCount}</td>
                    <td>{record.totalEntries}</td>
                    <td>{money(record.totalAmount)}</td>
                    <td>{money(record.paidAmount)}</td>
                    <td><span className={`faculty-status faculty-status--${record.status}`}>{record.status}</span></td>
                    <td>{formatDate(record.paidAt)}</td>
                    <td>{record.paidByAdminName || "-"}</td>
                    <td>{record.facultyRecords.map((row) => row.utr || row.transactionId).filter(Boolean).join(", ") || "-"}</td>
                    <td><button className="faculty-button faculty-button--soft" onClick={() => setSelected(record)}>View Details</button></td>
                  </tr>
                )) : (
                  <tr><td colSpan={11}>No faculty payment records found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {selected ? (
        <div className="faculty-modal-backdrop" role="dialog" aria-modal="true">
          <div className="faculty-modal payroll-detail-modal">
            <div className="faculty-modal-header">
              <h2>Payment Details — {formatDate(selected.weekStart)} to {formatDate(selected.weekEnd)}</h2>
              <button className="faculty-icon-button" onClick={() => setSelected(null)}><X size={18} /></button>
            </div>
            <div className="faculty-detail-list">
              <div><span>Payment Mode</span><strong>{selected.paymentMode}</strong></div>
              <div><span>Status</span><strong>{selected.status}</strong></div>
              <div><span>Total Amount</span><strong>{money(selected.totalAmount)}</strong></div>
              <div><span>Paid Date</span><strong>{formatDate(selected.paidAt)}</strong></div>
              <div><span>Paid By</span><strong>{selected.paidByAdminName || "-"}</strong></div>
              <div><span>Remarks</span><strong>{selected.remarks || "-"}</strong></div>
            </div>
            <div className="faculty-table-wrap">
              <table className="faculty-table">
                <thead>
                  <tr>
                    <th>Faculty ID</th>
                    <th>Faculty Name</th>
                    <th>Entries</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>UTR / Transaction</th>
                    <th>Remarks / Failure</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.facultyRecords.map((row) => (
                    <tr key={row.id}>
                      <td>{row.facultyCode}</td>
                      <td>{row.facultyName}</td>
                      <td>{row.attendanceEntries}</td>
                      <td>{money(row.amount)}</td>
                      <td>{row.status}</td>
                      <td>{row.utr || row.transactionId || row.cashfreeTransferId || "-"}</td>
                      <td>{row.failureReason || row.remarks || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
