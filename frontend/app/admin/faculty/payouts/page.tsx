"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { apiCall } from "../../../../lib/api.js";
import { getAuthToken } from "../../../../lib/authStorage.js";
import "../faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type Payout = {
  id: string;
  faculty?: {
    id?: string;
    facultyId?: string;
    fullName?: string;
    bankAccounts?: {
      accountHolderName: string;
      ifscCode: string;
      bankName: string;
      upiId?: string | null;
      verificationStatus: string;
      payoutEligible?: boolean;
      cashfreeBeneficiaryId?: string | null;
      cashfreeBeneficiaryStatus?: string | null;
    }[];
  } | null;
  payroll?: { payrollCycle?: { cycleNumber?: string } } | null;
  amount: number | string;
  paidAmount?: number | string | null;
  unpaidAmount?: number | string | null;
  paymentMethod?: string | null;
  payoutMode?: string | null;
  status: string;
  cashfreeStatus?: string | null;
  cashfreeTransferId?: string | null;
  cashfreeReferenceId?: string | null;
  transactionId?: string | null;
  utr?: string | null;
  failureReason?: string | null;
  retryCount?: number | null;
  createdAt: string;
  paidAt?: string | null;
};

type PayoutStats = {
  pendingPayouts: number;
  processingPayouts?: number;
  completedPayouts: number;
  failedPayouts: number;
  currentWeekTotal: number;
  currentMonthTotal: number;
};

const emptyStats: PayoutStats = {
  pendingPayouts: 0,
  processingPayouts: 0,
  completedPayouts: 0,
  failedPayouts: 0,
  currentWeekTotal: 0,
  currentMonthTotal: 0,
};

const money = (value: number | string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0));

