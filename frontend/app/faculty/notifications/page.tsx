"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../../../lib/api.js";
import { getAuthToken } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
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
};

export default function FacultyNotificationsPage() {
  const router = useRouter();
  const token = useMemo(() => getAuthToken(), []);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      router.push("/faculty/login");
      return;
    }
    callApi<{ notifications?: Notification[] }>("/faculty/notifications", "GET", null, token)
      .then((data) => setNotifications(data.notifications || []))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load notifications."));
  }, [router, token]);

  return (
    <FacultyPortalLayout title="Notifications" subtitle="Payroll, attendance, and admin announcements.">
      {error ? <div className="faculty-toast--error">{error}</div> : null}
      <section className="faculty-panel faculty-notification-list">
        {notifications.length ? notifications.map((item) => (
          <article key={item.id} className={item.isRead ? "read" : "unread"}>
            <div>
              <strong>{item.title}</strong>
              <p>{item.message}</p>
            </div>
            <span>{new Date(item.createdAt).toLocaleDateString()}</span>
            <small>{item.type}</small>
          </article>
        )) : <div className="faculty-empty-state">No notifications found.</div>}
      </section>
    </FacultyPortalLayout>
  );
}
