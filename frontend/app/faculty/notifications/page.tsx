"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../../../lib/api.js";
import { getFacultyAuthToken } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import "../../admin/faculty/faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type Notification = {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
  channel?: string;
  status?: string;
  weekStart?: string | null;
  weekEnd?: string | null;
  whatsappLink?: string | null;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

const formatWeek = (start?: string | null, end?: string | null) => {
  if (!start && !end) return "";
  return `${start ? start.slice(0, 10) : "-"} to ${end ? end.slice(0, 10) : "-"}`;
};

export default function FacultyNotificationsPage() {
  const router = useRouter();
  const token = useMemo(() => getFacultyAuthToken(), []);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      router.push("/login");
      return;
    }
    callApi<{ notifications?: Notification[] }>("/faculty/notifications", "GET", null, token)
      .then((data) => setNotifications(data.notifications || []))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load notifications."))
      .finally(() => setLoading(false));
  }, [router, token]);

  return (
    <FacultyPortalLayout title="Notifications" subtitle="Payroll, attendance, and admin announcements.">
      {error ? <div className="faculty-toast--error">{error}</div> : null}
      <section className="faculty-panel faculty-notification-list">
        {loading ? <PremiumLoader label="Loading notifications" /> : notifications.length ? notifications.map((item) => (
          <article key={item.id} className={item.isRead ? "read" : "unread"}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.message}</p>
              {formatWeek(item.weekStart, item.weekEnd) ? <small>Week: {formatWeek(item.weekStart, item.weekEnd)}</small> : null}
              {item.whatsappLink ? <a href={item.whatsappLink} target="_blank" rel="noreferrer">Open WhatsApp message</a> : null}
            </div>
            <span>{formatDate(item.createdAt)}</span>
            <small>{item.channel || "IN_APP"} · {item.status || item.type}</small>
          </article>
        )) : <div className="faculty-empty-state">No notifications found.</div>}
      </section>
    </FacultyPortalLayout>
  );
}
