"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Pencil, X } from "lucide-react";
import Modal from "../../components/ui/Modal";
import { apiCall } from "../../../lib/api.js";
import { getFacultyAuthToken } from "../../../lib/authStorage.js";
import PremiumLoader from "../../components/ui/PremiumLoader";
import FacultyPortalLayout from "../FacultyPortalLayout";
import "../../admin/faculty/faculty.css";
import OnlineClassSummary from "./OnlineClassSummary";
import CopySetsForm from "./CopySetsForm";
import styles from "./copy-sets.module.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type IncentiveType = { id: string; name: string; rate: number; onlineClassWorkflow?: boolean };
const isOnline = (type: IncentiveType) => type.onlineClassWorkflow || type.name.trim().replace(/\s+/g, " ").toUpperCase() === "ONLINE DOUBT CLASS";
const actionLabel = (type: IncentiveType) => `${isOnline(type) ? "View Records" : "Edit"} ${type.name}`;
type IncentiveLine = { incentiveTypeId: string; name: string; quantity: number; rate: number; amount: number };
type IncentiveEntry = { id: string; name: string; quantityChange: number; rate: number; amount: number; note?: string | null; status: string; createdAt: string };
type IncentivePayment = {
  id: string;
  totalAmount: number;
  status: string;
  paymentMethod: string;
  paidAt: string;
  cashfreeTransferId?: string;
  cashfreeReferenceId?: string;
  utr?: string;
  transactionId?: string;
  failureReason?: string;
  summary: IncentiveLine[];
};

const money = (value: number, maximumFractionDigits = 0) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits }).format(value || 0);

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

