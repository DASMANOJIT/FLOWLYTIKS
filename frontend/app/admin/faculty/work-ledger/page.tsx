"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  MessageSquare,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import { getAuthRole, getAuthToken, getAuthUserId } from "../../../../lib/authStorage.js";
import { apiCall } from "../../../../lib/api.js";
import "../faculty.css";

type Shift = "MORNING" | "AFTERNOON" | "EVENING";
type Toast = { type: "success" | "error"; message: string } | null;

type FacultyOption = {
  id: string;
  facultyId: string;
  fullName: string;
};

type LedgerEntry = {
  id: string;
  facultyId: string;
  date: string;
  shift: Shift;
  amount: number;
  remarks: string | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  faculty: FacultyOption & { designation?: string | null };
};

type LedgerSummary = {
  rangeStart: string;
  rangeEnd: string;
  totalEntries: number;
  totalAmount: number;
  totalFacultyParticipated: number;
  currentWeekTotal: number;
  topFaculty: FacultyTotal[];
  facultyTotals: FacultyTotal[];
};

type FacultyTotal = {
  facultyId: string;
  facultyName: string;
  weeklyTotal: number;
  monthlyTotal: number;
  totalAmount: number;
  entries: number;
};

type EntryForm = {
  facultyId: string;
  date: string;
  shift: Shift;
  amount: string;
  remarks: string;
};

type ApiCall = <T = unknown>(
  endpoint: string,
  method?: string,
  body?: unknown,
  token?: string | null
) => Promise<T>;

const callApi = apiCall as ApiCall;

type FacultyListResponse = {
  faculty?: FacultyOption[];
};

type LedgerListResponse = {
  entries?: LedgerEntry[];
  summary?: LedgerSummary;
};

type AttendanceCell = {
  present: boolean;
  id?: string;
  amount: number;
};

type AttendanceGridRow = {
  id: string;
  facultyId: string;
  fullName: string;
  canEdit: boolean;
  weeklyTotal: number;
  shifts: Record<string, AttendanceCell>;
};

type AttendanceGridResponse = {
  days?: string[];
  grid?: AttendanceGridRow[];
};

const shifts: Array<{ value: Shift; label: string }> = [
  { value: "MORNING", label: "Morning" },
  { value: "AFTERNOON", label: "Afternoon" },
  { value: "EVENING", label: "Evening" },
];

const dayLabels = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const parseDateKey = (value: string) => new Date(`${value}T00:00:00.000Z`);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getFridayWeekStart = (value = new Date()) => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  const daysSinceFriday = (date.getUTCDay() + 2) % 7;
  return addDays(date, -daysSinceFriday);
};

const formatDisplayDate = (dateKey: string) =>
  parseDateKey(dateKey).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);

const emptySummary: LedgerSummary = {
  rangeStart: "",
  rangeEnd: "",
  totalEntries: 0,
  totalAmount: 0,
  totalFacultyParticipated: 0,
  currentWeekTotal: 0,
  topFaculty: [],
  facultyTotals: [],
};

