"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../../../lib/api.js";
import { getAuthToken } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import "../../admin/faculty/faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type Entry = { id: string; date: string; subject: string; classesTaken: number; hoursWorked: number; remarks: string };
type LedgerResponse = { entries: Entry[]; summary: { totalClasses: number; totalHours: number } };

export default function FacultyWorkLedgerPage() {
  const router = useRouter();
  const token = useMemo(() => getAuthToken(), []);
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      router.push("/faculty/login");
      return;
    }
    const params = new URLSearchParams();
    if (startDate && endDate) {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    } else {
      params.set("month", month);
      params.set("year", String(now.getFullYear()));
    }
    callApi<LedgerResponse>(`/faculty/work-ledger?${params}`, "GET", null, token)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load work ledger."));
  }, [endDate, month, router, startDate, token]);

  return (
    <FacultyPortalLayout title="Work Ledger" subtitle="Your classes, hours, and remarks.">
      <section className="faculty-panel faculty-filter-bar">
        <div className="faculty-field"><label>Month</label><input type="number" min="1" max="12" value={month} onChange={(event) => setMonth(event.target.value)} /></div>
        <div className="faculty-field"><label>Start Date</label><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
        <div className="faculty-field"><label>End Date</label><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
      </section>
      {error ? <div className="faculty-toast--error">{error}</div> : null}
      <section className="faculty-stats-grid">
        <article className="faculty-stat-card"><span>Total Classes</span><strong>{data?.summary.totalClasses || 0}</strong></article>
        <article className="faculty-stat-card"><span>Total Hours</span><strong>{data?.summary.totalHours || 0}</strong></article>
      </section>
      <section className="faculty-table-card">
        <table className="faculty-table">
          <thead><tr><th>Date</th><th>Subject</th><th>Classes Taken</th><th>Hours Worked</th><th>Remarks</th></tr></thead>
          <tbody>
            {data?.entries.length ? data.entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.date}</td><td>{entry.subject}</td><td>{entry.classesTaken}</td><td>{entry.hoursWorked}</td><td>{entry.remarks || "-"}</td>
              </tr>
            )) : <tr><td colSpan={5}>No work ledger entries found.</td></tr>}
          </tbody>
        </table>
      </section>
    </FacultyPortalLayout>
  );
}
