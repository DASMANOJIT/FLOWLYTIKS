"use client";

import { useEffect } from "react";
import { clearAuthSessionForUnauthorizedResponse, getAuthToken } from "../../../lib/authStorage.js";
import { getApiBaseUrl } from "../../../lib/api.js";

const API_BASE = getApiBaseUrl();
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export default function AuthTabLifecycle() {
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const sendHeartbeat = () => {
      const token = getAuthToken();
      if (!token || pending) return;
      pending = true;

      fetch(`${API_BASE}/api/auth/heartbeat`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        signal: controller.signal,
      })
        .then((res) => {
          if (!controller.signal.aborted && clearAuthSessionForUnauthorizedResponse(res.status, token)) {
            window.location.href = "/login";
          }
        })
        .catch(() => {})
        .finally(() => { pending = false; });
    };

    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
      controller.abort();
    };
  }, []);

  return null;
}
