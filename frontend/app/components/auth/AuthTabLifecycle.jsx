"use client";

import { useEffect } from "react";
import {
  clearAuthSession,
  clearFacultyAuthSession,
  getAuthToken,
  getFacultyAuthToken,
} from "../../../lib/authStorage.js";

const API_BASE = "";
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export default function AuthTabLifecycle() {
  useEffect(() => {
    const getSessions = () =>
      [
        { role: "default", token: getAuthToken(), clear: clearAuthSession },
        { role: "faculty", token: getFacultyAuthToken(), clear: clearFacultyAuthSession },
      ].filter((session) => session.token);

    const expireSession = (session) => {
      session.clear();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    };

    const sendHeartbeat = () => {
      for (const session of getSessions()) {
        fetch(`${API_BASE}/api/auth/heartbeat`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${session.token}`,
          },
          cache: "no-store",
        })
          .then((response) => {
            if (response.status === 401) expireSession(session);
          })
          .catch(() => {});
      }
    };

    const handlePageHide = () => {
      for (const session of getSessions()) {
        fetch(`${API_BASE}/api/auth/session/close`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.token}`,
          },
          keepalive: true,
          cache: "no-store",
        }).catch(() => {});
      }
    };

    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  return null;
}
