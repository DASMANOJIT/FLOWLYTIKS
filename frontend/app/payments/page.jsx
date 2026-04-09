"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import "./page.css";
import Link from "next/link";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard } from "../components/motion/primitives.jsx";

// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API_BASE = "";

export default function PaymentsPage() {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const searchRequestKeyRef = useRef("");

  // Session months: March → next February
  const months = [
    "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
    "January", "February",
  ];

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
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

  const handlePayment = async () => {
    if (!selectedStudent || !selectedMonth) {
      alert("Select student & month");
      return;
    }

    const token = localStorage.getItem("token");
    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/api/payments/mark-paid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          studentId: selectedStudent.id,
          month: selectedMonth,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.message);
        return;
      }

      alert("Payment marked successfully!");
      setSelectedStudent(null);
      setSelectedMonth("");
      setStudents([]);
    } finally {
      setSubmitting(false);
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
                  className="student-result-item"
                  onClick={() => {
                    setSelectedStudent(s);
                    searchRequestKeyRef.current = "";
                    setSearch("");
                  }}
                >
                  {s.name} — Class {s.class}
                </div>
              ))
            ) : (
              <div className="student-result-item student-result-item--empty">
                No matching students found
              </div>
            )}
          </div>
        )}

        {selectedStudent && (
          <p className="selected-student-box">
            Selected: <strong>{selectedStudent.name}</strong> (Class{" "}
            {selectedStudent.class})
          </p>
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
          disabled={!selectedStudent || !selectedMonth || submitting}
          onClick={handlePayment}
        >
          {submitting ? (
            <span className="button-loading-content">
              <PremiumLoader inline compact />
              <span>Saving Payment</span>
            </span>
          ) : (
            "Mark as Paid"
          )}
        </MotionButton>
      </MotionCard>
    </motion.div>
  );
}
