"use client";

const AUTH_TOKEN_KEY = "token";
const AUTH_NAME_KEY = "studentName";
const AUTH_ROLE_KEY = "authRole";
const LEGACY_KEYS = [AUTH_TOKEN_KEY, AUTH_NAME_KEY, AUTH_ROLE_KEY];

const getBrowserStorage = (kind) => {
  if (typeof window === "undefined") return null;

  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

export const clearLegacyAuthStorage = () => {
  const legacyStorage = getBrowserStorage("local");
  if (!legacyStorage) return;

  for (const key of LEGACY_KEYS) {
    legacyStorage.removeItem(key);
  }
};

export const storeAuthSession = ({ token, name, role }) => {
  const sessionStorageRef = getBrowserStorage("session");
  if (!sessionStorageRef) return;

  clearLegacyAuthStorage();

  sessionStorageRef.setItem(AUTH_TOKEN_KEY, String(token || ""));

  if (name) {
    sessionStorageRef.setItem(AUTH_NAME_KEY, String(name));
  } else {
    sessionStorageRef.removeItem(AUTH_NAME_KEY);
  }

  if (role) {
    sessionStorageRef.setItem(AUTH_ROLE_KEY, String(role));
  } else {
    sessionStorageRef.removeItem(AUTH_ROLE_KEY);
  }
};

export const getAuthToken = () => {
  clearLegacyAuthStorage();
  const sessionStorageRef = getBrowserStorage("session");
  return sessionStorageRef?.getItem(AUTH_TOKEN_KEY)?.trim() || "";
};

export const clearAuthSession = () => {
  const sessionStorageRef = getBrowserStorage("session");
  if (sessionStorageRef) {
    for (const key of LEGACY_KEYS) {
      sessionStorageRef.removeItem(key);
    }
  }

  clearLegacyAuthStorage();
};

export const getAuthRole = () => {
  clearLegacyAuthStorage();
  const sessionStorageRef = getBrowserStorage("session");
  return sessionStorageRef?.getItem(AUTH_ROLE_KEY)?.trim() || "";
};
