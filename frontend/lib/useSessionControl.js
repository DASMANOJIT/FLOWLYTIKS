"use client";

import { useEffect } from "react";
import {
  clearAuthSessionForUnauthorizedResponse,
  getAuthRole,
  getAuthToken,
  getFacultyAuthToken,
} from "./authStorage.js";

const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const LOGIN_ROUTE = "/login";

const resolveToken = (role) => {
  if (role === "faculty") return getFacultyAuthToken();
  return getAuthToken();
};

export default function useSessionControl(role) {
  useEffect(() => {
    const expectedRole = String(role || "").trim();
    const token = resolveToken(expectedRole);
    const currentRole = getAuthRole();

    if (!token || (expectedRole && currentRole && currentRole !== expectedRole)) {
      window.location.href = LOGIN_ROUTE;
      return undefined;
    }

    const controller = new AbortController();
    let pending = false;
    const sendHeartbeat = () => {
      if (pending || getAuthToken() !== token) return;
      pending = true;
      fetch("/api/auth/heartbeat", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      })
        .then((res) => {
          if (!controller.signal.aborted && clearAuthSessionForUnauthorizedResponse(res.status, token, expectedRole)) {
            window.location.href = LOGIN_ROUTE;
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
  }, [role]);
}
