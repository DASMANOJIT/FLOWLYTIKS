import axios from "axios";

const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/+$/, "");

let hasLoggedApiBase = false;

export function getApiBaseUrl() {
  return normalizeBaseUrl(process.env.NEXT_PUBLIC_API_URL);
}

export function buildApiUrl(path = "") {
  const value = String(path || "");
  if (/^https?:\/\//i.test(value)) return value;

  const apiBaseUrl = getApiBaseUrl();
  const normalizedPath = value.startsWith("/") ? value : `/${value}`;

  if (!apiBaseUrl) return normalizedPath;
  return `${apiBaseUrl}${normalizedPath}`;
}

export async function apiFetch(path, options = {}) {
  if (process.env.NODE_ENV !== "production" && !hasLoggedApiBase) {
    hasLoggedApiBase = true;
    console.log("API base URL:", getApiBaseUrl() || "relative /api");
  }

  const headers = options.headers || {};
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  return fetch(buildApiUrl(path), {
    ...options,
    credentials: options.credentials || "include",
    headers: isFormData
      ? headers
      : {
          "Content-Type": "application/json",
          ...headers,
        },
  });
}

const API = buildApiUrl("/api");

const isProbablyHtml = (value) => /<!doctype html|<html/i.test(String(value || ""));

const normalizeApiMessage = (value, fallback) => {
  const text = String(value || "").trim();
  if (!text || isProbablyHtml(text) || /^internal server error$/i.test(text)) {
    return fallback;
  }
  return text;
};

export async function readApiResponse(res, fallbackMessage = "Request failed. Please try again.") {
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    const data = await res.json().catch(() => ({}));
    const message = normalizeApiMessage(data?.error || data?.message, fallbackMessage);
    return {
      ok: res.ok,
      data,
      error: message,
    };
  }

  const text = await res.text().catch(() => "");
  return {
    ok: res.ok,
    data: { success: res.ok, error: text, message: text },
    error: normalizeApiMessage(text, fallbackMessage),
  };
}


export const loginApi = (email, password) =>
axios.post(`${API}/auth/login`, { email, password }).then((r) => r.data);


export const getStudents = () => axios.get(`${API}/students`).then((r) => r.data);
export const createStudent = (data) => axios.post(`${API}/students`, data).then((r) => r.data);
export const deleteStudent = (id) => axios.delete(`${API}/students/${id}`).then((r) => r.data);


export const createOrder = (data) =>
  axios.post(`${API}/payments/cashfree/create-order`, data).then((r) => r.data);
export const verifyPayment = (data) =>
  axios.post(`${API}/payments/cashfree/verify`, data).then((r) => r.data);
const BASE_URL = API;

export async function apiCall(endpoint, method = "GET", body = null, token = null) {
  const headers = { "Content-Type": "application/json" };

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await apiFetch(`${BASE_URL}${endpoint}`, options);
  const { ok, data, error } = await readApiResponse(res, "API request failed.");
  if (!ok) {
    throw new Error(error);
  }

  return data;
}
