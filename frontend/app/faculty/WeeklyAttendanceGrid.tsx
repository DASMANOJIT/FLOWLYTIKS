"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import "./attendance/daily-attendance.css";

type AttendanceRecord = { id: string; shift: string; amount: number; updatedAt?: string; updatedByName?: string; updatedByRole?: string };
type AttendanceRow = { date: string; dayName: string; attendance: { present: boolean; amount: number; defaultAmount: number; legacy?: boolean; records: AttendanceRecord[] } };
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; };
const currentWeek = () => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const date = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  return dateKey(addDays(date, -(date.getUTCDay() + 2) % 7));
};
const timestamp = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default function WeeklyAttendanceGrid({ token, onAttendanceUpdated }: { token: string; onAttendanceUpdated?: () => void }) {
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [weekLabel, setWeekLabel] = useState("");
  const [deadline, setDeadline] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState("");
  const pending = useRef(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/faculty/attendance/week?weekStart=${weekStart}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || "Failed to load attendance.");
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setWeekLabel(`${json.weekStart} to ${json.weekEnd}`);
      setDeadline(json.editDeadline || "");
      setIsLocked(Boolean(json.isLocked));
      setLockReason(json.lockReason || "");
      setLoadError(false);
      return true;
    } catch (error) {
      setRows([]);
      setLoadError(true);
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load attendance." });
      return false;
    } finally { setLoading(false); }
  }, [token, weekStart]);

  useEffect(() => { if (token) { setMessage(null); void load(); } }, [load, token]);
  const toggle = async (row: AttendanceRow) => {
    if (pending.current || isLocked) return;
    pending.current = true;
    setSaving(row.date);
    setMessage(null);
    try {
      const res = await fetch("/api/faculty/attendance/week", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date: row.date, present: !row.attendance.present }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 403) await load();
        throw new Error(json.message || "Failed to update attendance.");
      }
      const reloaded = await load();
      onAttendanceUpdated?.();
      if (reloaded) setMessage({ type: "success", text: "Attendance updated successfully." });
      else setMessage({ type: "error", text: "Attendance was saved, but the updated week could not be loaded. Please refresh." });
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to update attendance." }); }
    finally { pending.current = false; setSaving(""); }
  };

  return (
    <section className="faculty-table-card daily-attendance-card">
      <div className="faculty-header faculty-header--compact">
        <div className="faculty-title-block"><h2>Weekly Attendance</h2><p>{weekLabel || "Friday to Thursday"}</p></div>
        <div className="ledger-nav">
          <button className="faculty-button faculty-button--ghost" disabled={!!saving} onClick={() => setWeekStart(dateKey(addDays(new Date(weekStart + "T00:00:00Z"), -7)))}>Previous Week</button>
          <button className="faculty-button faculty-button--ghost" disabled={!!saving} onClick={() => setWeekStart(currentWeek())}>Current Week</button>
          <button className="faculty-button faculty-button--ghost" disabled={!!saving} onClick={() => setWeekStart(dateKey(addDays(new Date(weekStart + "T00:00:00Z"), 7)))}>Next Week</button>
        </div>
      </div>
      {deadline ? <p>Faculty edit deadline: {timestamp(deadline)} IST (before noon).</p> : null}
      {message ? <div className={`faculty-toast--${message.type}`}>{message.text}</div> : null}
      {isLocked ? <div className="faculty-toast--error">{lockReason || "This week is locked for attendance editing."}</div> : null}
      <div className="faculty-table-wrap">
        <table className="faculty-table">
          <thead><tr><th>Date</th><th>Day</th><th>Attendance</th><th>Recorded Amount</th><th>Last Updated</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5}><PremiumLoader label="Loading attendance" compact /></td></tr> : rows.length ? rows.map(row => (
              <tr key={row.date}>
                <td>{row.date}</td><td>{row.dayName}</td>
                <td><button className={`faculty-shift-btn ${row.attendance.present ? "present" : "absent"}`} disabled={loading || isLocked || !!saving} onClick={() => void toggle(row)} aria-label={`Mark ${row.date} ${row.attendance.present ? "absent" : "present"}`}>{saving === row.date ? "Saving..." : row.attendance.present ? "Present" : "Absent"}</button></td>
                <td>{money(row.attendance.amount)}{!row.attendance.present ? <small className="faculty-shift-meta">Daily rate: {money(row.attendance.defaultAmount)}</small> : null}
                  {row.attendance.legacy ? <small className="faculty-shift-meta">Historical entries retained: {row.attendance.records.map(record => `${record.shift.toLowerCase()} ${money(record.amount)}`).join(", ")}</small> : null}</td>
                <td>{row.attendance.records.map(record => <small className="faculty-shift-meta" key={record.id}>{record.updatedAt ? timestamp(record.updatedAt) : "-"}<br />By: {record.updatedByName || "-"}{record.updatedByRole === "ADMIN" ? " (Admin)" : ""}</small>)}</td>
              </tr>
            )) : <tr><td colSpan={5}>{loadError ? "Attendance could not be loaded. Please refresh to retry." : "No attendance records for this week."}</td></tr>}
          </tbody>
        </table>
      </div>
      {!loading && !loadError ? <div className="faculty-weekly-total-card">
        <div><span>Weekly Total Amount</span><strong>{money(rows.reduce((total, row) => total + row.attendance.amount, 0))}</strong></div>
        <div><span>Present Days</span><strong>{rows.filter(row => row.attendance.present).length}</strong></div>
        <div><span>Week Period</span><strong>{weekLabel || "-"}</strong></div>
      </div> : null}
    </section>
  );
}
