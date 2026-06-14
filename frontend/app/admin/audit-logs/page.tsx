"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { apiCall } from "../../../lib/api.js";
import { getAuthToken } from "../../../lib/authStorage.js";
import "../faculty/faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type AuditLog = {
  id: string;
  actorType: string;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  description?: string | null;
  metadataJson?: Record<string, unknown> | null;
  ipAddress?: string | null;
  createdAt: string;
};

type AuditResponse = {
  logs?: AuditLog[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
};

const ACTOR_TYPES = ["all", "ADMIN", "FACULTY", "STUDENT", "SYSTEM"];

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

export default function AdminAuditLogsPage() {
  const token = useMemo(() => getAuthToken(), []);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actorType, setActorType] = useState("all");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadLogs = useCallback(async (page = pagination.page) => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", String(pagination.limit));
      if (actorType !== "all") params.set("actorType", actorType);
      if (action.trim()) params.set("action", action.trim());
      if (entityType.trim()) params.set("entityType", entityType.trim());
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const data = await callApi<AuditResponse>(`/audit-logs?${params.toString()}`, "GET", null, token);
      setLogs(data.logs || []);
      setPagination(data.pagination || { page, limit: 50, total: 0, totalPages: 1 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs.");
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [action, actorType, endDate, entityType, pagination.limit, pagination.page, startDate, token]);

  useEffect(() => {
    loadLogs(1);
  }, [actorType, action, entityType, startDate, endDate]);

  const resetFilters = () => {
    setActorType("all");
    setAction("");
    setEntityType("");
    setStartDate("");
    setEndDate("");
  };

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <div className="faculty-title-block">
            <Link href="/admin" className="faculty-back-link"><ArrowLeft size={18} /> Admin Dashboard</Link>
            <h1>Audit Logs</h1>
            <p>Review critical admin, faculty, payroll, payout, report, and attendance actions.</p>
          </div>
          <button className="faculty-button faculty-button--ghost" onClick={() => loadLogs()} disabled={loading}>
            <RefreshCw size={17} /> Refresh
          </button>
        </header>

        <section className="faculty-panel reports-filter-panel">
          <div className="faculty-form-grid">
            <label className="faculty-field">
              <span>Actor</span>
              <select value={actorType} onChange={(event) => setActorType(event.target.value)}>
                {ACTOR_TYPES.map((item) => <option key={item} value={item}>{item === "all" ? "All actors" : item}</option>)}
              </select>
            </label>
            <label className="faculty-field">
              <span>Action</span>
              <input value={action} onChange={(event) => setAction(event.target.value)} placeholder="PAYROLL_GENERATED" />
            </label>
            <label className="faculty-field">
              <span>Entity</span>
              <input value={entityType} onChange={(event) => setEntityType(event.target.value)} placeholder="FacultyPayout" />
            </label>
            <label className="faculty-field">
              <span>Start Date</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="faculty-field">
              <span>End Date</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
          </div>
          <button className="faculty-button faculty-button--ghost" onClick={resetFilters} disabled={loading}>Reset Filters</button>
        </section>

        {error ? <p className="faculty-toast--error">{error}</p> : null}

        <section className="faculty-panel reports-table-panel">
          <div className="faculty-section-heading">
            <div>
              <h2>Audit Events</h2>
              <p>{pagination.total} event{pagination.total === 1 ? "" : "s"} found.</p>
            </div>
          </div>
          <div className="faculty-table-wrap">
            <table className="faculty-table reports-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Description</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6}>Loading audit logs...</td></tr>
                ) : logs.length ? logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDate(log.createdAt)}</td>
                    <td>{log.actorType}<br /><small>{log.actorName || log.actorId || "-"}</small></td>
                    <td><strong>{log.action}</strong></td>
                    <td>{log.entityType}<br /><small>{log.entityId || "-"}</small></td>
                    <td>{log.description || "-"}</td>
                    <td>{log.ipAddress || "-"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6}>No audit logs found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="faculty-pagination">
            <button className="faculty-button faculty-button--ghost" disabled={pagination.page <= 1 || loading} onClick={() => loadLogs(pagination.page - 1)}>Previous</button>
            <span>Page {pagination.page} of {pagination.totalPages}</span>
            <button className="faculty-button faculty-button--ghost" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => loadLogs(pagination.page + 1)}>Next</button>
          </div>
        </section>
      </div>
    </main>
  );
}
