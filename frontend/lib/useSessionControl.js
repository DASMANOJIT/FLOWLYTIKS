"use client";

import { useEffect } from "react";
import {
  clearAuthSession,
  clearFacultyAuthSession,
  getAuthToken,
  getFacultyAuthToken,
} from "./authStorage.js";

const API_BASE = "";
const HEARTBEAT_INTERVAL_MS = 90 * 1000;
const MAIN_LOGIN_ROUTE = "/login";

const getTokenForRole = (role) =>
  role === "faculty" ? getFacultyAuthToken() : getAuthToken();

const clearRoleSession = (role) => {
  if (role === "faculty") clearFacultyAuthSession();
  else clearAuthSession();
};

const redirectToLogin = () => {
  if (typeof window !== "undefined" && window.location.pathname !== MAIN_LOGIN_ROUTE) {
    window.location.href = MAIN_LOGIN_ROUTE;
  }
};

export default function useSessionControl(role, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;

    let stopped = false;
    let inFlight = false;

    const expireLocally = () => {
      clearRoleSession(role);
      redirectToLogin();
    };

    const heartbeat = async () => {
      const token = getTokenForRole(role);
      if (!token || stopped || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`${API_BASE}/api/auth/heartbeat`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 401) {
          expireLocally();
        }
      } catch {
        // Network blips should not logout users immediately; the server expiry remains authoritative.
      } finally {
        inFlight = false;
      }
    };

    const closeSessionBestEffort = () => {
      const token = getTokenForRole(role);
      if (!token) return;
      try {
        fetch(`${API_BASE}/api/auth/session/close`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Browser close events are best effort only.
      }
    };

    void heartbeat();
    const intervalId = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        closeSessionBestEffort();
      } else {
        void heartbeat();
      }
    };
    window.addEventListener("pagehide", closeSessionBestEffort);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
      window.removeEventListener("pagehide", closeSessionBestEffort);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, role]);
}
