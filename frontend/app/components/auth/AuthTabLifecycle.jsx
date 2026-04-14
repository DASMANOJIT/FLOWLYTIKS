"use client";

import { useEffect } from "react";
import { getAuthToken } from "../../../lib/authStorage.js";

const API_BASE = "";
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export default function AuthTabLifecycle() {
  useEffect(() => {
    const sendHeartbeat = () => {
      const token = getAuthToken();
      if (!token) return;

      fetch(`${API_BASE}/api/auth/heartbeat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }).catch(() => {});
    };

    const handlePageHide = () => {
      const token = getAuthToken();
      if (!token) return;

      fetch(`${API_BASE}/api/auth/tab-close`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        keepalive: true,
        cache: "no-store",
      }).catch(() => {});
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
