"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useParams, useRouter } from "next/navigation";
import "./stu.css";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard, MotionSection } from "../../components/motion/primitives.jsx";
import { clearAuthSession, getAuthRole, getAuthToken } from "../../../lib/authStorage.js";

// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API_BASE = "";

export default function StudentProfile() {
  const { id } = useParams();
  const router = useRouter();
  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = getAuthToken();
    const role = getAuthRole();
    if (!token) {
      router.push("/login");
      return;
    }
    if (role && role !== "admin") {
      clearAuthSession();
      router.push("/login");
      return;
    }

    fetch(`${API_BASE}/api/students/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            clearAuthSession();
            router.push("/login");
            return null;
          }
          throw new Error(data?.message || "Failed to load student");
        }
        return data;
      })
      .then((data) => {
        if (data) setStudent(data);
      })
      .catch((err) => {
        console.error(err);
      });
  }, [id, router]);

  // 🔥 DELETE STUDENT
  const deleteStudent = async () => {
    const confirmDelete = confirm(
      "Are you sure?\nThis will permanently delete the student and all payment records."
    );

    if (!confirmDelete) return;

    try {
      setLoading(true);
      const token = getAuthToken();
      if (!token) {
        router.push("/login");
        return;
      }

      const res = await fetch(
        `${API_BASE}/api/students/${id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) {
        throw new Error("Delete failed");
      }

      alert("Student deleted successfully");
      router.push("/students");

    } catch (err) {
      alert("Error deleting student");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (!student) return <PremiumLoader fullScreen label="Loading student profile" />;

  return (
    <motion.div
      className="profile-page"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >

     
      

      <MotionCard className="profile-card" hover={false}>
         <MotionButton className="back-btn" onClick={() => router.back()}>
        ← Back to Students
      </MotionButton>

        <MotionSection className="profile-header" delay={0.04}>
          <div className="avatar">
            {student.name?.charAt(0).toUpperCase()}
          </div>
          {/* 🔴 DELETE BUTTON */}
      <MotionButton
        className="delete-student-btn"
        onClick={deleteStudent}
        disabled={loading}
      >
        {loading ? (
          <span className="button-loading-content">
            <PremiumLoader inline compact />
            <span>Deleting</span>
          </span>
        ) : (
          "Delete Student"
        )}
      </MotionButton>
      
          <div>
            <h1 className="profile-title">{student.name}</h1>
            <p className="profile-subtitle">Student Profile</p>
          </div>
        </MotionSection>

        <div className="profile-grid">
          <div className="info-item"><span>Class</span><p>{student.class || "—"}</p></div>
          <div className="info-item"><span>School</span><p>{student.school || "—"}</p></div>
          <div className="info-item"><span>Phone</span><p>{student.phone}</p></div>
          <div className="info-item"><span>Email</span><p>{student.email}</p></div>
        </div>





        <div className="fees-section" style={{ marginTop: "25px" }}>
          <h3>Payment Records</h3>

          {student.payments?.length ? (
            <div className="payment-record-list">
              {student.payments.map((p) => (
                <div key={p.id} className="payment-record-item">
                  <p><strong>Month:</strong> {p.month}</p>
                  <p><strong>Amount:</strong> ₹{p.amount}</p>
                  <p><strong>Status:</strong> {p.status}</p>
                  <p className="payment-date">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-data">No payment history found</p>
          )}
        </div>
      </MotionCard>
    </motion.div>
  );
}
