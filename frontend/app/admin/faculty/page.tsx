"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Gift } from "lucide-react";
import BackToDashboard from "../../components/admin/BackToDashboard";
import { getAuthToken } from "../../../lib/authStorage.js";
import { apiCall } from "../../../lib/api.js";
import FacultyActions, { type Faculty } from "./FacultyActions";
import PremiumLoader from "../../components/ui/PremiumLoader";
import "./faculty.css";

type SalaryType = "MONTHLY_FIXED" | "PER_CLASS" | "ATTENDANCE_BASED";
type ApiCall = <T = unknown>(
  endpoint: string,
  method?: string,
  body?: unknown,
  token?: string | null
) => Promise<T>;

const callApi = apiCall as ApiCall;

type FacultyListResponse = {
  data?: {
    faculty?: Faculty[];
    faculties?: Faculty[];
    stats?: {
      totalFaculty: number;
      activeFaculty: number;
      inactiveFaculty: number;
    };
    pagination?: {
      totalPages?: number;
    };
  };
  faculty?: Faculty[];
  faculties?: Faculty[];
  stats?: {
    totalFaculty: number;
    activeFaculty: number;
    inactiveFaculty: number;
  };
  pagination?: {
    totalPages?: number;
  };
};

const salaryTypeLabels: Record<SalaryType, string> = {
  MONTHLY_FIXED: "Monthly Fixed",
  PER_CLASS: "Per Class",
  ATTENDANCE_BASED: "Attendance Based",
};

