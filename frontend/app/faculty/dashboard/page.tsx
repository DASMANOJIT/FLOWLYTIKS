"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { apiCall } from "../../../lib/api.js";
import { getAuthToken, getAuthRole } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import "../../admin/faculty/faculty.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type Profile = {
  facultyId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  address: string | null;
  qualification: string | null;
  designation: string | null;
  experienceYears: number | null;
  joiningDate: string | null;
  employmentType: string | null;
  salaryType: string | null;
  status: string;
};

type Dashboard = {
  profile?: Profile;
  faculty?: Profile;
  summary: {
    currentWeekEarning?: number;
    previousWeekEarning?: number;
    currentWeekIncome: number;
    previousWeekIncome?: number;
    currentMonthIncome: number;
    currentYearIncome: number;
    totalEarning: number;
    paidAmount: number;
    unpaidAmount: number;
    totalAttendanceEntries: number;
  };
  charts: {
    weekly: { label: string; value: number }[];
    monthly: { label: string; value: number }[];
    yearly: { label: string; value: number }[];
  };
  payoutHistory: {
    id: string;
    weekPeriod: string;
    totalAttendanceAmount: number;
    paidAmount: number;
    pendingAmount: number;
    status: string;
    paidDate: string | null;
    remark: string;
  }[];
};

type AttendanceRow = {
  date: string;
  dayName: string;
  shifts: Record<string, { present: boolean; id?: string; amount: number }>;
  dailyTotal: number;
};

type FacultyAttendanceRow = {
  id: string;
  facultyId: string;
  fullName: string;
  canEdit: boolean;
  weeklyTotal: number;
  shifts: Record<string, { present: boolean; id?: string; amount: number }>;
};

const shifts = ["MORNING", "AFTERNOON", "EVENING"] as const;

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);

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

export default function FacultyDashboardPage() {
  const router = useRouter();
  const [hasMounted, setHasMounted] = useState(false);
  const [token, setToken] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setHasMounted(true);
    const storedToken = getAuthToken();
    const role = getAuthRole();
    if (!storedToken || role !== "faculty") {
      router.push("/faculty/login");
      return;
    }
    setToken(storedToken);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    callApi<Dashboard>("/faculty/dashboard-summary", "GET", null, token)
      .then(setDashboard)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard."));
  }, [token]);

  if (!hasMounted || (!dashboard && !error)) {
    return <FacultyPortalLayout title="Dashboard"><section className="faculty-panel faculty-loading">Loading dashboard...</section></FacultyPortalLayout>;
  }

  if (error) {
    return <FacultyPortalLayout title="Dashboard"><div className="faculty-toast--error">{error}</div></FacultyPortalLayout>;
  }

  if (!dashboard) {
    return <FacultyPortalLayout title="Dashboard"><section className="faculty-panel faculty-empty">No dashboard data available.</section></FacultyPortalLayout>;
  }

  const profile = dashboard.profile || dashboard.faculty;
  const weeklyChart = chartData("Weekly Income", dashboard.charts.weekly, "#2563eb");
  const monthlyChart = chartData("Monthly Income", dashboard.charts.monthly, "#15803d");
  const yearlyChart = chartData("Yearly Income", dashboard.charts.yearly, "#7c3aed");

  return (
    <FacultyPortalLayout title="Faculty Dashboard" subtitle="Profile, income, attendance, and payout status.">
      <section className="faculty-stats-grid">
        <PortalCard title="Current Week Income" value={money(dashboard.summary.currentWeekIncome)} meta="Friday to Thursday" />
        <PortalCard title="Previous Week Income" value={money(dashboard.summary.previousWeekIncome || dashboard.summary.previousWeekEarning || 0)} meta="Previous Friday to Thursday" />
        <PortalCard title="Current Month Income" value={money(dashboard.summary.currentMonthIncome)} meta="This month" />
        <PortalCard title="Current Year Income" value={money(dashboard.summary.currentYearIncome)} meta="This year" />
        <PortalCard title="Total Earning" value={money(dashboard.summary.totalEarning)} meta={`${dashboard.summary.totalAttendanceEntries} attendance entries`} />
        <PortalCard title="Paid Amount" value={money(dashboard.summary.paidAmount)} meta="Marked paid by admin" />
        <PortalCard title="Pending Amount" value={money(dashboard.summary.unpaidAmount)} meta="Unpaid or pending" />
      </section>

      <section className="faculty-profile-grid">
        <section className="faculty-profile-section">
          <h2>Profile</h2>
          <div className="faculty-detail-list">
            <Detail label="Faculty ID" value={profile?.facultyId || "-"} />
            <Detail label="Name" value={profile?.fullName || "-"} />
            <Detail label="Phone" value={profile?.phone || "-"} />
            <Detail label="Email" value={profile?.email || "-"} />
            <Detail label="DOB" value={profile?.dob ? profile.dob.slice(0, 10) : "-"} />
            <Detail label="Address" value={profile?.address || "-"} />
            <Detail label="Qualification" value={profile?.qualification || "-"} />
            <Detail label="Designation" value={profile?.designation || "-"} />
            <Detail label="Experience" value={profile?.experienceYears === null || profile?.experienceYears === undefined ? "-" : `${profile.experienceYears} years`} />
            <Detail label="Joining Date" value={profile?.joiningDate ? profile.joiningDate.slice(0, 10) : "-"} />
            <Detail label="Employment Type" value={profile?.employmentType || "-"} />
            <Detail label="Salary Type" value={profile?.salaryType || "-"} />
            <Detail label="Status" value={profile?.status || "-"} />
          </div>
        </section>
      </section>

      <section className="faculty-portal-chart-grid">
        <div className="faculty-panel"><h2>Weekly Income</h2><Bar data={weeklyChart} /></div>
        <div className="faculty-panel"><h2>Monthly Income</h2><Line data={monthlyChart} /></div>
        <div className="faculty-panel"><h2>Yearly Income</h2><Bar data={yearlyChart} /></div>
      </section>

      <WeeklyAttendanceGrid token={token} />

      <section className="faculty-table-card">
        <h2>Payout History</h2>
        <table className="faculty-table">
          <thead>
            <tr><th>Week Period</th><th>Total Attendance Amount</th><th>Paid Amount</th><th>Pending Amount</th><th>Status</th><th>Paid Date</th><th>Remark</th></tr>
          </thead>
          <tbody>
            {dashboard.payoutHistory.length ? dashboard.payoutHistory.map((item) => (
              <tr key={item.id}>
                <td>{item.weekPeriod}</td>
                <td>{money(item.totalAttendanceAmount)}</td>
                <td>{money(item.paidAmount)}</td>
                <td>{money(item.pendingAmount)}</td>
                <td>{item.status}</td>
                <td>{item.paidDate ? item.paidDate.slice(0, 10) : "-"}</td>
                <td>{item.remark || "-"}</td>
              </tr>
            )) : <tr><td colSpan={7}>No payout history available yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </FacultyPortalLayout>
  );
}

