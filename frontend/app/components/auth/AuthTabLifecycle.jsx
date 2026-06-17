"use client";

import { useEffect } from "react";
import { clearAuthSession, getAuthToken } from "../../../lib/authStorage.js";
import { getApiBaseUrl } from "../../../lib/api.js";

const API_BASE = getApiBaseUrl();
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export default function AuthTabLifecycle() {
  useEffect(() => {
    const sendHeartbeat = () => {
      const token = getAuthToken();
      if (!token) return;

      fetch(`${API_BASE}/api/auth/heartbeat`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      })
        .then((res) => {
          if (res.status === 401 || res.status === 403) {
            clearAuthSession();
            window.location.href = "/login";
          }
        })
        .catch(() => {});
    };

    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return null;
}
