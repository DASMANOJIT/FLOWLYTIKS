"use client";

import { useEffect } from "react";
import {
  clearAuthSession,
  clearFacultyAuthSession,
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

const clearRoleSession = (role) => {
  if (role === "faculty") {
    clearFacultyAuthSession();
    return;
  }
  clearAuthSession();
};

export default function useSessionControl(role) {
  useEffect(() => {
    const expectedRole = String(role || "").trim();
    const token = resolveToken(expectedRole);
    const currentRole = getAuthRole();

    if (!token || (expectedRole && currentRole && currentRole !== expectedRole)) {
      clearRoleSession(expectedRole);
      window.location.href = LOGIN_ROUTE;
      return undefined;
    }

    const sendHeartbeat = () => {
      fetch("/api/auth/heartbeat", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
        .then((res) => {
          if (res.status === 401 || res.status === 403) {
            clearRoleSession(expectedRole);
            window.location.href = LOGIN_ROUTE;
          }
        })
        .catch(() => {});
    };

    const closeSession = () => {
      fetch("/api/auth/session/close", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
        cache: "no-store",
      }).catch(() => {});
    };

    sendHeartbeat();
    const intervalId = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    window.addEventListener("pagehide", closeSession);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("pagehide", closeSession);
    };
  }, [role]);
}
