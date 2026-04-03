import axios from "axios";
// Use same-origin `/api/*` and let Next.js rewrite/proxy to the backend.
// Can be overridden if needed (e.g. direct backend calls), but the default is stable for production.
const API = process.env.NEXT_PUBLIC_API_URL || "/api";

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


export const createOrder = (data) => axios.post(`${API}/payments/create-order`, data).then((r) => r.data);
export const verifyPayment = (data) => axios.post(`${API}/payments/verify`, data).then((r) => r.data);
const BASE_URL = API;

export async function apiCall(endpoint, method = "GET", body = null, token = null) {
  const headers = { "Content-Type": "application/json" };

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${BASE_URL}${endpoint}`, options);
  const { ok, data, error } = await readApiResponse(res, "API request failed.");
  if (!ok) {
    throw new Error(error);
  }

  return data;
}
