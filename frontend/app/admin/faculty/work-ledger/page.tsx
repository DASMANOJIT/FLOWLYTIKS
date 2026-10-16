"use client";

import Modal from "../../../components/ui/Modal";

import type React from "react";
import BackToDashboard from "../../../components/admin/BackToDashboard";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildWorkLedgerPdf } from "../../../../lib/workLedgerPdf.js";
import { groupAttendanceFaculty } from "../../../../lib/attendancePresentation.js";
import { buildWorkLedgerWorkbook, styledAttendanceXlsx } from "../../../../lib/workLedgerWorkbook.js";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { getAuthRole, getAuthToken, getAuthUserId } from "../../../../lib/authStorage.js";
import { apiCall } from "../../../../lib/api.js";
import PremiumLoader from "../../../components/ui/PremiumLoader";
import "../faculty.css";

type Shift = "DAILY" | "MORNING" | "AFTERNOON" | "EVENING";
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
  { value: "DAILY", label: "Daily Attendance" },
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

const recordedMoney = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const parseDateKey = (value: string) => new Date(`${value}T00:00:00.000Z`);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getFridayWeekStart = (value = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const date = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
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
      DAILY: [] as LedgerEntry[],
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
  const [weekStart, setWeekStart] = useState(() => getFridayWeekStart());
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [ledgerDays, setLedgerDays] = useState<WorkLedgerDay[]>([]);
  const [calendarRows, setCalendarRows] = useState<WorkLedgerCalendarRow[]>([]);
  const [isWeekLocked, setIsWeekLocked] = useState(false);
  const [lockReason, setLockReason] = useState<string | null>(null);
  const [faculty, setFaculty] = useState<FacultyOption[]>([]);
  const [summary, setSummary] = useState<LedgerSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailsCell, setDetailsCell] = useState<SelectedDayCell>(null);
  const [addingPerson, setAddingPerson] = useState(false);
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [attendanceShift, setAttendanceShift] = useState<"MORNING" | "EVENING">("MORNING");
  const [attendanceFaculty, setAttendanceFaculty] = useState("");
  const [eligibleFaculty, setEligibleFaculty] = useState<FacultyOption[]>([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [eligibleError, setEligibleError] = useState("");
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const attendancePending = useRef(false);
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

  const queryString = useMemo(() => new URLSearchParams({ week: toDateKey(weekStart) }).toString(), [weekStart]);

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

    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load work ledger.");
    } finally {
      setLoading(false);
    }
  }, [queryString, token, weekDates]);

  const loadPaymentStatus = useCallback(async () => {
    if (!token || !isAdmin) {
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
  }, [isAdmin, token, weekEnd, weekStart]);

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
    if (isAdmin && (!form.amount || Number(form.amount) < 0)) nextErrors.amount = "Amount is required.";
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
          ...(isAdmin ? { amount: Number(form.amount) } : {}),
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
    setAddingPerson(false);
    setAttendanceSearch("");
    setAttendanceFaculty("");
    setDetailsMessage(null);
  };

  const detailsDate = detailsCell?.date;
  useEffect(() => {
    if (!addingPerson || !detailsDate || !isAdmin || !token) return;
    let active = true;
    setEligibleLoading(true);
    setEligibleError("");
    setAttendanceFaculty("");
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ date: detailsDate, shift: attendanceShift, search: attendanceSearch });
      callApi<FacultyListResponse>(`/work-ledger/admin/attendance/eligible?${query}`, "GET", null, token)
        .then(data => { if (active) setEligibleFaculty(data.faculty || []); })
        .catch(error => { if (active) { setEligibleFaculty([]); setEligibleError(error instanceof Error ? error.message : "Unable to load eligible faculty."); } })
        .finally(() => { if (active) setEligibleLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [addingPerson, detailsDate, attendanceShift, attendanceSearch, isAdmin, token]);

  const changeDetailsAttendance = async (entry?: LedgerEntry) => {
    if (!token || !detailsCell || !isAdmin || attendancePending.current) return;
    if (entry && !window.confirm(`Delete ${entry.facultyName || entry.faculty?.fullName}'s ${entry.shift === "MORNING" ? "Morning" : "Evening"} attendance for ${formatDisplayDate(detailsCell.date)}?`)) return;
    if (!entry && !attendanceFaculty) return;
    const date = detailsCell.date;
    attendancePending.current = true;
    setAttendanceBusy(true);
    setDetailsMessage(null);
    try {
      await callApi(entry ? `/work-ledger/admin/attendance/${entry.id}` : "/work-ledger/admin/attendance", entry ? "DELETE" : "POST", entry ? null : { facultyId: attendanceFaculty, date, shift: attendanceShift }, token);
      setDetailsMessage({ type: "success", message: entry ? "Attendance deleted." : "Attendance added." });
      setAddingPerson(false);
      setAttendanceFaculty("");
      const fresh = await callApi<LedgerListResponse>(`/work-ledger?${queryString}`, "GET", null, token);
      setDetailsCell(current => current?.date === date ? { ...current, entries: (fresh.entries || []).filter(item => item.date.slice(0, 10) === date) } : current);
      await refreshLedgerAndPayment();
    } catch (error) {
      setDetailsMessage({ type: "error", message: error instanceof Error ? error.message : "Failed to update attendance." });
    } finally {
      attendancePending.current = false;
      setAttendanceBusy(false);
    }
  };

  const setCurrentWeek = () => {
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

  const [exporting, setExporting] = useState(false);
  const exportReport = async (format: "xlsx" | "pdf") => {
    if (!isAdmin || !token || exporting) return;
    setExporting(true);
    try {
      const report = await callApi<LedgerListResponse & { weekStart: string; weekEnd: string }>(`/work-ledger/export.json?${queryString}`, "GET", null, token);
      if (format === "pdf") {
        (await buildWorkLedgerPdf(report)).save(`faculty-work-ledger-${report.weekStart}.pdf`);
      } else {
        const workbook = buildWorkLedgerWorkbook(report);
        const url = URL.createObjectURL(new Blob([styledAttendanceXlsx(workbook)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        const link = document.createElement("a"); link.href = url; link.download = `faculty-work-ledger-${report.weekStart}.xlsx`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) { showToast({ type: "error", message: error instanceof Error ? error.message : "Export failed." }); }
    finally { setExporting(false); }
  };

  const legacyWeeklyAmount = entries.filter(entry => !["MORNING", "EVENING"].includes(entry.shift)).reduce((total, entry) => total + Number(entry.amount || 0), 0);

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <BackToDashboard />
          <div className="faculty-title-block">
            <h1>Faculty Work Ledger</h1>
            <p>Morning and Evening attendance and recorded amounts for the selected payroll week. Historical entries are retained.</p>
          </div>
        </header>

        <section className="faculty-panel">
          <div className="ledger-weekbar">
            <div>
              <h2>
                Week: {formatDisplayDate(toDateKey(weekStart))} to {formatDisplayDate(weekEnd)}
              </h2>
            </div>
            <div className="ledger-weekbar__actions">
              <button className="faculty-button faculty-button--ghost" onClick={() => { setWeekStart(addDays(weekStart, -7)); }}>
                <ChevronLeft size={17} />
                Previous Week
              </button>
              <button className="faculty-button faculty-button--soft" onClick={setCurrentWeek}>
                <CalendarDays size={17} />
                Current Week
              </button>
              <button className="faculty-button faculty-button--ghost" onClick={() => { setWeekStart(addDays(weekStart, 7)); }}>
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
            {hasMounted && isAdmin ? (
              <div className="faculty-field faculty-field--actions">
                <label>Export</label>
                <div className="ledger-export-actions">
                  <button className="faculty-button faculty-button--soft" onClick={exportCsv}>
                    <Download size={16} />
                    CSV
                  </button>
                  <button className="faculty-button faculty-button--soft" disabled={exporting} onClick={() => void exportReport("xlsx")}>
                    <FileSpreadsheet size={16} />
                    XLSX
                  </button>
                  <button className="faculty-button faculty-button--soft" disabled={exporting} onClick={() => void exportReport("pdf")}><Download size={16} />PDF</button>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {isAdmin ? (
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
                {isWeekLocked ? <div className="faculty-toast--error">{lockReason || "This week is locked for attendance editing."}</div> : null}
                <div className="weekly-attendance-legend"><span className="weekly-shift weekly-shift--morning">Morning</span><span className="weekly-shift weekly-shift--evening">Evening</span><span>Historical entries retain their recorded amounts.</span></div>
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
                            const members = groupAttendanceFaculty(cell.entries);
                            const compact = members.length > 2;
                            const visibleMembers = compact ? members.slice(0, 1) : members;
                            return (
                              <td
                                key={`${row.date}-${day}`}
                                className={`ledger-cell ledger-attendance-cell work-ledger-calendar-cell ${cell.entries.length ? "work-ledger-cell-clickable" : ""}`}
                                onClick={() => openDetailsModal(row, day)}
                              >
                                {visibleMembers.length ? (
                                  <div className="ledger-chip-list">
                                    {visibleMembers.map((member) => (
                                      <button
                                        key={member.id}
                                        className="weekly-attendance-summary"
                                        aria-label={`View all attendance for ${row.date}: ${members.map(person => person.name).join(", ")}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openDetailsModal(row, day);
                                        }}
                                        title={member.name}
                                      >
                                        <span className="weekly-attendance-name">{compact ? `${member.name.trim().split(/\s+/)[0]} +${members.length - 1}` : member.name}</span>
                                        {!compact ? <span className="weekly-attendance-shifts">{member.shifts.map((shift: string) => <span key={shift} className={`weekly-shift ${shift === "MORNING" ? "weekly-shift--morning" : shift === "EVENING" ? "weekly-shift--evening" : ""}`}>{shift === "MORNING" ? "Morning" : shift === "EVENING" ? "Evening" : "Legacy"}</span>)}</span> : null}
                                      </button>
                                    ))}
                                  </div>
                                ) : isAdmin && row.dayName === day ? (
                                  <button className="weekly-attendance-summary" aria-label={`Open attendance details for ${row.date}`} onClick={event => { event.stopPropagation(); openDetailsModal(row, day); }}>View / Add</button>
                                ) : <span className="ledger-empty-cell">-</span>}
                              </td>
                            );
                          })}
                          <td>{recordedMoney(row.dailyTotal || 0)}</td>
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
                      <td>{recordedMoney(summary.currentWeekTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
                {legacyWeeklyAmount !== 0 ? <p className="weekly-attendance-legacy-note">Historical unallocated attendance: {recordedMoney(legacyWeeklyAmount)} is included in weekly totals, but not assigned to Morning or Evening.</p> : null}
              </div>
            )}
        </section>
      </div>

      {paymentModalOpen && paymentStatus ? (
        <Modal className="faculty-modal-backdrop" role="dialog" aria-modal="true">
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
        </Modal>
      ) : null}

      {detailsCell ? (
        <Modal className="faculty-modal-backdrop" role="dialog" aria-modal="true" onClose={() => setDetailsCell(null)}>
          <div className="faculty-modal weekly-attendance-details">
            <div className="faculty-modal-header">
              <h2>
                Attendance Details — {detailsCell.day}, {formatDisplayDate(detailsCell.date)}
              </h2>
              {isAdmin ? <button className="faculty-button faculty-button--primary" disabled={isWeekLocked || attendanceBusy} onClick={() => setAddingPerson(true)}>Add People</button> : null}
              <button className="faculty-icon-button" aria-label="Close attendance details" onClick={() => setDetailsCell(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="faculty-form weekly-attendance-details__body">
              {isWeekLocked ? <div className="faculty-toast--error">{lockReason || "Attendance is locked because this week's payout has been processed."}</div> : null}
              {detailsMessage ? <div role="status" className={`faculty-toast--${detailsMessage.type}`}>{detailsMessage.message}</div> : null}
              {addingPerson ? (
                <form className="weekly-attendance-add" onSubmit={event => { event.preventDefault(); void changeDetailsAttendance(); }}>
                  <h3>Add People</h3>
                  <label>Shift
                    <select value={attendanceShift} disabled={attendanceBusy} onChange={event => setAttendanceShift(event.target.value as "MORNING" | "EVENING")}>
                      <option value="MORNING">Morning</option><option value="EVENING">Evening</option>
                    </select>
                  </label>
                  <label>Search faculty by name or ID
                    <input value={attendanceSearch} disabled={attendanceBusy} onChange={event => setAttendanceSearch(event.target.value)} maxLength={160} />
                  </label>
                  <label>Faculty Name
                    <select aria-label="Faculty Name" required value={attendanceFaculty} disabled={eligibleLoading || attendanceBusy || Boolean(eligibleError)} onChange={event => setAttendanceFaculty(event.target.value)}>
                      <option value="">{eligibleLoading ? "Loading faculty..." : "Select faculty"}</option>
                      {eligibleFaculty.map(person => <option key={person.id} value={person.id}>{person.fullName} ({person.facultyId})</option>)}
                    </select>
                  </label>
                  {eligibleError ? <p role="alert">{eligibleError}</p> : !eligibleLoading && !eligibleFaculty.length ? <p>No eligible faculty found. Try a different name or shift.</p> : <p>Search the directory to narrow results. Up to 50 matches are shown.</p>}
                  <div className="faculty-inline-actions">
                    <button type="submit" className="faculty-button faculty-button--primary" disabled={attendanceBusy || eligibleLoading || !attendanceFaculty || isWeekLocked}>{attendanceBusy ? "Adding..." : "Add"}</button>
                    <button type="button" className="faculty-button faculty-button--ghost" disabled={attendanceBusy} onClick={() => setAddingPerson(false)}>Cancel</button>
                  </div>
                </form>
              ) : null}
              {(["MORNING", "EVENING"] as const).map(shift => (
                <section key={shift} className="work-ledger-detail-section">
                  <h3 className={`weekly-shift weekly-shift--${shift.toLowerCase()}`}>{shift} SHIFT</h3>
                  {detailsCell.entries.some(entry => entry.shift === shift) ? (
                    <div className="faculty-table-wrap">
                      <table className="faculty-table">
                        <thead><tr><th>Faculty Name</th><th>Status</th><th>Amount</th><th>Updated At</th><th>Delete</th></tr></thead>
                        <tbody>{detailsCell.entries.filter(entry => entry.shift === shift).map(entry => (
                          <tr key={entry.id}>
                            <td data-label="Faculty Name"><strong>{entry.facultyName || entry.faculty?.fullName || "Faculty"}</strong></td>
                            <td data-label="Status"><span className="weekly-attendance-present">Present</span></td>
                            <td data-label="Amount">{recordedMoney(Number(entry.amount))}</td>
                            <td data-label="Updated At">{formatUpdatedAt(entry.updatedAt)}</td>
                            <td data-label="Delete">{isAdmin ? <button className="faculty-button faculty-button--danger" disabled={isWeekLocked || attendanceBusy} onClick={() => void changeDetailsAttendance(entry)} aria-label={`Delete ${entry.facultyName || entry.faculty?.fullName} ${shift === "MORNING" ? "Morning" : "Evening"} attendance`}>Delete</button> : "-"}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : <p className="faculty-empty">No attendance in this shift.</p>}
                </section>
              ))}
              {detailsCell.entries.some(entry => !["MORNING", "EVENING"].includes(entry.shift)) ? (
                <section className="work-ledger-detail-section">
                  <h3>Historical attendance (read-only)</h3>
                  <div className="faculty-table-wrap"><table className="faculty-table">
                    <thead><tr><th>Faculty Name</th><th>Historical Entry</th><th>Amount</th><th>Updated At</th></tr></thead>
                    <tbody>{detailsCell.entries.filter(entry => !["MORNING", "EVENING"].includes(entry.shift)).map(entry => (
                      <tr key={entry.id}>
                        <td data-label="Faculty Name">{entry.facultyName || entry.faculty?.fullName}</td>
                        <td data-label="Historical Entry">{entry.shift === "DAILY" ? "Unallocated daily" : "Legacy Afternoon"}</td>
                        <td data-label="Amount">{recordedMoney(Number(entry.amount))}</td>
                        <td data-label="Updated At">{formatUpdatedAt(entry.updatedAt)}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </section>
              ) : null}
            </div>
            <div className="faculty-modal-footer">
              <strong className="weekly-attendance-details__total">Day Total: {recordedMoney(detailsCell.entries.reduce((total, entry) => total + Number(entry.amount || 0), 0))}</strong>
              <button className="faculty-button faculty-button--ghost" onClick={() => setDetailsCell(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {modalOpen ? (
        <Modal className="faculty-modal-backdrop" role="dialog" aria-modal="true">
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
                  <Field label="Shift">
                    <select value={form.shift} disabled={Boolean(editingEntry)} onChange={event => setForm(current => ({ ...current, shift: event.target.value as Shift }))}>
                      {editingEntry && ["DAILY", "AFTERNOON"].includes(form.shift) ? <option value={form.shift}>Historical {form.shift.toLowerCase()}</option> : null}
                      <option value="MORNING">Morning</option><option value="EVENING">Evening</option>
                    </select>
                  </Field>
                  <Field label="Amount" error={formErrors.amount}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={isAdmin ? form.amount : String([0, 6].includes(parseDateKey(form.date).getUTCDay()) ? 400 : 200)}
                      readOnly={!isAdmin}
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
        </Modal>
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
