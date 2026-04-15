"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import "./page.css";
import Link from "next/link";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard } from "../components/motion/primitives.jsx";
import { clearAuthSession, getAuthRole, getAuthToken } from "../../lib/authStorage.js";

// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API_BASE = "";

export default function PaymentsPage() {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reversingPaymentId, setReversingPaymentId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [recentPayments, setRecentPayments] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const searchRequestKeyRef = useRef("");

  // Session months: March → next February
  const months = [
    "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
    "January", "February",
  ];

  useEffect(() => {
    const token = getAuthToken();
    const role = getAuthRole();
    if (!token) {
      window.location.href = "/login";
      return;
    }
    if (role && role !== "admin") {
      clearAuthSession();
      window.location.href = "/login";
      return;
    }

    const trimmedSearch = search.trim();
    if (!trimmedSearch) {
      searchRequestKeyRef.current = "";
      setStudents([]);
      return;
    }

    const params = new URLSearchParams({
      search: trimmedSearch,
      limit: "7",
      compact: "1",
      sort: "az",
    });

    const requestKey = params.toString();
    if (searchRequestKeyRef.current === requestKey) {
      return;
    }
    searchRequestKeyRef.current = requestKey;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setSearchLoading(true);
      fetch(`${API_BASE}/api/students?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
              clearAuthSession();
              window.location.href = "/login";
              return;
            }
            throw new Error(data?.message || "Failed to search students");
          }

          if (Array.isArray(data)) {
            setStudents(data);
            return;
          }

          setStudents(Array.isArray(data.students) ? data.students : []);
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            searchRequestKeyRef.current = "";
            console.error("Student search error:", err);
            setStudents([]);
          }
        })
        .finally(() => setSearchLoading(false));
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [search]);

  useEffect(() => {
    const token = getAuthToken();
    const role = getAuthRole();
    if (!token || (role && role !== "admin")) {
      return;
    }

    setRecentLoading(true);
    fetch(`${API_BASE}/api/payments/all?page=1&limit=20`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            clearAuthSession();
            window.location.href = "/login";
            return [];
          }
          throw new Error(data?.message || "Failed to load recent payments");
        }

        const rows = Array.isArray(data) ? data : data?.payments || [];
        return rows
          .filter(
            (payment) =>
              String(payment?.paymentProvider || "").toUpperCase() === "CASH" &&
              String(payment?.status || "").toLowerCase() === "paid"
          )
          .sort(
            (left, right) =>
              new Date(right?.updatedAt || right?.paidAt || right?.createdAt).getTime() -
              new Date(left?.updatedAt || left?.paidAt || left?.createdAt).getTime()
          )
          .slice(0, 8);
      })
      .then((rows) => {
        setRecentPayments(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        console.error("Recent payments fetch error:", err);
        setRecentPayments([]);
      })
      .finally(() => setRecentLoading(false));
  }, [historyRefreshKey]);

  const setFeedbackMessage = (payload) => {
    setFeedback({
      type: payload?.success === false ? "error" : payload?.type || "success",
      message: payload?.message || "",
      affectedStudents: Array.isArray(payload?.affectedStudents) ? payload.affectedStudents : [],
      failedStudents: Array.isArray(payload?.failedStudents) ? payload.failedStudents : [],
    });
  };

  const toggleStudentSelection = (student) => {
    let shouldResetSearch = false;

    setSelectedStudents((current) => {
      const alreadySelected = current.some((entry) => entry.id === student.id);

      if (alreadySelected) {
        return current.filter((entry) => entry.id !== student.id);
      }

      if (current.length >= 10) {
        setFeedbackMessage({
          success: false,
          message: "You can select up to 10 students only",
          affectedStudents: [],
          failedStudents: [],
        });
        return current;
      }

      shouldResetSearch = true;
      return [...current, student];
    });

    if (shouldResetSearch) {
      searchRequestKeyRef.current = "";
      setSearch("");
      setStudents([]);
    }
  };

  const removeSelectedStudent = (studentId) => {
    setSelectedStudents((current) => current.filter((entry) => entry.id !== studentId));
  };

  const handlePayment = async () => {
    if (!selectedStudents.length || !selectedMonth) {
      setFeedbackMessage({
        success: false,
        message: "Select student(s) and month before continuing.",
      });
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to mark ${selectedStudents.length} student${
        selectedStudents.length === 1 ? "" : "s"
      } as PAID for ${selectedMonth}?`
    );

    if (!confirmed) {
      return;
    }

    const token = getAuthToken();
    const role = getAuthRole();
    if (!token || (role && role !== "admin")) {
      clearAuthSession();
      window.location.href = "/login";
      return;
    }
    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/api/payments/bulk-update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          studentIds: selectedStudents.map((student) => student.id),
          month: selectedMonth,
          status: "paid",
          paymentMode: "cash",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearAuthSession();
          window.location.href = "/login";
          return;
        }
        setFeedbackMessage(data);
        return;
      }

      setFeedbackMessage(data);
      setSelectedStudents([]);
      setSelectedMonth("");
      setStudents([]);
      setSearch("");
      setHistoryRefreshKey((value) => value + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReversePayment = async (payment) => {
    const confirmed = window.confirm(
      `Are you sure you want to reverse the payment for ${payment?.student?.name || "this student"} (${payment?.month})?`
    );

    if (!confirmed) {
      return;
    }

    const token = getAuthToken();
    const role = getAuthRole();
    if (!token || (role && role !== "admin")) {
      clearAuthSession();
      window.location.href = "/login";
      return;
    }

    setReversingPaymentId(payment.id);
    try {
      const res = await fetch(`${API_BASE}/api/payments/reverse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          paymentId: payment.id,
          studentId: payment.studentId,
          month: payment.month,
          academicYear: payment.academicYear,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearAuthSession();
          window.location.href = "/login";
          return;
        }
        setFeedbackMessage(data);
        return;
      }

      setFeedbackMessage(data);
      setHistoryRefreshKey((value) => value + 1);
    } finally {
      setReversingPaymentId(null);
    }
  };

  return (
    <motion.div
      className="payment-container"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >

      {/* BACK BUTTON */}
      <Link href="/admin" className="back-btn">
        ← Back to Dashboard
      </Link>

      <h1 className="payment-title">Cash Payment Entry</h1>

      <MotionCard className="payment-box" hover={false}>
        <label>Search Student</label>
        <input
          type="text"
          className="student-search-input"
          placeholder="Search student by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {search && (
          <div className="student-search-results">
            {searchLoading ? (
              <div className="student-result-item student-result-item--loading">
                <PremiumLoader inline compact />
                <span>Searching students…</span>
              </div>
            ) : students.length ? (
              students.map((s) => (
                <div
                  key={s.id}
                  className={`student-result-item ${
                    selectedStudents.some((entry) => entry.id === s.id)
                      ? "student-result-item--selected"
                      : ""
                  }`}
                  onClick={() => toggleStudentSelection(s)}
                >
                  <input
                    type="checkbox"
                    className="student-result-checkbox"
                    checked={selectedStudents.some((entry) => entry.id === s.id)}
                    disabled={
                      !selectedStudents.some((entry) => entry.id === s.id) &&
                      selectedStudents.length >= 10
                    }
                    onChange={() => toggleStudentSelection(s)}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <div className="student-result-meta">
                    <strong>{s.name}</strong>
                    <span>
                      Class {s.class}
                      {s.school ? ` • ${s.school}` : ""}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="student-result-item student-result-item--empty">
                No matching students found
              </div>
            )}
          </div>
        )}

        {selectedStudents.length > 0 && (
          <div className="selected-student-box">
            <div className="selected-student-header">
              <strong>Selected Students</strong>
              <span>{selectedStudents.length}/10</span>
            </div>
            <div className="selected-student-list">
              {selectedStudents.map((student) => (
                <div key={student.id} className="selected-student-chip">
                  <span>
                    {student.name} <small>(Class {student.class})</small>
                  </span>
                  <button
                    type="button"
                    className="remove-selected-btn"
                    onClick={() => removeSelectedStudent(student.id)}
                    aria-label={`Remove ${student.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <label>Select Month</label>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
        >
          <option value="">Select Month</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <MotionButton
          className="pay-btn"
          disabled={!selectedStudents.length || !selectedMonth || submitting}
          onClick={handlePayment}
        >
          {submitting ? (
            <span className="button-loading-content">
              <PremiumLoader inline compact />
              <span>Saving Payment</span>
            </span>
          ) : (
            `Mark as Paid${selectedStudents.length ? ` (${selectedStudents.length})` : ""}`
          )}
        </MotionButton>

        {feedback ? (
          <div className={`payment-feedback payment-feedback--${feedback.type}`}>
            <p className="payment-feedback__message">{feedback.message}</p>
            {feedback.affectedStudents?.length ? (
              <div className="payment-feedback__section">
                <strong>Affected Students</strong>
                <ul>
                  {feedback.affectedStudents.map((student) => (
                    <li key={`${student.studentId}-${student.month}-${student.paymentId || "na"}`}>
                      {student.name || `Student ${student.studentId}`} • {student.month} •{" "}
                      {student.previousStatus} → {student.newStatus}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {feedback.failedStudents?.length ? (
              <div className="payment-feedback__section">
                <strong>Failed Students</strong>
                <ul>
                  {feedback.failedStudents.map((student) => (
                    <li key={`${student.studentId}-${student.month}-${student.code || "reason"}`}>
                      {student.name || `Student ${student.studentId}`} • {student.month || "—"} •{" "}
                      {student.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </MotionCard>

      <MotionCard className="payment-box payment-box--history" hover={false}>
        <div className="recent-payments-header">
          <div>
            <h2 className="recent-payments-title">Recent Manual Payments</h2>
            <p className="recent-payments-subtitle">
              Use undo carefully. Only manual cash payments can be reversed.
            </p>
          </div>
        </div>

        {recentLoading ? (
          <PremiumLoader label="Loading recent payments" />
        ) : recentPayments.length ? (
          <div className="recent-payments-list">
            {recentPayments.map((payment) => (
              <div key={payment.id} className="recent-payment-item">
                <div className="recent-payment-meta">
                  <strong>{payment.student?.name || `Student ${payment.studentId}`}</strong>
                  <span>
                    {payment.month} • ₹{payment.amount}
                    {payment.isLatePayment ? " • Late Payment" : " • Paid"}
                  </span>
                </div>
                <MotionButton
                  className="reverse-pay-btn"
                  onClick={() => handleReversePayment(payment)}
                  disabled={reversingPaymentId === payment.id}
                >
                  {reversingPaymentId === payment.id ? "Reversing..." : "Undo Payment"}
                </MotionButton>
              </div>
            ))}
          </div>
        ) : (
          <p className="recent-payments-empty">No recent manual cash payments found.</p>
        )}
      </MotionCard>
    </motion.div>
  );
}
