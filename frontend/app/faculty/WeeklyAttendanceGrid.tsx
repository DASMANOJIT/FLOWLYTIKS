"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import "./attendance/daily-attendance.css";

type AttendanceRecord = { id: string; shift: string; amount: number; updatedAt?: string; updatedByName?: string; updatedByRole?: string };
type Shift = "MORNING" | "EVENING";
type AttendanceRow = { date: string; dayName: string; attendance: { present: boolean; amount: number; defaultAmount: number; legacy?: boolean; shifts: Record<Shift, { present: boolean; amount: number }>; records: AttendanceRecord[] } };
const shifts: Shift[] = ["MORNING", "EVENING"];
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
  const toggle = async (row: AttendanceRow, shift: Shift) => {
    if (pending.current || isLocked) return;
    pending.current = true;
    setSaving(`${row.date}:${shift}`);
    setMessage(null);
    try {
      const res = await fetch("/api/faculty/attendance/week", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date: row.date, shift, present: !row.attendance.shifts[shift].present }),
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
          <thead><tr><th>Date</th><th>Day</th><th>Morning</th><th>Evening</th><th>Daily Total</th><th>Last Updated</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6}><PremiumLoader label="Loading attendance" compact /></td></tr> : rows.length ? rows.map(row => (
              <tr key={row.date}>
                <td>{row.date}</td><td>{row.dayName}</td>
                {shifts.map(shift => {
                  const cell = row.attendance.shifts?.[shift] || { present: false, amount: 0 };
                  const label = shift === "MORNING" ? "Morning" : "Evening";
                  return <td key={shift} data-label={label}><button className={`faculty-shift-btn ${cell.present ? "present" : "absent"}`} disabled={loading || isLocked || !!saving || row.attendance.legacy} onClick={() => void toggle(row, shift)} aria-label={`Mark ${row.date} ${label} ${cell.present ? "absent" : "present"}`} aria-pressed={cell.present}>{saving === `${row.date}:${shift}` ? "Saving..." : cell.present ? "Present" : "Absent"}</button><small className="faculty-shift-meta">{money(cell.amount)}{!cell.present && !row.attendance.legacy ? ` · Rate ${money(row.attendance.defaultAmount)}` : ""}</small></td>;
                })}
                <td data-label="Daily Total">{money(row.attendance.amount)}
                  {row.attendance.legacy ? <small className="faculty-shift-meta">Historical entries retained: {row.attendance.records.map(record => `${record.shift.toLowerCase()} ${money(record.amount)}`).join(", ")}. Shift changes require Admin review.</small> : null}</td>
                <td data-label="Last Updated">{row.attendance.records.map(record => <small className="faculty-shift-meta" key={record.id}>{record.shift.toLowerCase()}: {record.updatedAt ? timestamp(record.updatedAt) : "-"}<br />By: {record.updatedByName || "-"}{record.updatedByRole === "ADMIN" ? " (Admin)" : ""}</small>)}</td>
              </tr>
            )) : <tr><td colSpan={6}>{loadError ? "Attendance could not be loaded. Please refresh to retry." : "No attendance records for this week."}</td></tr>}
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
