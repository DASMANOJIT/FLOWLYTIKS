"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { apiFetch, readApiResponse } from "../../../lib/api.js";
import { getAuthToken } from "../../../lib/authStorage.js";
import { fadeUpItem, staggerContainer } from "../motion/primitives.jsx";
import styles from "./AdminDashboardSummary.module.css";

const months = ["March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February"];
const currentPeriod = () => {
  const parts = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).formatToParts(new Date());
  const month = parts.find(part => part.type === "month").value;
  const year = Number(parts.find(part => part.type === "year").value);
  return { month, academicYear: year - (["January", "February"].includes(month) ? 1 : 0) };
};
const currency = value => `₹${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function AdminDashboardSummary({ onSummary }) {
  const [period, setPeriod] = useState(currentPeriod);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError(""); setSummary(null); onSummary(null);
      try {
        const response = await apiFetch(`/api/admin/dashboard-summary?${new URLSearchParams(period)}`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
        const result = await readApiResponse(response, "Dashboard summary could not load.");
        if (!result.ok) throw new Error(result.error);
        if (!controller.signal.aborted) { setSummary(result.data); onSummary(result.data); }
      } catch (error) {
        if (!controller.signal.aborted) setError(error.message || "Dashboard summary could not load.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [period, refresh, onSummary]);
  const calendarYear = Number(period.academicYear) + (["January", "February"].includes(period.month) ? 1 : 0);
  const cards = [
    ["Total Students", summary?.totalStudents], ["Active Faculty", summary?.totalFaculties], ["Total Staff", summary?.totalStaff],
    ["Paid Students", summary?.paidStudents], ["Unpaid Students", summary?.unpaidStudents], ["Total Payment Received", summary?.paymentReceived, true],
    ["Total Outstanding Faculty Bill for the Week", summary?.week.outstanding, true, true],
    ["Total Individual Extra Incentives", summary?.week.extraIncentives, true, true],
  ];
  return <section className={styles.root} aria-label="Admin dashboard summary" aria-busy={loading}>
    <div className={styles.filters}><div className={styles.field}><label htmlFor="admin-summary-month">Fee month</label><select id="admin-summary-month" value={period.month} onChange={event => setPeriod(current => ({ ...current, month: event.target.value }))}>{months.map(month => <option key={month}>{month}</option>)}</select></div><div className={styles.field}><label htmlFor="admin-summary-year">Academic session start year</label><input id="admin-summary-year" type="number" min="2000" max="2100" value={period.academicYear} onChange={event => setPeriod(current => ({ ...current, academicYear: event.target.value }))} /></div><button onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={17} />Refresh</button></div>
    <p className={styles.period}>{period.month} {calendarYear} · Academic session {period.academicYear}-{Number(period.academicYear) + 1}</p>
    {loading && <p role="status">Loading dashboard summary...</p>}{error && <p className={styles.error} role="alert">{error}</p>}
    <motion.div className={`monthly-summary ${styles.grid}`} variants={staggerContainer} initial="hidden" animate="visible">{cards.map(([label, value, money, weekly]) => <motion.div key={label} className={`summary-box ${styles.card}`} variants={fadeUpItem}><h3>{label}</h3><p>{value === undefined || value === null ? "—" : money ? currency(value) : value}</p>{weekly && summary && <small>{summary.week.start} – {summary.week.end}{label === "Total Individual Extra Incentives" && <><br />Recorded this week; separate from payroll</>}</small>}</motion.div>)}</motion.div>
  </section>;
}