function WeeklyAttendanceGrid({ token }: { token: string }) {
  const [weekStart, setWeekStart] = useState(toDateKey(getFridayWeekStart()));
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [grid, setGrid] = useState<FacultyAttendanceRow[]>([]);
  const [days, setDays] = useState<string[]>([]);
  const [weekLabel, setWeekLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`/api/faculty/attendance/week?weekStart=${weekStart}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || "Failed to load attendance.");
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setGrid(Array.isArray(json.grid) ? json.grid : []);
      setDays(Array.isArray(json.days) ? json.days : []);
      setWeekLabel(`${json.weekStart || weekStart} to ${json.weekEnd || ""}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load attendance.");
      setRows([]);
      setGrid([]);
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, [token, weekStart]);

  useEffect(() => {
    if (token) void load();
  }, [load, token]);

  const toggle = async (date: string, shift: string, present: boolean, facultyId?: string, canEdit = false) => {
    if (!canEdit) return;
    setMessage("");
    try {
      const res = await fetch("/api/faculty/attendance/week", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ facultyId, date, shift, present }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message || "Failed to update attendance.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to update attendance.");
    }
  };

  return (
    <section className="faculty-table-card">
      <div className="faculty-header faculty-header--compact">
        <div className="faculty-title-block">
          <h2>Weekly Attendance</h2>
          <p>{weekLabel || "Friday to Thursday"}</p>
        </div>
        <div className="ledger-nav">
          <button className="faculty-button faculty-button--ghost" onClick={() => setWeekStart(toDateKey(addDays(new Date(`${weekStart}T00:00:00.000Z`), -7)))}>Previous Week</button>
          <button className="faculty-button faculty-button--ghost" onClick={() => setWeekStart(toDateKey(getFridayWeekStart()))}>Current Week</button>
          <button className="faculty-button faculty-button--ghost" onClick={() => setWeekStart(toDateKey(addDays(new Date(`${weekStart}T00:00:00.000Z`), 7)))}>Next Week</button>
        </div>
      </div>
      {message ? <div className="faculty-toast--error">{message}</div> : null}
      <div className="faculty-table-wrap">
        <table className="faculty-table">
          <thead>
            <tr>
              <th>Faculty</th>
              {days.map((day) => (
                <th key={day} colSpan={3}>{day}</th>
              ))}
              <th>Weekly Total</th>
            </tr>
            <tr>
              <th></th>
              {days.flatMap((day) => shifts.map((shift) => <th key={`${day}-${shift}`}>{shift === "MORNING" ? "Morning" : shift === "AFTERNOON" ? "Afternoon" : "Evening"}</th>))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={23}>Loading attendance...</td></tr> : grid.length ? grid.map((row) => (
              <tr key={row.id}>
                <td>{row.fullName}<br /><small>{row.facultyId}</small></td>
                {days.flatMap((day) => shifts.map((shift) => {
                  const key = `${day}_${shift}`;
                  const cell = row.shifts[key] || { present: false, amount: 0 };
                  return (
                    <td key={`${row.id}-${key}`}>
                      <button
                        className={`faculty-shift-btn ${cell.present ? "present" : "absent"}`}
                        disabled={!row.canEdit}
                        onClick={() => toggle(day, shift, !cell.present, row.id, row.canEdit)}
                        title={row.canEdit ? "Update attendance" : "Read-only"}
                      >
                        {cell.present ? "Present" : "Absent"}<br />{money(cell.amount || 0)}
                      </button>
                    </td>
                  );
                }))}
                <td>{money(row.weeklyTotal || 0)}</td>
              </tr>
            )) : rows.length ? rows.map((row) => (
              <tr key={row.date}>
                <td>{row.date}</td>
                <td>{row.dayName}</td>
                <td colSpan={19}>Attendance data loaded in legacy format.</td>
                <td>{money(row.dailyTotal)}</td>
              </tr>
            )) : <tr><td colSpan={23}>No attendance records for this week.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function chartData(label: string, rows: { label: string; value: number }[], color: string) {
  const safeRows = rows.length ? rows : [{ label: "-", value: 0 }];
  return {
    labels: safeRows.map((item) => item.label),
    datasets: [{ label, data: safeRows.map((item) => item.value), borderColor: color, backgroundColor: `${color}33`, tension: 0.32 }],
  };
}

function PortalCard({ title, value, meta }: { title: string; value: string; meta: string }) {
  return (
    <article className="faculty-stat-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="faculty-detail-item"><span>{label}</span><strong>{value}</strong></div>;
}
