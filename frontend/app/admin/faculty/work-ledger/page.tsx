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
  Save,
  Trash2,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import { getAuthRole, getAuthToken, getAuthUserId } from "../../../../lib/authStorage.js";
import { apiCall } from "../../../../lib/api.js";
import PremiumLoader from "../../../components/ui/PremiumLoader";
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
  facultyCode?: string;
  facultyName?: string;
  date: string;
  shift: Shift;
  amount: number;
  remarks: string | null;
  createdBy: string;
  updatedBy: string | null;
  updatedByRole?: string | null;
  updatedByName?: string | null;
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
  days?: WorkLedgerDay[];
  calendarRows?: WorkLedgerCalendarRow[];
  summary?: LedgerSummary;
  isLocked?: boolean;
  lockReason?: string | null;
};

type AttendanceCell = {
  present: boolean;
  id?: string;
  amount: number;
  updatedAt?: string | null;
  updatedByName?: string | null;
  updatedByRole?: string | null;
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

type WorkLedgerDay = {
  date: string;
  day: string;
  shifts: Record<Shift, LedgerEntry[]>;
  dailyTotal: number;
};

type WorkLedgerCalendarCell = {
  entries: LedgerEntry[];
  totalAmount: number;
  entryCount: number;
};

type WorkLedgerCalendarRow = {
  date: string;
  displayDate?: string;
  dayName: string;
  cells: Record<string, WorkLedgerCalendarCell>;
  dailyTotal: number;
};

type SelectedDayCell = {
  date: string;
  day: string;
  entries: LedgerEntry[];
} | null;

type WeeklyPaymentStatus = {
  weekStart: string;
  weekEnd: string;
  totalEntries: number;
  facultyCount: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  paymentMode: string | null;
  status: string;
  paidAt: string | null;
  paidByAdminName?: string;
  remarks?: string;
  canPay: boolean;
  facultyBreakdown: Array<{
    facultyId: string;
    facultyCode?: string;
    facultyName?: string;
    attendanceEntries: number;
    amount: number;
    status?: string;
  }>;
  record?: { id: string } | null;
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

const buildLocalLedgerDays = (rows: LedgerEntry[], dateKeys: string[]): WorkLedgerDay[] =>
  dateKeys.map((dateKey) => {
    const shiftsByKey = {
      MORNING: [] as LedgerEntry[],
      AFTERNOON: [] as LedgerEntry[],
      EVENING: [] as LedgerEntry[],
    };
    rows.forEach((entry) => {
      if (entry.date === dateKey) {
        shiftsByKey[entry.shift].push(entry);
      }
    });
    return {
      date: dateKey,
      day: parseDateKey(dateKey).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
      shifts: shiftsByKey,
      dailyTotal: shifts.reduce((total, shift) => total + shiftsByKey[shift.value].reduce((sum, entry) => sum + Number(entry.amount || 0), 0), 0),
    };
  });

const buildLocalCalendarRows = (rows: LedgerEntry[], dateKeys: string[]): WorkLedgerCalendarRow[] =>
  buildLocalLedgerDays(rows, dateKeys).map((day) => {
    const dayEntries = shifts.flatMap((shift) => day.shifts[shift.value] || []);
    return {
      date: day.date,
      displayDate: `${day.date.slice(8, 10)}/${day.date.slice(5, 7)}/${day.date.slice(2, 4)}`,
      dayName: day.day,
      dailyTotal: day.dailyTotal,
      cells: Object.fromEntries(
        dayLabels.map((label) => {
          const entriesForCell = label === day.day ? dayEntries : [];
          return [
            label,
            {
              entries: entriesForCell,
              totalAmount: entriesForCell.reduce((total, entry) => total + Number(entry.amount || 0), 0),
              entryCount: entriesForCell.length,
            },
          ];
        })
      ) as Record<string, WorkLedgerCalendarCell>,
    };
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
  const [ledgerDays, setLedgerDays] = useState<WorkLedgerDay[]>([]);
  const [calendarRows, setCalendarRows] = useState<WorkLedgerCalendarRow[]>([]);
  const [isWeekLocked, setIsWeekLocked] = useState(false);
  const [lockReason, setLockReason] = useState<string | null>(null);
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
  const [detailsCell, setDetailsCell] = useState<SelectedDayCell>(null);
  const [detailsDrafts, setDetailsDrafts] = useState<Record<string, { present: boolean; amount: string; remarks: string }>>({});
  const [detailsMessage, setDetailsMessage] = useState<Toast>(null);
  const [paymentStatus, setPaymentStatus] = useState<WeeklyPaymentStatus | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentActionLoading, setPaymentActionLoading] = useState(false);
  const [cashPaidAt, setCashPaidAt] = useState(() => toDateKey(new Date()));
  const [cashRemarks, setCashRemarks] = useState("");
  const [cashConfirmed, setCashConfirmed] = useState(false);
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
      const nextEntries = Array.isArray(data.entries) ? data.entries : [];
      const nextDays = Array.isArray(data.days) ? data.days : buildLocalLedgerDays(nextEntries, weekDates);
      setEntries(nextEntries);
      setLedgerDays(nextDays);
      setCalendarRows(Array.isArray(data.calendarRows) ? data.calendarRows : buildLocalCalendarRows(nextEntries, weekDates));
      setSummary(data.summary || emptySummary);
      setIsWeekLocked(Boolean(data.isLocked));
      setLockReason(data.lockReason || null);
      if (mode === "week") {
        setAttendanceGrid([]);
        setAttendanceDays(weekDates);
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

  const loadPaymentStatus = useCallback(async () => {
    if (!token || !isAdmin || mode !== "week") {
      setPaymentStatus(null);
      return;
    }
    setPaymentLoading(true);
    try {
      const data = await callApi<WeeklyPaymentStatus>(
        `/faculty-weekly-payments/status?weekStart=${toDateKey(weekStart)}&weekEnd=${weekEnd}`,
        "GET",
        null,
        token
      );
      setPaymentStatus(data);
    } catch {
      setPaymentStatus(null);
    } finally {
      setPaymentLoading(false);
    }
  }, [isAdmin, mode, token, weekEnd, weekStart]);

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

  useEffect(() => {
    if (!hasMounted || !token) return;
    loadPaymentStatus();
  }, [hasMounted, token, loadPaymentStatus]);

  const refreshLedgerAndPayment = async () => {
    await Promise.all([loadEntries(), loadPaymentStatus()]);
  };

  const payOnline = async () => {
    if (!token || !paymentStatus) return;
    setPaymentActionLoading(true);
    try {
      await callApi(
        "/faculty-weekly-payments/pay-online",
        "POST",
        { weekStart: paymentStatus.weekStart, weekEnd: paymentStatus.weekEnd },
        token
      );
      setPaymentModalOpen(false);
      showToast({ type: "success", message: "Online faculty payouts initiated for this week." });
      await refreshLedgerAndPayment();
    } catch (error) {
      showToast({ type: "error", message: error instanceof Error ? error.message : "Failed to initiate online payout." });
    } finally {
      setPaymentActionLoading(false);
    }
  };

  const payCash = async () => {
    if (!token || !paymentStatus || !cashConfirmed) return;
    setPaymentActionLoading(true);
    try {
      await callApi(
        "/faculty-weekly-payments/pay-cash",
        "POST",
        { weekStart: paymentStatus.weekStart, weekEnd: paymentStatus.weekEnd, paidAt: cashPaidAt, remarks: cashRemarks },
        token
      );
      setPaymentModalOpen(false);
      setCashConfirmed(false);
      showToast({ type: "success", message: "Faculty week marked paid in cash." });
      await refreshLedgerAndPayment();
    } catch (error) {
      showToast({ type: "error", message: error instanceof Error ? error.message : "Failed to record cash payment." });
    } finally {
      setPaymentActionLoading(false);
    }
  };

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

  const openDetailsModal = (row: WorkLedgerCalendarRow, dayLabel: string) => {
    const cellEntries = row.cells?.[dayLabel]?.entries || [];
    setDetailsCell({ date: row.date, day: row.dayName || dayLabel, entries: cellEntries });
    setDetailsDrafts(
      Object.fromEntries(
        cellEntries.map((entry) => [
          entry.id,
          {
            present: true,
            amount: String(entry.amount ?? 0),
            remarks: entry.remarks || "",
          },
        ])
      )
    );
    setDetailsMessage(null);
  };

  const updateDetailsDraft = (entryId: string, patch: Partial<{ present: boolean; amount: string; remarks: string }>) => {
    setDetailsDrafts((current) => ({
      ...current,
      [entryId]: {
        present: current[entryId]?.present ?? true,
        amount: current[entryId]?.amount ?? "0",
        remarks: current[entryId]?.remarks ?? "",
        ...patch,
      },
    }));
  };

  const saveDetailsEntry = async (entry: LedgerEntry) => {
    if (!token || !detailsCell) return;
    const draft = detailsDrafts[entry.id] || { present: true, amount: String(entry.amount || 0), remarks: entry.remarks || "" };
    const amount = Math.max(0, Number(draft.amount || 0) || 0);
    setSubmitting(true);
    setDetailsMessage(null);
    try {
      await callApi(
        `/work-ledger/attendance/${entry.id}`,
        "PATCH",
        {
          isPresent: draft.present,
          amount: draft.present ? amount : 0,
          remarks: draft.remarks,
        },
        token
      );
      setDetailsMessage({ type: "success", message: "Attendance updated successfully." });
      await loadEntries();
      setDetailsCell((current) =>
        current
          ? {
              ...current,
              entries: draft.present
                ? current.entries.map((item) => item.id === entry.id ? { ...item, amount, remarks: draft.remarks } : item)
                : current.entries.filter((item) => item.id !== entry.id),
            }
          : current
      );
    } catch (error) {
      setDetailsMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to update attendance." });
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

  const resetFilters = () => {
    setSearch("");
    setFacultyFilter("all");
    setShiftFilter("all");
    setMonthFilter("");
    setStartDate("");
    setEndDate("");
    setMode("week");
    setWeekStart(getFridayWeekStart());
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
      Status: "Present",
      Amount: entry.amount,
      Remarks: entry.remarks || "",
      "Created By": entry.createdBy,
      "Updated By": entry.updatedByName || entry.updatedBy || "",
      "Updated By Role": entry.updatedByRole || "",
      "Created At": entry.createdAt,
      "Updated At": entry.updatedAt,
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Work Ledger");
    XLSX.writeFile(workbook, `faculty-work-ledger-${Date.now()}.xlsx`);
  };

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
            <div className="faculty-field faculty-field--actions">
              <label>Filters</label>
              <button className="faculty-button faculty-button--ghost" onClick={resetFilters}>
                Reset Filters
              </button>
            </div>
            {hasMounted && isAdmin ? (
              <div className="faculty-field faculty-field--actions">
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

        {isAdmin && mode === "week" ? (
          <section className="faculty-panel weekly-payment-panel">
            <div className="faculty-section-heading">
              <div>
                <h2>Weekly Payment</h2>
                <p>Selected Week: {formatDisplayDate(toDateKey(weekStart))} to {formatDisplayDate(weekEnd)}</p>
              </div>
              <span className={`faculty-status faculty-status--${paymentStatus?.status || "UNPAID"}`}>
                {paymentLoading ? "Loading" : paymentStatus?.status || "Unpaid"}
              </span>
            </div>
            <div className="ledger-summary">
              <SummaryCard label="Attendance Entries" value={paymentStatus?.totalEntries ?? summary.totalEntries} />
              <SummaryCard label="Faculty Participated" value={paymentStatus?.facultyCount ?? summary.totalFacultyParticipated} />
              <SummaryCard label="Total Payable" value={money(paymentStatus?.totalAmount ?? summary.currentWeekTotal)} />
              <SummaryCard label="Payment Mode" value={paymentStatus?.paymentMode || "-"} />
            </div>
            {paymentStatus?.status === "PAID" ? (
              <div className="faculty-toast--success">
                Paid on {paymentStatus.paidAt ? formatUpdatedAt(paymentStatus.paidAt) : "-"} via {paymentStatus.paymentMode || "-"}.
                {paymentStatus.record?.id ? (
                  <Link href="/admin/faculty/records" className="faculty-inline-link"> View Record</Link>
                ) : null}
              </div>
            ) : paymentStatus?.status === "PROCESSING" ? (
              <div className="faculty-toast--success">Online payout is processing. Attendance editing is locked.</div>
            ) : null}
            <button
              className="faculty-button faculty-button--primary"
              disabled={paymentLoading || !paymentStatus?.canPay}
              onClick={() => setPaymentModalOpen(true)}
            >
              Pay This Week
            </button>
          </section>
        ) : null}

        <section className="faculty-panel ledger-grid-panel">
            {loading ? (
              <div className="faculty-loading"><PremiumLoader label="Loading work ledger" /></div>
            ) : error ? (
              <div className="faculty-error">{error}</div>
            ) : (
              <div className="ledger-grid-scroll">
                <div className="ledger-shift-legend">
                  {shifts.map((shift) => (
                    <span key={shift.value} className={`shift-chip shift-chip-${shift.value.toLowerCase()}`}>
                      {shift.label} Shift
                    </span>
                  ))}
                </div>
                {isWeekLocked ? <div className="faculty-toast--error">{lockReason || "This week is locked for attendance editing."}</div> : null}
                <table className="ledger-grid ledger-attendance-grid work-ledger-calendar-grid">
                  <thead>
                    <tr>
                      <th className="ledger-date-col">Date / Day</th>
                      {dayLabels.map((day) => (
                        <th key={day}>{day}</th>
                      ))}
                      <th>Daily Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendarRows.length ? (
                      calendarRows.map((row) => (
                        <tr key={row.date}>
                          <td className="ledger-date-col">
                            <strong>{formatDisplayDate(row.date)}</strong>
                            <small>{row.dayName}</small>
                          </td>
                          {dayLabels.map((day) => {
                            const cell = row.cells?.[day] || { entries: [], totalAmount: 0, entryCount: 0 };
                            const visibleEntries = cell.entries.slice(0, 3);
                            const hiddenCount = Math.max(0, cell.entries.length - visibleEntries.length);
                            return (
                              <td
                                key={`${row.date}-${day}`}
                                className={`ledger-cell ledger-attendance-cell work-ledger-calendar-cell ${cell.entries.length ? "work-ledger-cell-clickable" : ""}`}
                                onClick={() => openDetailsModal(row, day)}
                              >
                                {visibleEntries.length ? (
                                  <div className="ledger-chip-list">
                                    {visibleEntries.map((entry) => (
                                      <button
                                        key={entry.id}
                                        className={`shift-chip shift-chip-${entry.shift.toLowerCase()}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openDetailsModal(row, day);
                                        }}
                                        title="View attendance details"
                                      >
                                        {entry.facultyName || entry.faculty?.fullName || "Faculty"}
                                      </button>
                                    ))}
                                    {hiddenCount ? <span className="work-ledger-more-chip">+{hiddenCount}</span> : null}
                                  </div>
                                ) : (
                                  <span className="ledger-empty-cell">-</span>
                                )}
                              </td>
                            );
                          })}
                          <td>{money(row.dailyTotal || 0)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={9}>No attendance records found for this week.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={8}>Overall Weekly Total</td>
                      <td>{money(summary.currentWeekTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
        </section>
      </div>

      {paymentModalOpen && paymentStatus ? (
        <div className="faculty-modal-backdrop" role="dialog" aria-modal="true">
          <div className="faculty-modal payroll-detail-modal">
            <div className="faculty-modal-header">
              <h2>Pay Faculty Week</h2>
              <button className="faculty-icon-button" onClick={() => setPaymentModalOpen(false)} disabled={paymentActionLoading}>
                <X size={18} />
              </button>
            </div>
            <div className="faculty-detail-list">
              <div><span>Week Period</span><strong>{formatDisplayDate(paymentStatus.weekStart)} to {formatDisplayDate(paymentStatus.weekEnd)}</strong></div>
              <div><span>Faculty Count</span><strong>{paymentStatus.facultyCount}</strong></div>
              <div><span>Attendance Entries</span><strong>{paymentStatus.totalEntries}</strong></div>
              <div><span>Total Amount</span><strong>{money(paymentStatus.totalAmount)}</strong></div>
            </div>
            <div className="faculty-table-wrap">
              <table className="faculty-table">
                <thead>
                  <tr>
                    <th>Faculty ID</th>
                    <th>Faculty Name</th>
                    <th>Entries</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentStatus.facultyBreakdown.map((row) => (
                    <tr key={row.facultyId}>
                      <td>{row.facultyCode || row.facultyId}</td>
                      <td>{row.facultyName || "-"}</td>
                      <td>{row.attendanceEntries}</td>
                      <td>{money(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <section className="faculty-panel payroll-receipt-panel">
              <h3>Cash Payment</h3>
              <div className="faculty-form-grid">
                <div className="faculty-field">
                  <label>Cash Paid Date</label>
                  <input type="date" value={cashPaidAt} onChange={(event) => setCashPaidAt(event.target.value)} />
                </div>
                <div className="faculty-field faculty-field--wide">
                  <label>Remarks</label>
                  <input value={cashRemarks} onChange={(event) => setCashRemarks(event.target.value)} placeholder="Paid manually in cash" />
                </div>
              </div>
              <label className="faculty-checkbox-row">
                <input type="checkbox" checked={cashConfirmed} onChange={(event) => setCashConfirmed(event.target.checked)} />
                <span>I confirm this faculty week has been paid in cash.</span>
              </label>
            </section>
            <div className="faculty-modal-footer">
              <button className="faculty-button faculty-button--ghost" onClick={() => setPaymentModalOpen(false)} disabled={paymentActionLoading}>
                Cancel
              </button>
              <button className="faculty-button faculty-button--soft" onClick={payOnline} disabled={paymentActionLoading}>
                {paymentActionLoading ? "Processing..." : "Pay Online"}
              </button>
              <button className="faculty-button faculty-button--primary" onClick={payCash} disabled={paymentActionLoading || !cashConfirmed}>
                {paymentActionLoading ? "Saving..." : "Mark as Cash Paid"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailsCell ? (
        <div className="faculty-modal-backdrop" role="dialog" aria-modal="true">
          <div className="faculty-modal">
            <div className="faculty-modal-header">
              <h2>
                Attendance Details — {detailsCell.day}, {formatDisplayDate(detailsCell.date)}
              </h2>
              <button className="faculty-icon-button" onClick={() => setDetailsCell(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="faculty-form">
              {isWeekLocked ? <div className="faculty-toast--error">{lockReason || "This week’s payout has already been processed. Attendance editing is locked."}</div> : null}
              {detailsMessage ? <div className={`faculty-toast--${detailsMessage.type}`}>{detailsMessage.message}</div> : null}
              {detailsCell.entries.length ? (
                <div className="work-ledger-detail-stack">
                  {shifts.map((shift) => {
                    const shiftEntries = detailsCell.entries.filter((entry) => entry.shift === shift.value);
                    if (!shiftEntries.length) return null;
                    return (
                      <section key={shift.value} className="work-ledger-detail-section">
                        <h3>
                          <span className={`shift-chip shift-chip-${shift.value.toLowerCase()}`}>{shift.label} Shift</span>
                        </h3>
                        <div className="faculty-table-wrap">
                          <table className="faculty-table">
                            <thead>
                              <tr>
                                <th>Faculty</th>
                                <th>Status</th>
                                <th>Amount</th>
                                <th>Updated At</th>
                                <th>Updated By</th>
                                <th>Remarks</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {shiftEntries.map((entry) => {
                                const draft = detailsDrafts[entry.id] || { present: true, amount: String(entry.amount || 0), remarks: entry.remarks || "" };
                                return (
                                  <tr key={entry.id}>
                                    <td>
                                      <strong>{entry.facultyName || entry.faculty?.fullName || "Faculty"}</strong>
                                      <small>{entry.facultyCode || entry.faculty?.facultyId || "-"}</small>
                                    </td>
                                    <td>
                                      <select
                                        value={draft.present ? "PRESENT" : "ABSENT"}
                                        disabled={isWeekLocked || submitting}
                                        onChange={(event) => updateDetailsDraft(entry.id, { present: event.target.value === "PRESENT" })}
                                      >
                                        <option value="PRESENT">Present</option>
                                        <option value="ABSENT">Absent</option>
                                      </select>
                                    </td>
                                    <td>
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={draft.amount}
                                        disabled={isWeekLocked || submitting || !draft.present}
                                        onChange={(event) => updateDetailsDraft(entry.id, { amount: event.target.value })}
                                      />
                                    </td>
                                    <td>{formatUpdatedAt(entry.updatedAt)}</td>
                                    <td>{entry.updatedByName || entry.updatedBy || "-"}</td>
                                    <td>
                                      <input
                                        value={draft.remarks}
                                        disabled={isWeekLocked || submitting}
                                        onChange={(event) => updateDetailsDraft(entry.id, { remarks: event.target.value })}
                                      />
                                    </td>
                                    <td>
                                      <button className="faculty-button faculty-button--primary" disabled={isWeekLocked || submitting} onClick={() => saveDetailsEntry(entry)}>
                                        {submitting ? "Saving..." : "Save"}
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    );
                  })}
                  <div className="work-ledger-day-total">Day Total: {money(detailsCell.entries.reduce((total, entry) => total + Number(entry.amount || 0), 0))}</div>
                </div>
              ) : (
                <div className="faculty-empty">No attendance entries for this day.</div>
              )}
            </div>
            <div className="faculty-modal-footer">
              <button className="faculty-button faculty-button--ghost" onClick={() => setDetailsCell(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
