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
import { getFacultyAuthToken, getFacultyAuthRole } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
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
  bankAccount?: {
    payoutMode?: string | null;
    verificationStatus?: string | null;
    payoutEligible?: boolean;
  } | null;
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
    transactionId?: string;
    remark: string;
  }[];
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);

export default function FacultyDashboardPage() {
  const router = useRouter();
  const [hasMounted, setHasMounted] = useState(false);
  const [token, setToken] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  const loadDashboard = useCallback((authToken: string) => {
    return callApi<Dashboard>("/faculty/dashboard-summary", "GET", null, authToken)
      .then(setDashboard)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard."));
  }, []);

  useEffect(() => {
    setHasMounted(true);
    const storedToken = getFacultyAuthToken();
    const role = getFacultyAuthRole();
    if (!storedToken || role !== "faculty") {
      router.push("/login");
      return;
    }
    setToken(storedToken);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    void loadDashboard(token);
  }, [loadDashboard, token]);

  if (!hasMounted || (!dashboard && !error)) {
    return <FacultyPortalLayout title="Dashboard"><section className="faculty-panel faculty-loading"><PremiumLoader label="Loading dashboard" /></section></FacultyPortalLayout>;
  }

  if (error) {
    return <FacultyPortalLayout title="Dashboard"><div className="faculty-toast--error">{error}</div></FacultyPortalLayout>;
  }

  if (!dashboard) {
    return <FacultyPortalLayout title="Dashboard"><section className="faculty-panel faculty-empty">No dashboard data available.</section></FacultyPortalLayout>;
  }

  const weeklyChart = chartData("Weekly Income", dashboard.charts.weekly, "#2563eb");
  const monthlyChart = chartData("Monthly Income", dashboard.charts.monthly, "#15803d");

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

      <section className="faculty-portal-chart-grid">
        <div className="faculty-panel"><h2>Weekly Income</h2><Bar data={weeklyChart} /></div>
        <div className="faculty-panel"><h2>Monthly Income</h2><Line data={monthlyChart} /></div>
      </section>

      <section className="faculty-table-card">
        <h2>Payout History</h2>
        <table className="faculty-table">
          <thead>
            <tr><th>Week Period</th><th>Payable Amount</th><th>Paid Amount</th><th>Pending Amount</th><th>Status</th><th>UTR / Transaction</th><th>Paid Date</th><th>Remark</th></tr>
          </thead>
          <tbody>
            {dashboard.payoutHistory.length ? dashboard.payoutHistory.map((item) => (
              <tr key={item.id}>
                <td>{item.weekPeriod}</td>
                <td>{money(item.totalAttendanceAmount)}</td>
                <td>{money(item.paidAmount)}</td>
                <td>{money(item.pendingAmount)}</td>
                <td>{item.status}</td>
                <td>{item.transactionId || "-"}</td>
                <td>{item.paidDate ? item.paidDate.slice(0, 10) : "-"}</td>
                <td>{item.remark || "-"}</td>
              </tr>
            )) : <tr><td colSpan={8}>No payout history available yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </FacultyPortalLayout>
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