export default function FacultyExtraIncentivesPage() {
  const token = useMemo(() => getFacultyAuthToken(), []);
  const [types, setTypes] = useState<IncentiveType[]>([]);
  const [pendingSummary, setPendingSummary] = useState<IncentiveLine[]>([]);
  const [entries, setEntries] = useState<IncentiveEntry[]>([]);
  const [payments, setPayments] = useState<IncentivePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ type: IncentiveType; quantity: number; amount: number } | null>(null);
  const submitting = useRef(false);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());

  const loadData = useCallback(async () => {
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await callApi<{
        types?: IncentiveType[];
        pendingSummary?: IncentiveLine[];
        entries?: IncentiveEntry[];
        payments?: IncentivePayment[];
      }>("/faculty-extra-incentives/my", "GET", null, token);
      setTypes(data.types || []);
      setPendingSummary(data.pendingSummary || []);
      setEntries(data.entries || []);
      setPayments(data.payments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load extra incentives.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const closeEdit = () => {
    if (submitting.current) return;
    const id = editing?.type.id;
    setEditing(null);
    if (id) requestAnimationFrame(() => {
      const type = types.find(type => type.id === id);
      const label = type ? actionLabel(type) : "";
      const button = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
        .find(element => element.getAttribute("aria-label") === label && element.getClientRects().length);
      button?.focus({ preventScroll: true });
    });
  };
  const onlineClassEdit = editing && isOnline(editing.type);

  const pendingByType = useMemo(() => {
    const map = new Map<string, IncentiveLine>();
    pendingSummary.forEach((item) => map.set(item.incentiveTypeId, item));
    return map;
  }, [pendingSummary]);

  return (
    <FacultyPortalLayout title="Extra Incentives" subtitle="Track your separate pending incentives and paid incentive history.">
      {error ? <div className="faculty-toast--error">{error}</div> : null}

      <section className="faculty-panel faculty-table-card">
        <div className="faculty-section-heading">
          <div>
            <h2>Available Incentives</h2>
          </div>
        </div>
        <div className={`faculty-table-wrap ${styles.desktopList}`}>
          <table className="faculty-table">
            <thead><tr><th>Incentive</th><th>Rate</th><th>Pending Count</th><th>Pending Amount</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5}><PremiumLoader label="Loading incentives" compact /></td></tr>
              ) : types.length ? types.map((type) => {
                const pending = pendingByType.get(type.id);
                return (
                  <tr key={type.id}>
                    <td>{type.name}</td>
                    <td>{money(type.rate)}</td>
                    <td>{pending?.quantity || 0}</td>
                    <td>{money(pending?.amount || 0)}</td>
                    <td>
                      <button ref={element => { if (element) editButtons.current.set(type.id, element); else editButtons.current.delete(type.id); }} className="faculty-button faculty-button--ghost" disabled={Boolean(busyId)} onClick={() => {
                        setEditing({ type, quantity: pending?.quantity || 0, amount: pending?.amount || 0 });
                      }} aria-label={actionLabel(type)}>
                        {isOnline(type) ? <Eye size={16} /> : <Pencil size={16} />} {isOnline(type) ? "View Records" : "Edit"}
                      </button>
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={5}>No incentive types are active yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <ul className={styles.mobileList}>
          {loading ? <li><PremiumLoader label="Loading incentives" compact /></li> : types.length ? types.map(type => {
            const pending = pendingByType.get(type.id);
            return <li key={type.id}><div><strong>{type.name}</strong><dl><div><dt>Rate</dt><dd>{money(type.rate)}</dd></div><div><dt>Pending Count</dt><dd>{pending?.quantity || 0}</dd></div><div><dt>Pending Amount</dt><dd>{money(pending?.amount || 0)}</dd></div></dl></div><button className="faculty-button faculty-button--ghost" disabled={Boolean(busyId)} aria-label={actionLabel(type)} onClick={event => {
              editButtons.current.set(type.id, event.currentTarget);
              setEditing({ type, quantity: pending?.quantity || 0, amount: pending?.amount || 0 });
            }}>{isOnline(type) ? <Eye size={16} /> : <Pencil size={16} />} {isOnline(type) ? "View Records" : "Edit"}</button></li>;
          }) : <li>No incentive types are active yet.</li>}
        </ul>
      </section>
      {editing ? <Modal onClose={closeEdit}>
        <div className={`faculty-modal ${onlineClassEdit ? "" : styles.copyModal}`}>
          <div className="faculty-modal-header"><h2>{onlineClassEdit ? "Online Doubt Class" : editing.type.name}</h2><button className="faculty-icon-button" type="button" onClick={closeEdit} disabled={Boolean(busyId)} aria-label="Close"><X size={18} /></button></div>
          {onlineClassEdit ? <OnlineClassSummary token={token} incentiveTypeId={editing.type.id} /> : <CopySetsForm token={token} incentiveTypeId={editing.type.id} rate={types.find(type => type.id === editing.type.id)?.rate ?? editing.type.rate} pendingCount={pendingByType.get(editing.type.id)?.quantity || 0} pendingAmount={pendingByType.get(editing.type.id)?.amount || 0} onChanged={loadData} onBusy={busy => { submitting.current = busy; setBusyId(busy ? editing.type.id : ""); }} />}
        </div>
      </Modal> : null}

      <section className="faculty-panel faculty-table-card">
        <div className="faculty-section-heading"><h2>Recent Records</h2></div>
        <div className="faculty-table-wrap">
          <table className="faculty-table">
            <thead><tr><th>Incentive</th><th>Count Change</th><th>Rate</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6}><PremiumLoader label="Loading records" compact /></td></tr>
              ) : entries.length ? entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.name}</td>
                  <td>{entry.quantityChange}</td>
                  <td>{money(entry.rate)}</td>
                  <td>{money(entry.amount)}</td>
                  <td>{entry.status}</td>
                  <td>{formatDate(entry.createdAt)}</td>
                </tr>
              )) : (
                <tr><td colSpan={6}>No incentive records found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="faculty-panel faculty-table-card">
        <div className="faculty-section-heading"><h2>Paid History</h2></div>
        <div className="faculty-table-wrap">
          <table className="faculty-table">
            <thead><tr><th>Paid At</th><th>Method</th><th>Summary</th><th>Total Amount</th><th>Status</th><th>Reference</th></tr></thead>
            <tbody>
              {payments.length ? payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{formatDate(payment.paidAt)}</td>
                  <td>{payment.paymentMethod === "CASHFREE" ? "Cashfree Payout" : "Cash"}</td>
                  <td>{(payment.summary || []).map((item) => `${item.name}: ${item.quantity} x ${money(item.rate)}`).join(", ") || "-"}</td>
                  <td>{money(payment.totalAmount)}</td>
                  <td>{payment.status}</td>
                  <td>{payment.utr || payment.transactionId || payment.cashfreeReferenceId || payment.cashfreeTransferId || payment.failureReason || "-"}</td>
                </tr>
              )) : (
                <tr><td colSpan={6}>No paid extra incentives yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </FacultyPortalLayout>
  );
}