export default function FacultyManagementPage() {
  const router = useRouter();
  const [faculty, setFaculty] = useState<Faculty[]>([]);
  const [stats, setStats] = useState({
    totalFaculty: 0,
    activeFaculty: 0,
    inactiveFaculty: 0,
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchName, setSearchName] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [billing, setBilling] = useState<{ weekStart: string; weekEnd: string; totalWeeklyAmount: number; unpaidExtraIncentives: number } | null>(null);
  const [billingError, setBillingError] = useState("");
  const [ready, setReady] = useState(false);
  const savedScroll = useRef<number | null>(null);
  const token = useMemo(() => getAuthToken(), []);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("faculty-list-state") || "null");
      if (saved) {
        setPage(saved.page || 1); setSearchName(saved.searchName || ""); setSearchPhone(saved.searchPhone || ""); setStatus(saved.status || "all");
        savedScroll.current = Number(saved.scrollY) || 0;
      }
    } catch { /* Unavailable browser storage must not prevent navigation. */ }
    setReady(true);
  }, []);

  const openProfile = (row: Faculty) => {
    try { sessionStorage.setItem("faculty-list-state", JSON.stringify({ page, searchName, searchPhone, status, scrollY: window.scrollY })); } catch { /* Navigation also works without storage. */ }
    router.push(`/admin/faculty/${row.id}`);
  };

  useEffect(() => {
    const controller = new AbortController();
    void callApi<typeof billing>("/admin/faculty-billing-summary", "GET", null, token || getAuthToken()).then(data => {
      if (!controller.signal.aborted) setBilling(data);
    }).catch(error => { if (!controller.signal.aborted) setBillingError(error instanceof Error ? error.message : "Billing totals unavailable."); });
    return () => controller.abort();
  }, [token]);

  const loadFaculty = useCallback(async () => {
    const effectiveToken = token || getAuthToken();
    if (!effectiveToken) {
      router.push("/login");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "10",
        searchName,
        searchPhone,
        status,
      });
      const data = await callApi<FacultyListResponse>(`/faculty?${params.toString()}`, "GET", null, effectiveToken);
      const payload = data?.data || data;

      // Support multiple possible API shapes for robustness:
      // { faculty: [...] } or { faculties: [...] } or raw array returned directly
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const list = Array.isArray((payload as any)?.faculty)
        ? (payload as any).faculty
        : Array.isArray((payload as any).faculties)
        ? (payload as any).faculties
        : Array.isArray(data)
        ? (data as any)
        : [];
      /* eslint-enable @typescript-eslint/no-explicit-any */

      setFaculty(list);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  setStats(((payload as any)?.stats) || { totalFaculty: 0, activeFaculty: 0, inactiveFaculty: 0 });
  setTotalPages(Number(((payload as any)?.pagination?.totalPages) || 1));
  /* eslint-enable @typescript-eslint/no-explicit-any */
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : "Failed to load faculty.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [page, router, searchName, searchPhone, status, token]);

  useEffect(() => {
    if (ready) void loadFaculty();
  }, [loadFaculty, ready]);

  useEffect(() => {
    if (!loading && savedScroll.current !== null) {
      const scrollY = savedScroll.current;
      savedScroll.current = null;
      const frame = requestAnimationFrame(() => window.scrollTo(0, scrollY));
      return () => cancelAnimationFrame(frame);
    }
  }, [loading]);

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <BackToDashboard />
          <div className="faculty-title-block">
            <h1>Faculty Management</h1>
            <p>Maintain faculty records as the source of truth for later attendance and payout phases.</p>
          </div>
          <FacultyActions onSaved={loadFaculty} />
        </header>

        <div className="ledger-nav">
          <Link className="faculty-button faculty-button--soft" href="/admin/faculty/work-ledger">
            <BookOpen size={18} />
            Work Ledger
          </Link>
          <Link className="faculty-button faculty-button--soft" href="/admin/faculty/extra-incentives">
            <Gift size={18} />
            EXTRA INCENTIVES
          </Link>
        </div>

        <section className="faculty-stats faculty-management-stats" aria-label="Faculty statistics">
          <div className="faculty-stat-card">
            <span>Total Faculty</span>
            <strong>{stats.totalFaculty}</strong>
          </div>
          <div className="faculty-stat-card">
            <span>Active Faculty</span>
            <strong>{stats.activeFaculty}</strong>
          </div>
          <div className="faculty-stat-card">
            <span>Inactive Faculty</span>
            <strong>{stats.inactiveFaculty}</strong>
          </div>
          <div className="faculty-stat-card">
            <span>Total Weekly Amount</span>
            <strong>{billing ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(billing.totalWeeklyAmount) : "—"}</strong>
            {billing && <small>{billing.weekStart} – {billing.weekEnd}</small>}
          </div>
          <div className="faculty-stat-card">
            <span>Total Unpaid Extra Incentives</span>
            <strong>{billing ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(billing.unpaidExtraIncentives) : "—"}</strong>
            <small>All weeks</small>
          </div>
        </section>
        {billingError && <p className="faculty-error" role="alert">{billingError}</p>}

        <section className="faculty-panel">
          <div className="faculty-toolbar">
            <div className="faculty-field">
              <label htmlFor="search-name">Search by name</label>
              <input
                id="search-name"
                value={searchName}
                onChange={(event) => { setSearchName(event.target.value); setPage(1); }}
                placeholder="Full name"
              />
            </div>
            <div className="faculty-field">
              <label htmlFor="search-phone">Search by phone</label>
              <input
                id="search-phone"
                value={searchPhone}
                onChange={(event) => { setSearchPhone(event.target.value); setPage(1); }}
                placeholder="Phone number"
              />
            </div>
            <div className="faculty-field">
              <label htmlFor="status-filter">Status</label>
              <select
                id="status-filter"
                value={status}
                onChange={(event) => { setStatus(event.target.value); setPage(1); }}
              >
                <option value="all">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>

          {loading ? (
            <div className="faculty-loading"><PremiumLoader label="Loading faculty records" /></div>
          ) : error ? (
            <div className="faculty-error">{error}</div>
          ) : faculty.length === 0 ? (
            <div className="faculty-empty">No faculty records found.</div>
          ) : (
            <div className="faculty-table-wrap">
              <table className="faculty-table">
                <thead>
                  <tr>
                    <th>Faculty ID</th>
                    <th>Full Name</th>
                    <th>Phone Number</th>
                    <th>Email</th>
                    <th>Salary Type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {faculty.map((row) => (
                    <tr
                      key={row.id}
                      className="faculty-row--clickable"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openProfile(row);
                        }
                      }}
                      onClick={(e) => {
                        const target = e.target;
                        const interactive = (target instanceof HTMLElement) && (target.closest("button") || target.closest("a") || target.closest("input") || target.closest("select"));
                        if (interactive) return;
                        openProfile(row);
                      }}
                    >
                      <td>{row.facultyId}</td>
                      <td>{row.fullName}</td>
                      <td>{row.phone}</td>
                      <td>{row.email || "-"}</td>
                      <td>{salaryTypeLabels[row.salaryType]}</td>
                      <td>
                        <span className={`faculty-status faculty-status--${row.status}`}>
                          {row.status === "ACTIVE" ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="faculty-pagination">
            <button
              className="faculty-button faculty-button--ghost"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(current - 1, 1))}
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              className="faculty-button faculty-button--ghost"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((current) => Math.min(current + 1, totalPages))}
            >
              Next
            </button>
          </div>
        </section>
      </div>

    </main>
  );
}
