"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../../../../lib/api.js";
import { getAuthToken } from "../../../../lib/authStorage.js";
import "../faculty/faculty.css";

export default function FacultyPayoutsPage() {
  const router = useRouter();
  const token = useMemo(() => getAuthToken(), []);
  const [payouts, setPayouts] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return void router.push("/login");
    setLoading(true);
    setError("");
    try {
      const data = await apiCall(`/admin/faculty/payouts`, "GET", null, token);
      setPayouts(data.payouts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payouts.");
    } finally {
      setLoading(false);
    }
  }, [router, token]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));

  const payNow = useCallback(async (id) => {
    setLoading(true);
    setError("");
    try {
      if (id) {
        await apiCall(`/admin/faculty/payouts/${id}/initiate`, "POST", null, token);
      } else {
        const ids = Object.keys(selected).filter((k) => selected[k]);
        for (const pid of ids) {
          // sequential to avoid overloading gateway; keep simple and safe for production
          // call sequentially
          await apiCall(`/admin/faculty/payouts/${pid}/initiate`, "POST", null, token);
        }
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initiate payout.");
    } finally {
      setLoading(false);
    }
  }, [selected, token, load]);

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <h1>Faculty Payouts</h1>
        </header>

        <section className="faculty-panel">
          {error ? <p className="faculty-toast--error">{error}</p> : null}
          <div style={{ marginBottom: 12 }}>
            <button className="faculty-button faculty-button--primary" onClick={() => void payNow()} disabled={loading}>Pay Selected</button>
          </div>
          <div className="faculty-table-wrap">
            <table className="faculty-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Faculty</th>
                  <th>Payroll Week</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Paid At</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payouts.length ? payouts.map((p) => (
                  <tr key={p.id}>
                    <td><input type="checkbox" checked={!!selected[p.id]} onChange={() => toggle(p.id)} /></td>
                    <td>{(p.faculty && p.faculty.fullName) || '-'}</td>
                    <td>{(p.payroll && p.payroll.payrollCycle && p.payroll.payrollCycle.cycleNumber) || '-'}</td>
                    <td>{Number(p.amount).toFixed(0)}</td>
                    <td>{p.paymentMethod || '-'}</td>
                    <td>{p.status}</td>
                    <td>{new Date(p.createdAt).toISOString().slice(0, 10)}</td>
                    <td>{p.paidAt ? new Date(p.paidAt).toISOString().slice(0, 10) : '-'}</td>
                    <td>
                      <button className="faculty-button faculty-button--ghost" onClick={() => void payNow(p.id)} disabled={loading || p.status !== 'PENDING'}>Pay Now</button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={9}>{loading ? 'Loading...' : 'No payouts available.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
