"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { apiCall } from "../../../lib/api.js";
import { getFacultyAuthToken } from "../../../lib/authStorage.js";
import PremiumLoader from "../../components/ui/PremiumLoader";
import FacultyPortalLayout from "../FacultyPortalLayout";
import "../../admin/faculty/faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type IncentiveType = { id: string; name: string; rate: number };
type IncentiveLine = { incentiveTypeId: string; name: string; quantity: number; rate: number; amount: number };
type IncentiveEntry = { id: string; name: string; quantityChange: number; rate: number; amount: number; status: string; createdAt: string };
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

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);

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

  const adjust = async (typeId: string, action: "increment" | "decrement") => {
    if (!token || busyId) return;
    setBusyId(`${typeId}:${action}`);
    setError("");
    try {
      await callApi(`/faculty-extra-incentives/my/${typeId}/${action}`, "POST", {}, token);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update incentive count.");
    } finally {
      setBusyId("");
    }
  };

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
            <p>Use plus or minus to adjust your own pending count.</p>
          </div>
        </div>
        <div className="faculty-table-wrap">
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
                      <button className="faculty-icon-button" onClick={() => adjust(type.id, "decrement")} disabled={!pending?.quantity || Boolean(busyId)} title="Decrease">
                        <Minus size={16} />
                      </button>
                      <button className="faculty-icon-button" onClick={() => adjust(type.id, "increment")} disabled={Boolean(busyId)} title="Increase">
                        <Plus size={16} />
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
      </section>

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
