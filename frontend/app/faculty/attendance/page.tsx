"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../../../lib/api.js";
import { getAuthToken } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import "../../admin/faculty/faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type Day = { date: string; status: "PRESENT" | "HALF_DAY" | "ABSENT"; shiftCount: number };
type AttendanceResponse = {
  attendance: {
    presentDays: number;
    halfDays: number;
    absentDays: number;
    attendancePercentage: number;
    calendar: Day[];
  };
};

export default function FacultyAttendancePage() {
  const router = useRouter();
  const token = useMemo(() => getAuthToken(), []);
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [data, setData] = useState<AttendanceResponse["attendance"] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      router.push("/faculty/login");
      return;
    }
    const params = new URLSearchParams({ month, year });
    callApi<AttendanceResponse>(`/faculty/attendance?${params}`, "GET", null, token)
      .then((res) => setData(res.attendance))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load attendance."));
  }, [month, router, token, year]);

  return (
    <FacultyPortalLayout title="Attendance" subtitle="Monthly attendance calendar and summary.">
      <section className="faculty-panel faculty-filter-bar">
        <div className="faculty-field"><label>Month</label><input type="number" min="1" max="12" value={month} onChange={(event) => setMonth(event.target.value)} /></div>
        <div className="faculty-field"><label>Year</label><input type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} /></div>
      </section>
      {error ? <div className="faculty-toast--error">{error}</div> : null}
      {data ? (
        <>
          <section className="faculty-stats-grid">
            <Summary title="Present" value={data.presentDays} />
            <Summary title="Half Day" value={data.halfDays} />
            <Summary title="Absent" value={data.absentDays} />
            <Summary title="Attendance" value={`${data.attendancePercentage}%`} />
          </section>
          <section className="faculty-panel faculty-calendar-grid">
            {data.calendar.map((day) => (
              <div key={day.date} className={`faculty-calendar-day ${day.status.toLowerCase()}`}>
                <strong>{day.date.slice(-2)}</strong>
                <span>{day.status.replace("_", " ")}</span>
              </div>
            ))}
          </section>
        </>
      ) : <section className="faculty-panel faculty-loading">Loading attendance...</section>}
    </FacultyPortalLayout>
  );
}

function Summary({ title, value }: { title: string; value: number | string }) {
  return <article className="faculty-stat-card"><span>{title}</span><strong>{value}</strong></article>;
}
