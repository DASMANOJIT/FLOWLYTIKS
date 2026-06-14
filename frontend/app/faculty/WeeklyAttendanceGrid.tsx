"use client";

import { useCallback, useEffect, useState } from "react";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";

type AttendanceRow = {
  date: string;
  dayName: string;
  shifts: Record<string, {
    present: boolean;
    id?: string;
    amount: number;
    updatedAt?: string | null;
    updatedByName?: string | null;
    updatedByRole?: string | null;
  }>;
  dailyTotal: number;
};

const shifts = ["MORNING", "AFTERNOON", "EVENING"] as const;

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getFridayWeekStart = () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const delta = (today.getUTCDay() - 5 + 7) % 7;
  return addDays(today, -delta);
};

export default function WeeklyAttendanceGrid({
  token,
  onAttendanceUpdated,
}: {
  token: string;
  onAttendanceUpdated?: () => void;
}) {
  const [weekStart, setWeekStart] = useState(toDateKey(getFridayWeekStart()));
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [weekLabel, setWeekLabel] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [savingCell, setSavingCell] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/faculty/attendance/week?weekStart=${weekStart}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || "Failed to load attendance.");
      const nextRows = Array.isArray(json.rows) ? json.rows : [];
      setRows(nextRows);
      const nextDrafts: Record<string, string> = {};
      nextRows.forEach((row: AttendanceRow) => {
        shifts.forEach((shift) => {
          const key = `${row.date}_${shift}`;
          nextDrafts[key] = String(row.shifts?.[shift]?.amount || 0);
        });
      });
      setAmountDrafts(nextDrafts);
      setWeekLabel(`${json.weekStart || weekStart} to ${json.weekEnd || ""}`);
      setIsLocked(Boolean(json.isLocked));
      setLockReason(json.lockReason || "");
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to load attendance." });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, weekStart]);

  useEffect(() => {
    if (token) void load();
  }, [load, token]);

  const toggle = async (date: string, shift: string, present: boolean) => {
    setMessage(null);
    const cellKey = `${date}_${shift}`;
    setSavingCell(cellKey);
    try {
      const amount = Math.max(0, Number(amountDrafts[cellKey] || 0) || 0);
      const res = await fetch("/api/faculty/attendance/week", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date, shift, present, amount }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || "Failed to update attendance.");
      await load();
      onAttendanceUpdated?.();
      setMessage({ type: "success", text: "Attendance updated successfully." });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to update attendance." });
    } finally {
      setSavingCell("");
    }
  };

  const formatUpdatedAt = (value?: string | null) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  };

  const getDraftAmount = (date: string, shift: string) => {
    const value = Number(amountDrafts[`${date}_${shift}`] || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  };

  const getDailyTotal = (row: AttendanceRow) =>
    shifts.reduce((total, shift) => {
      const cell = row.shifts[shift] || { present: false };
      return total + (cell.present ? getDraftAmount(row.date, shift) : 0);
    }, 0);

  const weeklyTotal = rows.reduce((total, row) => total + getDailyTotal(row), 0);
  const totalPresentEntries = rows.reduce(
    (total, row) => total + shifts.filter((shift) => row.shifts[shift]?.present).length,
    0
  );

  return (
    <section className="faculty-table-card">
      <div className="faculty-header faculty-header--compact">
        <div className="faculty-title-block">
          <h2>Weekly Attendance</h2>
          <p>{weekLabel || "Friday to Thursday"}</p>
        </div>
        <div className="ledger-nav">
          <button className="faculty-button faculty-button--ghost" onClick={() => setWeekStart(toDateKey(addDays(new Date(`${weekStart}T00:00:00.000Z`), -7)))}>
            Previous Week
          </button>
          <button className="faculty-button faculty-button--ghost" onClick={() => setWeekStart(toDateKey(getFridayWeekStart()))}>
            Current Week
          </button>
          <button className="faculty-button faculty-button--ghost" onClick={() => setWeekStart(toDateKey(addDays(new Date(`${weekStart}T00:00:00.000Z`), 7)))}>
            Next Week
          </button>
        </div>
      </div>
      {message ? <div className={`faculty-toast--${message.type}`}>{message.text}</div> : null}
      {isLocked ? <div className="faculty-toast--error">{lockReason || "This week is locked for attendance editing."}</div> : null}
      <div className="faculty-table-wrap">
        <table className="faculty-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Day</th>
              <th>Morning Shift</th>
              <th>Afternoon Shift</th>
              <th>Evening Shift</th>
              <th>Daily Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6}><PremiumLoader label="Loading attendance" compact /></td></tr>
            ) : rows.length ? rows.map((row) => (
              <tr key={row.date}>
                <td>{row.date}</td>
                <td>{row.dayName}</td>
                {shifts.map((shift) => {
                  const cell = row.shifts[shift] || { present: false, amount: 0 };
                  const cellKey = `${row.date}_${shift}`;
                  const disabled = loading || isLocked || savingCell === cellKey;
                  return (
                    <td key={`${row.date}-${shift}`}>
                      <button
                        className={`faculty-shift-btn ${cell.present ? "present" : "absent"}`}
                        onClick={() => toggle(row.date, shift, !cell.present)}
                        disabled={disabled}
                        title="Update attendance"
                      >
                        {cell.present ? "Present" : "Absent"}
                      </button>
                      <input
                        className="faculty-shift-amount-input"
                        type="number"
                        min="0"
                        step="1"
                        value={amountDrafts[cellKey] || ""}
                        onChange={(event) => setAmountDrafts((current) => ({ ...current, [cellKey]: event.target.value }))}
                        disabled={disabled || !cell.present}
                        aria-label={`${shift} amount for ${row.date}`}
                      />
                      <button
                        className="faculty-button faculty-button--ghost faculty-shift-save"
                        onClick={() => toggle(row.date, shift, true)}
                        disabled={disabled || !cell.present}
                      >
                        {savingCell === cellKey ? "Saving..." : "Save"}
                      </button>
                      <small className="faculty-shift-meta">
                        Updated: {formatUpdatedAt(cell.updatedAt)}<br />
                        By: {cell.updatedByName || "-"}
                      </small>
                    </td>
                  );
                })}
                <td>{money(getDailyTotal(row))}</td>
              </tr>
            )) : (
              <tr><td colSpan={6}>No attendance records for this week.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="faculty-weekly-total-card">
        <div>
          <span>Weekly Total Amount</span>
          <strong>{money(weeklyTotal)}</strong>
        </div>
        <div>
          <span>Total Present Entries</span>
          <strong>{totalPresentEntries}</strong>
        </div>
        <div>
          <span>Week Period</span>
          <strong>{weekLabel || "-"}</strong>
        </div>
      </div>
    </section>
  );
}
