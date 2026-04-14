"use client";

const AUTH_TOKEN_KEY = "token";
const AUTH_NAME_KEY = "studentName";
const LEGACY_KEYS = [AUTH_TOKEN_KEY, AUTH_NAME_KEY];

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

export const storeAuthSession = ({ token, name }) => {
  const sessionStorageRef = getBrowserStorage("session");
  if (!sessionStorageRef) return;

  clearLegacyAuthStorage();

  sessionStorageRef.setItem(AUTH_TOKEN_KEY, String(token || ""));

  if (name) {
    sessionStorageRef.setItem(AUTH_NAME_KEY, String(name));
  } else {
    sessionStorageRef.removeItem(AUTH_NAME_KEY);
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
