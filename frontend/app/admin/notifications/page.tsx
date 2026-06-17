"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { apiCall } from "../../../lib/api.js";
import { getAuthToken } from "../../../lib/authStorage.js";
import "../faculty/faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type NotificationLog = {
  id: string;
  recipientType: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  channel: string;
  eventType: string;
  title: string;
  message: string;
  status: string;
  errorMessage?: string | null;
  whatsappLink?: string | null;
  relatedWeekStart?: string | null;
  relatedWeekEnd?: string | null;
  createdAt: string;
  sentAt?: string | null;
};

const EVENT_OPTIONS = ["all", "PAYROLL_GENERATED", "PAYOUT_INITIATED", "PAYOUT_SUCCESS", "PAYOUT_FAILED", "LEDGER_LOCKED"];
const CHANNEL_OPTIONS = ["all", "EMAIL", "WHATSAPP"];
const STATUS_OPTIONS = ["all", "PENDING", "PENDING_MANUAL", "SENT", "FAILED", "SKIPPED"];

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const formatWeek = (start?: string | null, end?: string | null) => {
  if (!start && !end) return "-";
  return `${start ? start.slice(0, 10) : "-"} to ${end ? end.slice(0, 10) : "-"}`;
};

export default function AdminNotificationsPage() {
  const token = useMemo(() => getAuthToken(), []);
  const [notifications, setNotifications] = useState<NotificationLog[]>([]);
  const [eventType, setEventType] = useState("all");
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadNotifications = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (eventType !== "all") params.set("eventType", eventType);
      if (channel !== "all") params.set("channel", channel);
      if (status !== "all") params.set("status", status);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const data = await callApi<{ notifications?: NotificationLog[] }>(`/notifications/admin${suffix}`, "GET", null, token);
      setNotifications(data.notifications || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [channel, eventType, status, token]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <div className="faculty-title-block">
            <Link href="/admin" className="faculty-back-link"><ArrowLeft size={18} /> Admin Dashboard</Link>
            <h1>Notifications</h1>
            <p>Email and WhatsApp alerts for payroll, payout, and ledger events.</p>
          </div>
          <button type="button" className="faculty-button faculty-button--ghost" onClick={loadNotifications} disabled={loading}>
            <RefreshCw size={17} /> Refresh
          </button>
        </header>

        <section className="faculty-panel notification-filter-bar">
          <label>
            Event
            <select value={eventType} onChange={(event) => setEventType(event.target.value)}>
              {EVENT_OPTIONS.map((option) => <option key={option} value={option}>{option === "all" ? "All events" : option}</option>)}
            </select>
          </label>
          <label>
            Channel
            <select value={channel} onChange={(event) => setChannel(event.target.value)}>
              {CHANNEL_OPTIONS.map((option) => <option key={option} value={option}>{option === "all" ? "All channels" : option}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option === "all" ? "All statuses" : option}</option>)}
            </select>
          </label>
        </section>

        {error ? <div className="faculty-toast--error">{error}</div> : null}

        <section className="faculty-panel notification-log-table">
          {loading ? (
            <div className="faculty-empty-state">Loading notification logs...</div>
          ) : notifications.length ? (
            <div className="faculty-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Recipient</th>
                    <th>Channel</th>
                    <th>Status</th>
                    <th>Week</th>
                    <th>Message</th>
                    <th>Created</th>
                    <th>Sent</th>
                    <th>WhatsApp</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.eventType}</strong></td>
                      <td>{item.recipientType}<br /><small>{item.recipientEmail || item.recipientPhone || "-"}</small></td>
                      <td>{item.channel}</td>
                      <td><span className={`notification-status notification-status--${item.status.toLowerCase().replace("_", "-")}`}>{item.status}</span></td>
                      <td>{formatWeek(item.relatedWeekStart, item.relatedWeekEnd)}</td>
                      <td>
                        <strong>{item.title}</strong>
                        <p>{item.errorMessage || item.message}</p>
                      </td>
                      <td>{formatDate(item.createdAt)}</td>
                      <td>{formatDate(item.sentAt)}</td>
                      <td>{item.whatsappLink ? <a href={item.whatsappLink} target="_blank" rel="noreferrer">Open</a> : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="faculty-empty-state">No notification logs found.</div>
          )}
        </section>
      </div>
    </main>
  );
}
