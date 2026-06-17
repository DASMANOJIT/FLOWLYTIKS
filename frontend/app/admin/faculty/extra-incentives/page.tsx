"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Edit3, Gift, Plus, RotateCcw, X } from "lucide-react";
import { apiCall } from "../../../../lib/api.js";
import { getAuthRole, getAuthToken } from "../../../../lib/authStorage.js";
import PremiumLoader from "../../../components/ui/PremiumLoader";
import "../faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type IncentiveType = { id: string; name: string; rate: number; isActive: boolean };
type IncentiveLine = { incentiveTypeId: string; name: string; quantity: number; rate: number; amount: number };
type FacultySummary = {
  facultyId: string;
  facultyCode: string;
  facultyName: string;
  pendingSummary: IncentiveLine[];
  pendingCount: number;
  pendingAmount: number;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);

const getCurrentAdminToken = () => {
  const authToken = getAuthToken();
  return authToken && getAuthRole() === "admin" ? authToken : "";
};

export default function AdminFacultyExtraIncentivesPage() {
  const [token, setToken] = useState("");
  const [types, setTypes] = useState<IncentiveType[]>([]);
  const [facultySummaries, setFacultySummaries] = useState<FacultySummary[]>([]);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payingFacultyId, setPayingFacultyId] = useState("");
  const [editingType, setEditingType] = useState<IncentiveType | null>(null);
  const [editName, setEditName] = useState("");
  const [editRate, setEditRate] = useState("");
  const [selectedFaculty, setSelectedFaculty] = useState<FacultySummary | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "CASHFREE">("CASH");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const authToken = getCurrentAdminToken();
    if (!authToken) {
      window.location.href = "/login";
      return;
    }
    setToken(authToken);
  }, []);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const data = await callApi<{ types?: IncentiveType[]; facultySummaries?: FacultySummary[] }>("/faculty-extra-incentives/admin/summary", "GET", null, token);
      setTypes(data.types || []);
      setFacultySummaries(data.facultySummaries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load extra incentives.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const createType = async (event: React.FormEvent) => {
    event.preventDefault();
    const currentToken = getCurrentAdminToken();
    if (!currentToken) {
      setError("Session expired. Please login again.");
      window.location.href = "/login";
      return;
    }
    if (saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await callApi("/faculty-extra-incentives/types", "POST", { name, rate: Number(rate) }, currentToken);
      setName("");
      setRate("");
      setMessage("Incentive type created.");
      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create incentive type.");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (type: IncentiveType) => {
    setEditingType(type);
    setEditName(type.name);
    setEditRate(String(type.rate));
  };

  const saveEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    const currentToken = getCurrentAdminToken();
    if (!currentToken) {
      setError("Session expired. Please login again.");
      window.location.href = "/login";
      return;
    }
    if (!editingType || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await callApi(`/faculty-extra-incentives/types/${editingType.id}`, "PATCH", { name: editName, rate: Number(editRate) }, currentToken);
      setEditingType(null);
      setMessage("Incentive type updated.");
      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update incentive type.");
    } finally {
      setSaving(false);
    }
  };

  const openPayment = (faculty: FacultySummary) => {
    if (faculty.pendingAmount <= 0) return;
    setSelectedFaculty(faculty);
    setPaymentMethod("CASH");
  };

  const payFaculty = async (method = paymentMethod) => {
    const currentToken = getCurrentAdminToken();
    if (!currentToken) {
      setError("Session expired. Please login again.");
      window.location.href = "/login";
      return;
    }
    if (payingFacultyId || !selectedFaculty || selectedFaculty.pendingAmount <= 0) return;
    const faculty = selectedFaculty;
    setPayingFacultyId(faculty.facultyId);
    setError("");
    setMessage("");
    try {
      await callApi(`/faculty-extra-incentives/admin/pay/${faculty.facultyId}`, "POST", { method }, currentToken);
      setSelectedFaculty(null);
      setMessage(method === "CASH" ? "Extra incentive marked paid in cash." : "Cashfree payout initiated for extra incentive.");
      await loadSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pay extra incentive.");
    } finally {
      setPayingFacultyId("");
    }
  };

  const totalPending = useMemo(
    () => facultySummaries.reduce((sum, item) => sum + Number(item.pendingAmount || 0), 0),
    [facultySummaries]
  );

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <Link className="faculty-button faculty-button--ghost" href="/admin/faculty">
            <ArrowLeft size={18} />
            Back
          </Link>
          <div className="faculty-title-block">
            <h1>Extra Incentives</h1>
            <p>Create incentive rates and pay faculty incentive amounts separately from weekly payroll.</p>
          </div>
          <button className="faculty-button faculty-button--ghost" onClick={loadSummary} disabled={loading}>
            <RotateCcw size={17} />
            Refresh
          </button>
        </header>

        {error ? <div className="faculty-toast--error">{error}</div> : null}
        {message ? <div className="faculty-toast--success">{message}</div> : null}

        <section className="faculty-panel">
          <div className="faculty-section-heading">
            <div>
              <h2>Create Incentive Type</h2>
              <p>Each saved rate is snapshotted when faculty adds a pending count.</p>
            </div>
          </div>
          <form className="faculty-form-grid" onSubmit={createType}>
            <label className="faculty-field">
              <span>Incentive Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Mock Test Bonus" required />
            </label>
            <label className="faculty-field">
              <span>Rate</span>
              <input type="number" min="1" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="100" required />
            </label>
            <div className="faculty-field faculty-field--actions">
              <span>Action</span>
              <button className="faculty-button faculty-button--primary" type="submit" disabled={saving}>
                <Plus size={17} />
                {saving ? "Saving" : "Create Incentive"}
              </button>
            </div>
          </form>
        </section>

        <section className="faculty-panel faculty-table-card">
          <div className="faculty-section-heading">
            <div>
              <h2>Incentive Types</h2>
              <p>{types.length} type{types.length === 1 ? "" : "s"} configured.</p>
            </div>
          </div>
          <div className="faculty-table-wrap">
            <table className="faculty-table">
              <thead><tr><th>Name</th><th>Rate</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4}><PremiumLoader label="Loading incentives" compact /></td></tr>
                ) : types.length ? types.map((type) => (
                  <tr key={type.id}>
                    <td>{type.name}</td>
                    <td>{money(type.rate)}</td>
                    <td>{type.isActive ? "Active" : "Inactive"}</td>
                    <td>
                      <button className="faculty-button faculty-button--soft" onClick={() => openEdit(type)}>
                        <Edit3 size={16} />
                        Edit
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={4}>No incentive types created yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="faculty-panel faculty-table-card">
          <div className="faculty-section-heading">
            <div>
              <h2>Faculty Pending Incentives</h2>
              <p>Total pending: {money(totalPending)}</p>
            </div>
          </div>
          <div className="faculty-table-wrap">
            <table className="faculty-table">
              <thead>
                <tr><th>Faculty ID</th><th>Faculty Name</th><th>Pending Summary</th><th>Pending Count</th><th>Pending Amount</th><th>Action</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6}><PremiumLoader label="Loading faculty incentives" compact /></td></tr>
                ) : facultySummaries.length ? facultySummaries.map((faculty) => (
                  <tr key={faculty.facultyId}>
                    <td>{faculty.facultyCode}</td>
                    <td>{faculty.facultyName}</td>
                    <td>{faculty.pendingSummary.map((item) => `${item.name}: ${item.quantity} x ${money(item.rate)}`).join(", ") || "-"}</td>
                    <td>{faculty.pendingCount}</td>
                    <td>{money(faculty.pendingAmount)}</td>
                    <td>
                      <button
                        className="faculty-button faculty-button--primary"
                        disabled={faculty.pendingAmount <= 0 || payingFacultyId === faculty.facultyId}
                        onClick={() => openPayment(faculty)}
                      >
                        <Gift size={16} />
                        Pay
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={6}>No faculty members found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      {editingType ? (
        <div className="faculty-modal-backdrop" role="dialog" aria-modal="true">
          <div className="faculty-modal">
            <div className="faculty-modal-header">
              <h2>Edit Incentive</h2>
              <button className="faculty-icon-button" onClick={() => setEditingType(null)}><X size={18} /></button>
            </div>
            <form className="faculty-form-grid" onSubmit={saveEdit}>
              <label className="faculty-field">
                <span>Incentive Name</span>
                <input value={editName} onChange={(event) => setEditName(event.target.value)} required />
              </label>
              <label className="faculty-field">
                <span>Rate</span>
                <input type="number" min="1" step="0.01" value={editRate} onChange={(event) => setEditRate(event.target.value)} required />
              </label>
              <div className="faculty-modal-actions">
                <button type="button" className="faculty-button faculty-button--ghost" onClick={() => setEditingType(null)}>Cancel</button>
                <button type="submit" className="faculty-button faculty-button--primary" disabled={saving}>
                  {saving ? "Saving" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {selectedFaculty ? (
        <div className="faculty-modal-backdrop" role="dialog" aria-modal="true">
          <div className="faculty-modal payroll-detail-modal">
            <div className="faculty-modal-header">
              <h2>Pay Extra Incentives</h2>
              <button className="faculty-icon-button" onClick={() => setSelectedFaculty(null)}><X size={18} /></button>
            </div>
            <div className="faculty-detail-list">
              <div><span>Faculty ID</span><strong>{selectedFaculty.facultyCode}</strong></div>
              <div><span>Faculty Name</span><strong>{selectedFaculty.facultyName}</strong></div>
              <div><span>Grand Total</span><strong>{money(selectedFaculty.pendingAmount)}</strong></div>
            </div>
            <div className="faculty-table-wrap">
              <table className="faculty-table">
                <thead><tr><th>Incentive</th><th>Count</th><th>Rate</th><th>Total</th></tr></thead>
                <tbody>
                  {selectedFaculty.pendingSummary.map((item) => (
                    <tr key={item.incentiveTypeId}>
                      <td>{item.name}</td>
                      <td>{item.quantity}</td>
                      <td>{money(item.rate)}</td>
                      <td>{money(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section className="faculty-panel">
              <div className="faculty-section-heading"><h3>Payment Method</h3></div>
              <label className="faculty-field">
                <span>Mode</span>
                <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "CASH" | "CASHFREE")}>
                  <option value="CASH">Cash Payment</option>
                  <option value="CASHFREE">Cashfree Payout</option>
                </select>
              </label>
            </section>
            <div className="faculty-modal-actions">
              <button className="faculty-button faculty-button--ghost" onClick={() => setSelectedFaculty(null)}>Cancel</button>
              <button className="faculty-button faculty-button--soft" onClick={() => void payFaculty("CASH")} disabled={Boolean(payingFacultyId)}>
                Confirm Cash Payment
              </button>
              <button className="faculty-button faculty-button--primary" onClick={() => void payFaculty("CASHFREE")} disabled={Boolean(payingFacultyId)}>
                Proceed with Cashfree Payout
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