export default function FacultyPayoutsPage() {
  const router = useRouter();
  const token = useMemo(() => getAuthToken(), []);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<PayoutStats>(emptyStats);
  const [status, setStatus] = useState("all");
  const [payrollCycleId, setPayrollCycleId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return void router.push("/login");
    setLoading(true);
    setError("");
    try {
      const data = await callApi<{ payouts: Payout[]; total: number; stats?: PayoutStats }>(`/admin/faculty/payouts?status=${status}`, "GET", null, token);
      setPayouts(data.payouts || []);
      setStats(data.stats || emptyStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payouts.");
    } finally {
      setLoading(false);
    }
  }, [router, status, token]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }));

  const createBeneficiary = useCallback(async (facultyId?: string) => {
    if (!facultyId) return;
    setLoading(true);
    setError("");
    try {
      await callApi(`/admin/faculty/payouts/beneficiaries/${facultyId}/create`, "POST", null, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create beneficiary.");
    } finally {
      setLoading(false);
    }
  }, [load, token]);

  const payNow = useCallback(async (id?: string) => {
    const ids = id ? [id] : Object.keys(selected).filter((k) => selected[k]);
    if (!ids.length) return;
    const confirmed = window.confirm("This will initiate Cashfree payouts for selected faculty. Continue?");
    if (!confirmed) return;
    setLoading(true);
    setError("");
    try {
      if (id) {
        await callApi(`/admin/faculty/payouts/${id}/initiate`, "POST", null, token);
      } else {
        await callApi(`/admin/faculty/payouts/bulk-initiate`, "POST", { payoutIds: ids }, token);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate payout.");
    } finally {
      setLoading(false);
    }
  }, [selected, token, load]);

  const syncStatus = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      await callApi(`/admin/faculty/payouts/${id}/sync-status`, "POST", null, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sync payout status.");
    } finally {
      setLoading(false);
    }
  }, [load, token]);

  const markFailed = useCallback(async (id: string) => {
    const failureReason = window.prompt("Failure reason") || "";
    setLoading(true);
    setError("");
    try {
      await callApi(`/admin/faculty/payouts/${id}/mark-failed`, "POST", { failureReason }, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark payout failed.");
    } finally {
      setLoading(false);
    }
  }, [load, token]);

  const retryPayout = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      await callApi(`/admin/faculty/payouts/${id}/retry`, "POST", null, token);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retry payout.");
    } finally {
      setLoading(false);
    }
  }, [load, token]);

  const createFromPayrollCycle = useCallback(async () => {
    if (!payrollCycleId.trim()) return;
    setLoading(true);
    setError("");
    try {
      await callApi(`/admin/faculty/payouts/from-payroll-cycle`, "POST", { payrollCycleId: payrollCycleId.trim() }, token);
      setPayrollCycleId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create payouts from payroll cycle.");
    } finally {
      setLoading(false);
    }
  }, [load, payrollCycleId, token]);

  const exportCsv = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/faculty/payouts/export.csv?status=${status}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Failed to export payouts.");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `faculty-payouts-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export payouts.");
    }
  }, [status, token]);

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <h1>Faculty Payouts</h1>
        </header>

        <section className="faculty-panel">
          {error ? <p className="faculty-toast--error">{error}</p> : null}
          <div className="ledger-summary">
            <SummaryCard label="Pending Payouts" value={stats.pendingPayouts} />
            <SummaryCard label="Processing Payouts" value={stats.processingPayouts || 0} />
            <SummaryCard label="Completed Payouts" value={stats.completedPayouts} />
            <SummaryCard label="Failed Payouts" value={stats.failedPayouts} />
            <SummaryCard label="Current Week Total" value={money(stats.currentWeekTotal)} />
            <SummaryCard label="Current Month Total" value={money(stats.currentMonthTotal)} />
          </div>
          <div className="faculty-toolbar">
            <div className="faculty-field">
              <label>Status</label>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="PROCESSING">Processing</option>
                <option value="SUCCESS">Paid</option>
                <option value="FAILED">Failed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="REVERSED">Reversed</option>
              </select>
            </div>
            <div className="faculty-field">
              <label>Approved Payroll Cycle ID</label>
              <input value={payrollCycleId} onChange={(event) => setPayrollCycleId(event.target.value)} placeholder="Payroll cycle UUID" />
            </div>
            <div className="faculty-field">
              <label>Actions</label>
              <div className="ledger-export-actions">
                <button className="faculty-button faculty-button--primary" onClick={() => void createFromPayrollCycle()} disabled={loading || !payrollCycleId.trim()}>Create Payouts</button>
                <button className="faculty-button faculty-button--primary" onClick={() => void payNow()} disabled={loading || !Object.values(selected).some(Boolean)}>Bulk Initiate Payout</button>
                <button className="faculty-button faculty-button--soft" onClick={() => void exportCsv()} disabled={loading}>
                  <Download size={16} />
                  CSV
                </button>
              </div>
            </div>
          </div>
          <div className="faculty-table-wrap">
            <table className="faculty-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Faculty</th>
                  <th>Payroll Week</th>
                  <th>Payable</th>
                  <th>Paid / Pending</th>
                  <th>Payout Details</th>
                  <th>Beneficiary</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Cashfree Ref</th>
                  <th>UTR / Failure</th>
                  <th>Retry</th>
                  <th>Created</th>
                  <th>Paid At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payouts.length ? payouts.map((p) => (
                  <tr key={p.id}>
                    <td><input type="checkbox" checked={!!selected[p.id]} onChange={() => toggle(p.id)} /></td>
                    <td>
                      <strong>{p.faculty?.fullName || '-'}</strong><br />
                      <small>{p.faculty?.facultyId || '-'}</small>
                    </td>
                    <td>{p.payroll?.payrollCycle?.cycleNumber || '-'}</td>
                    <td>{money(p.amount)}</td>
                    <td>{money(p.paidAmount || 0)} / {money(p.unpaidAmount ?? p.amount)}</td>
                    <td>
                      {p.faculty?.bankAccounts?.[0] ? (
                        <div>
                          <strong>{p.faculty.bankAccounts[0].bankName}</strong><br />
                          <small>
                            {p.faculty.bankAccounts[0].verificationStatus}
                            {p.faculty.bankAccounts[0].payoutEligible ? " · Eligible" : " · Not eligible"}
                          </small>
                        </div>
                      ) : "-"}
                    </td>
                    <td>
                      {p.faculty?.bankAccounts?.[0]?.cashfreeBeneficiaryId ? (
                        <div>
                          <strong>{p.faculty.bankAccounts[0].cashfreeBeneficiaryStatus || "CREATED"}</strong><br />
                          <small>{p.faculty.bankAccounts[0].cashfreeBeneficiaryId}</small>
                        </div>
                      ) : "Missing"}
                    </td>
                    <td>{p.payoutMode || p.paymentMethod || '-'}</td>
                    <td>{p.status === "SUCCESS" ? "Paid" : p.status}</td>
                    <td>
                      {p.cashfreeReferenceId || p.cashfreeTransferId || "-"}
                      {p.cashfreeStatus ? <><br /><small>{p.cashfreeStatus}</small></> : null}
                    </td>
                    <td>{p.utr || p.transactionId || p.failureReason || '-'}</td>
                    <td>{p.retryCount || 0}</td>
                    <td>{new Date(p.createdAt).toISOString().slice(0, 10)}</td>
                    <td>{p.paidAt ? new Date(p.paidAt).toISOString().slice(0, 10) : '-'}</td>
                    <td>
                      <button className="faculty-button faculty-button--ghost" onClick={() => void createBeneficiary(p.faculty?.id)} disabled={loading || !p.faculty?.id || !!p.faculty?.bankAccounts?.[0]?.cashfreeBeneficiaryId}>Beneficiary</button>
                      <button className="faculty-button faculty-button--ghost" onClick={() => void payNow(p.id)} disabled={loading || !['PENDING', 'FAILED', 'CANCELLED', 'REVERSED'].includes(p.status)}>Initiate</button>
                      <button className="faculty-button faculty-button--ghost" onClick={() => void syncStatus(p.id)} disabled={loading || !p.cashfreeTransferId}>Sync</button>
                      <button className="faculty-button faculty-button--ghost" onClick={() => void markFailed(p.id)} disabled={loading || p.status === 'SUCCESS'}>Failed</button>
                      <button className="faculty-button faculty-button--ghost" onClick={() => void retryPayout(p.id)} disabled={loading || p.status !== 'FAILED'}>Retry</button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={15}>{loading ? 'Loading...' : 'No payouts available.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
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
