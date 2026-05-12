"use client";

const AUTH_TOKEN_KEY = "token";
const AUTH_NAME_KEY = "studentName";
const AUTH_ROLE_KEY = "authRole";
const ADMIN_CHAT_HISTORY_PREFIX = "flowlytiks_admin_chat_history_";
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

export const clearSessionStorageByPrefix = (prefix) => {
  const sessionStorageRef = getBrowserStorage("session");
  if (!sessionStorageRef || !prefix) return;

  const keysToRemove = [];
  for (let index = 0; index < sessionStorageRef.length; index += 1) {
    const key = sessionStorageRef.key(index);
    if (key && key.startsWith(prefix)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    sessionStorageRef.removeItem(key);
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

  clearSessionStorageByPrefix(ADMIN_CHAT_HISTORY_PREFIX);

  clearLegacyAuthStorage();
};

export const getAuthRole = () => {
  clearLegacyAuthStorage();
  const sessionStorageRef = getBrowserStorage("session");
  return sessionStorageRef?.getItem(AUTH_ROLE_KEY)?.trim() || "";
};

export const getAuthName = () => {
  clearLegacyAuthStorage();
  const sessionStorageRef = getBrowserStorage("session");
  return sessionStorageRef?.getItem(AUTH_NAME_KEY)?.trim() || "";
};

const decodeJwtPayload = (token) => {
  const rawToken = String(token || "").trim();
  if (!rawToken) return null;

  const parts = rawToken.split(".");
  if (parts.length < 2) return null;

  try {
    const normalizedPayload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(
      normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
      "="
    );
    const decoded =
      typeof window !== "undefined" && typeof window.atob === "function"
        ? window.atob(paddedPayload)
        : "";
    return decoded ? JSON.parse(decoded) : null;
  } catch {
    return null;
  }
};

export const getAuthUserId = () => {
  const payload = decodeJwtPayload(getAuthToken());
  const userId = payload?.id;

  if (typeof userId === "number" && Number.isFinite(userId)) {
    return String(userId);
  }

  if (typeof userId === "string" && userId.trim()) {
    return userId.trim();
  }

  return "";
};