export default function FacultyWorkLedgerPage() {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => getFridayWeekStart());
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [attendanceGrid, setAttendanceGrid] = useState<AttendanceGridRow[]>([]);
  const [attendanceDays, setAttendanceDays] = useState<string[]>([]);
  const [faculty, setFaculty] = useState<FacultyOption[]>([]);
  const [summary, setSummary] = useState<LedgerSummary>(emptySummary);
  const [search, setSearch] = useState("");
  const [facultyFilter, setFacultyFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [mode, setMode] = useState<"week" | "custom" | "month">("week");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LedgerEntry | null>(null);
  const [form, setForm] = useState<EntryForm>({
    facultyId: "",
    date: toDateKey(weekStart),
    shift: "MORNING",
    amount: "",
    remarks: "",
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => toDateKey(addDays(weekStart, index))),
    [weekStart]
  );
  const weekEnd = weekDates[6];

  const showToast = useCallback((nextToast: Toast) => {
    setToast(nextToast);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadFaculty = useCallback(async () => {
    if (!token) return;
    try {
      const data = await callApi<FacultyListResponse>(
        "/faculty?page=1&limit=100",
        "GET",
        null,
        token
      );
      setFaculty(Array.isArray(data.faculty) ? data.faculty : []);
    } catch {
      setFaculty(
        role === "faculty" && userId
          ? [{ id: userId, facultyId: userId, fullName: "My Faculty Record" }]
          : []
      );
    }
  }, [role, token, userId]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      facultyId: facultyFilter,
      shift: shiftFilter,
      search,
      limit: "1000",
    });
    if (mode === "month" && monthFilter) {
      params.set("month", monthFilter);
    } else if (mode === "custom" && startDate && endDate) {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    } else {
      params.set("week", toDateKey(weekStart));
    }
    return params.toString();
  }, [endDate, facultyFilter, mode, monthFilter, search, shiftFilter, startDate, weekStart]);

  const loadEntries = useCallback(async () => {
    if (!token) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await callApi<LedgerListResponse>(
        `/work-ledger?${queryString}`,
        "GET",
        null,
        token
      );
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setSummary(data.summary || emptySummary);
      if (mode === "week") {
        try {
          const gridData = await callApi<AttendanceGridResponse>(
            `/faculty/attendance?weekStart=${toDateKey(weekStart)}`,
            "GET",
            null,
            token
          );
          setAttendanceGrid(Array.isArray(gridData.grid) ? gridData.grid : []);
          setAttendanceDays(Array.isArray(gridData.days) ? gridData.days : weekDates);
        } catch {
          setAttendanceGrid([]);
          setAttendanceDays(weekDates);
        }
      } else {
        setAttendanceGrid([]);
        setAttendanceDays([]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load work ledger.");
    } finally {
      setLoading(false);
    }
  }, [mode, queryString, token, weekDates, weekStart]);

  useEffect(() => {
    // Read auth info only on client after mount to avoid hydration mismatch
    setHasMounted(true);
    const storedToken = getAuthToken();
    const storedRole = getAuthRole();
    setToken(storedToken);
    setRole(storedRole);
    setIsAdmin(storedRole === "admin");
    setUserId(getAuthUserId());
  }, []);

  useEffect(() => {
    if (!hasMounted) return;
    loadFaculty();
  }, [hasMounted, loadFaculty]);

  useEffect(() => {
    if (!hasMounted || !token) return;
    loadEntries();
  }, [hasMounted, token, loadEntries]);

  const entriesByCell = useMemo(() => {
    const map = new Map<string, LedgerEntry[]>();
    for (const entry of entries) {
      const key = `${entry.date}:${entry.shift}`;
      const current = map.get(key) || [];
      current.push(entry);
      map.set(key, current);
    }
    return map;
  }, [entries]);

  const facultyOptions = useMemo(() => {
    const map = new Map<string, FacultyOption>();
    for (const item of faculty) {
      map.set(item.id, item);
    }
    for (const entry of entries) {
      if (entry.faculty && !map.has(entry.faculty.id)) {
        map.set(entry.faculty.id, entry.faculty);
      }
    }
    return [...map.values()].sort((left, right) =>
      left.fullName.localeCompare(right.fullName)
    );
  }, [entries, faculty]);

  const openCreateModal = (date: string, shift: Shift) => {
    setEditingEntry(null);
    setForm({
      facultyId: role === "faculty" ? String(userId || "") : "",
      date,
      shift,
      amount: "",
      remarks: "",
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (entry: LedgerEntry) => {
    setEditingEntry(entry);
    setForm({
      facultyId: entry.facultyId,
      date: entry.date,
      shift: entry.shift,
      amount: String(entry.amount),
      remarks: entry.remarks || "",
    });
    setFormErrors({});
    setModalOpen(true);
  };

  const canEditEntry = (entry: LedgerEntry) =>
    isAdmin || (role === "faculty" && String(entry.facultyId) === String(userId));

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.facultyId) nextErrors.facultyId = "Faculty member is required.";
    if (!form.date) nextErrors.date = "Date is required.";
    if (!form.shift) nextErrors.shift = "Shift is required.";
    if (!form.amount || Number(form.amount) <= 0) nextErrors.amount = "Amount is required.";
    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateForm() || !token) return;
    setSubmitting(true);
    try {
      const endpoint = editingEntry ? `/work-ledger/${editingEntry.id}` : "/work-ledger";
      const method = editingEntry ? "PUT" : "POST";
      await callApi(
        endpoint,
        method,
        {
          facultyId: form.facultyId,
          date: form.date,
          shift: form.shift,
          amount: Number(form.amount),
          remarks: form.remarks,
        },
        token
      );
      setModalOpen(false);
      showToast({
        type: "success",
        message: editingEntry ? "Ledger entry updated." : "Ledger entry saved.",
      });
      await loadEntries();
    } catch (submitError) {
      showToast({
        type: "error",
        message: submitError instanceof Error ? submitError.message : "Failed to save entry.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const deleteEntry = async () => {
    if (!editingEntry || !token) return;
    setSubmitting(true);
    try {
      await callApi(`/work-ledger/${editingEntry.id}`, "DELETE", null, token);
      setModalOpen(false);
      showToast({ type: "success", message: "Ledger entry deleted." });
      await loadEntries();
    } catch (deleteError) {
      showToast({
        type: "error",
        message: deleteError instanceof Error ? deleteError.message : "Failed to delete entry.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleAttendanceCell = async (
    row: AttendanceGridRow,
    date: string,
    shift: Shift,
    present: boolean
  ) => {
    if (!token || !row.canEdit) return;
    try {
      await callApi(
        "/faculty/attendance",
        "PATCH",
        {
          facultyId: row.id,
          date,
          shift,
          present,
        },
        token
      );
      showToast({ type: "success", message: present ? "Attendance marked present." : "Attendance cleared." });
      await loadEntries();
    } catch (updateError) {
      showToast({
        type: "error",
        message: updateError instanceof Error ? updateError.message : "Failed to update attendance.",
      });
    }
  };

  const setCurrentWeek = () => {
    setMode("week");
    setWeekStart(getFridayWeekStart());
  };

  const setTodayFilter = () => {
    const today = toDateKey(new Date());
    setMode("custom");
    setStartDate(today);
    setEndDate(today);
  };

  const setCurrentMonth = () => {
    setMode("month");
    setMonthFilter(monthKey());
  };

  const exportCsv = async () => {
    if (!isAdmin || !token) return;
    try {
      const response = await fetch(`/api/work-ledger/export.csv?${queryString}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error("Failed to export CSV.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `faculty-work-ledger-${Date.now()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (exportError) {
      showToast({
        type: "error",
        message: exportError instanceof Error ? exportError.message : "Failed to export CSV.",
      });
    }
  };

  const exportXlsx = () => {
    if (!isAdmin) return;
    const rows = entries.map((entry) => ({
      Date: entry.date,
      Shift: entry.shift,
      "Faculty ID": entry.faculty?.facultyId || "",
      "Faculty Name": entry.faculty?.fullName || "",
      Amount: entry.amount,
      Remarks: entry.remarks || "",
      "Created By": entry.createdBy,
      "Updated By": entry.updatedBy || "",
      "Created At": entry.createdAt,
      "Updated At": entry.updatedAt,
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Work Ledger");
    XLSX.writeFile(workbook, `faculty-work-ledger-${Date.now()}.xlsx`);
  };

  const displayedDates =
    mode === "week"
      ? weekDates
      : Array.from(new Set(entries.map((entry) => entry.date))).sort();

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <button className="faculty-button faculty-button--ghost" onClick={() => router.back()}>
            <ArrowLeft size={18} />
            Back
          </button>
          <div className="faculty-title-block">
            <h1>Faculty Work Ledger</h1>
            <p>Transparent shift-wise work entries for future payout automation.</p>
          </div>
          <Link className="faculty-button faculty-button--ghost" href="/admin/faculty">
            Faculty List
          </Link>
        </header>

        <section className="faculty-panel">
          <div className="ledger-weekbar">
            <div>
              <h2>
                Week: {formatDisplayDate(toDateKey(weekStart))} to {formatDisplayDate(weekEnd)}
              </h2>
            </div>
            <div className="ledger-weekbar__actions">
              <button className="faculty-button faculty-button--ghost" onClick={() => { setMode("week"); setWeekStart(addDays(weekStart, -7)); }}>
                <ChevronLeft size={17} />
                Previous Week
              </button>
              <button className="faculty-button faculty-button--soft" onClick={setCurrentWeek}>
                <CalendarDays size={17} />
                Current Week
              </button>
              <button className="faculty-button faculty-button--ghost" onClick={() => { setMode("week"); setWeekStart(addDays(weekStart, 7)); }}>
                Next Week
                <ChevronRight size={17} />
              </button>
            </div>
          </div>

          <div className="ledger-summary">
            <SummaryCard label="Total Entries" value={summary.totalEntries} />
            <SummaryCard label="Total Amount Recorded" value={money(summary.totalAmount)} />
            <SummaryCard label="Total Faculty Participated" value={summary.totalFacultyParticipated} />
            <SummaryCard label="Current Week Total" value={money(summary.currentWeekTotal)} />
          </div>

          <div className="faculty-toolbar">
            <div className="faculty-field">
              <label>Search by Faculty Name</label>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Faculty name" />
            </div>
            <div className="faculty-field">
              <label>Faculty</label>
              <select value={facultyFilter} onChange={(event) => setFacultyFilter(event.target.value)}>
                <option value="all">All faculty</option>
                {facultyOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="faculty-field">
              <label>Shift</label>
              <select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)}>
                <option value="all">All shifts</option>
                {shifts.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="faculty-field">
              <label>Month</label>
              <input
                type="month"
                value={monthFilter}
                onChange={(event) => {
                  setMonthFilter(event.target.value);
                  setMode(event.target.value ? "month" : "week");
                }}
              />
            </div>
            <div className="faculty-field">
              <label>Date Range Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  setMode("custom");
                }}
              />
            </div>
            <div className="faculty-field">
              <label>Date Range End</label>
              <input
                type="date"
                value={endDate}
                onChange={(event) => {
                  setEndDate(event.target.value);
                  setMode("custom");
                }}
              />
            </div>
            <div className="faculty-field">
              <label>Quick Filters</label>
              <div className="ledger-quick-filters">
                <button className="faculty-button faculty-button--ghost" onClick={setTodayFilter}>
                  Today
                </button>
                <button className="faculty-button faculty-button--ghost" onClick={setCurrentWeek}>
                  Current Week
                </button>
                <button className="faculty-button faculty-button--ghost" onClick={setCurrentMonth}>
                  Current Month
                </button>
              </div>
            </div>
            {hasMounted && isAdmin ? (
              <div className="faculty-field">
                <label>Export</label>
                <div className="ledger-export-actions">
                  <button className="faculty-button faculty-button--soft" onClick={exportCsv}>
                    <Download size={16} />
                    CSV
                  </button>
                  <button className="faculty-button faculty-button--soft" onClick={exportXlsx}>
                    <FileSpreadsheet size={16} />
                    XLSX
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <div className="ledger-layout">
          <section className="faculty-panel ledger-grid-panel">
            {loading ? (
              <div className="faculty-loading">Loading work ledger...</div>
            ) : error ? (
              <div className="faculty-error">{error}</div>
            ) : mode === "week" ? (
              <div className="ledger-grid-scroll">
                <table className="ledger-grid ledger-attendance-grid">
                  <thead>
                    <tr>
                      <th className="ledger-date-col" rowSpan={2}>
                        Faculty
                      </th>
                      {(attendanceDays.length ? attendanceDays : weekDates).map((dateKey, index) => (
                        <th key={dateKey} colSpan={3}>
                          {dayLabels[index]}
                          <span>{formatDisplayDate(dateKey)}</span>
                        </th>
                      ))}
                      <th rowSpan={2}>Weekly Total</th>
                    </tr>
                    <tr>
                      {(attendanceDays.length ? attendanceDays : weekDates).flatMap((dateKey) =>
                        shifts.map((shift) => <th key={`${dateKey}-${shift.value}`}>{shift.label}</th>)
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceGrid.length ? (
                      attendanceGrid.map((row) => (
                        <tr key={row.id}>
                          <td className="ledger-date-col">
                            <strong>{row.fullName}</strong>
                            <small>{row.facultyId}</small>
                          </td>
                          {(attendanceDays.length ? attendanceDays : weekDates).flatMap((dateKey) =>
                            shifts.map((shift) => {
                              const key = `${dateKey}_${shift.value}`;
                              const cell = row.shifts[key] || { present: false, amount: 0 };
                              return (
                                <td key={`${row.id}-${key}`} className="ledger-cell ledger-attendance-cell">
                                  <button
                                    className={`faculty-shift-btn ${cell.present ? "present" : "absent"}`}
                                    disabled={!row.canEdit}
                                    title={row.canEdit ? "Update attendance" : "Read-only"}
                                    onClick={() => toggleAttendanceCell(row, dateKey, shift.value, !cell.present)}
                                  >
                                    {cell.present ? "Present" : "Absent"}
                                    <small>{cell.present ? money(cell.amount || 0) : money(0)}</small>
                                  </button>
                                </td>
                              );
                            })
                          )}
                          <td>{money(row.weeklyTotal || 0)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={23}>No active faculty records found for this week.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={22}>Overall Weekly Total</td>
                      <td>{money(summary.currentWeekTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : displayedDates.length === 0 ? (
              <div className="faculty-empty">No ledger entries found for the selected filters.</div>
            ) : (
              <div className="ledger-grid-scroll">
                <table className="ledger-grid">
                  <thead>
                    <tr>
                      <th className="ledger-date-col" rowSpan={2}>
                        Date
                      </th>
                      {dayLabels.map((day) => (
                        <th key={day} colSpan={3}>
                          {day}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {dayLabels.flatMap((day) =>
                        shifts.map((shift) => <th key={`${day}-${shift.value}`}>{shift.label}</th>)
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedDates.map((dateKey) => {
                      const dayIndex = (parseDateKey(dateKey).getUTCDay() + 2) % 7;
                      return (
                        <tr key={dateKey}>
                          <td className="ledger-date-col">{formatDisplayDate(dateKey)}</td>
                          {dayLabels.flatMap((day, index) =>
                            shifts.map((shift) => {
                              const activeDay = index === dayIndex;
                              const cellEntries = activeDay
                                ? entriesByCell.get(`${dateKey}:${shift.value}`) || []
                                : [];
                              return (
                                <td
                                  key={`${dateKey}-${day}-${shift.value}`}
                                  className={`ledger-cell ${activeDay ? "" : "ledger-cell--muted"}`}
                                  onClick={() => activeDay && openCreateModal(dateKey, shift.value)}
                                >
                                  {cellEntries.map((entry) => (
                                    <button
                                      key={entry.id}
                                      className={`ledger-entry-chip ${canEditEntry(entry) ? "" : "ledger-entry-chip--locked"}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openEditModal(entry);
                                      }}
                                      title={entry.remarks || "Ledger entry"}
                                    >
                                      <span>{entry.faculty?.fullName || "Faculty"}</span>
                                      <small>{money(entry.amount)}</small>
                                      {entry.remarks ? <MessageSquare size={13} /> : null}
                                    </button>
                                  ))}
                                  {activeDay && !cellEntries.length ? <Plus size={14} color="#94a3b8" /> : null}
                                </td>
                              );
                            })
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="faculty-panel ledger-sidebar">
            <div className="ledger-top-list">
              <h2>Top 5 Faculty by Amount</h2>
              <RankList items={summary.topFaculty} emptyText="No faculty totals yet." totalKey="totalAmount" />
            </div>
            <hr />
            <h2>Faculty Summary</h2>
            <RankList items={summary.facultyTotals} emptyText="No summary available." totalKey="weeklyTotal" />
          </aside>
        </div>
      </div>

      {modalOpen ? (
        <div className="faculty-modal-backdrop" role="dialog" aria-modal="true">
          <div className="faculty-modal faculty-modal--confirm">
            <div className="faculty-modal-header">
              <h2>{editingEntry ? "Edit Ledger Entry" : "Add Ledger Entry"}</h2>
              <button className="faculty-icon-button" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitForm}>
              <div className="faculty-form">
                <div className="faculty-form-grid">
                  <Field label="Faculty Member" error={formErrors.facultyId}>
                    <select
                      value={form.facultyId}
                      disabled={role === "faculty"}
                      onChange={(event) => setForm((current) => ({ ...current, facultyId: event.target.value }))}
                    >
                      <option value="">Select faculty</option>
                      {facultyOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.fullName}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Date" error={formErrors.date}>
                    <input type="date" value={form.date} readOnly />
                  </Field>
                  <Field label="Shift" error={formErrors.shift}>
                    <select value={form.shift} disabled>
                      {shifts.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Amount" error={formErrors.amount}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.amount}
                      onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
                    />
                  </Field>
                  <Field label="Remarks" wide>
                    <textarea
                      value={form.remarks}
                      onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))}
                    />
                  </Field>
                </div>
                {editingEntry && !canEditEntry(editingEntry) ? (
                  <p className="ledger-modal-note">This entry is visible for transparency, but only its owner or an admin can edit it.</p>
                ) : null}
              </div>
              <div className="faculty-modal-footer">
                {editingEntry && canEditEntry(editingEntry) ? (
                  <button type="button" className="faculty-button faculty-button--danger" onClick={deleteEntry} disabled={submitting}>
                    <Trash2 size={16} />
                    Delete Entry
                  </button>
                ) : null}
                <button type="button" className="faculty-button faculty-button--ghost" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="faculty-button faculty-button--primary"
                  disabled={submitting || Boolean(editingEntry && !canEditEntry(editingEntry))}
                >
                  <Save size={16} />
                  {submitting ? "Saving..." : editingEntry ? "Save Changes" : "Save Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {toast ? <div className={`faculty-toast faculty-toast--${toast.type}`}>{toast.message}</div> : null}
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

function RankList({
  items,
  emptyText,
  totalKey,
}: {
  items: FacultyTotal[];
  emptyText: string;
  totalKey: "weeklyTotal" | "totalAmount";
}) {
  if (!items.length) return <div className="faculty-empty">{emptyText}</div>;
  return (
    <div className="ledger-rank-list">
      {items.map((item, index) => (
        <div className="ledger-rank-item" key={`${item.facultyId}-${index}`}>
          <div>
            <strong>{item.facultyName}</strong>
            <span>{item.entries} entries</span>
          </div>
          <strong>{money(item[totalKey])}</strong>
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  error,
  wide = false,
  children,
}: {
  label: string;
  error?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`faculty-field ${wide ? "faculty-field--wide" : ""}`}>
      <label>{label}</label>
      {children}
      {error ? <span className="faculty-error-text">{error}</span> : null}
    </div>
  );
}
