"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import "./admin.css";
import Cal from "../components/calender/calender.jsx";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import GreetingPanel from "../components/dashboard/GreetingPanel.jsx";
import WhatsAppReminderButton from "../components/reminders/WhatsAppReminderButton.jsx";
import {
  MotionButton,
  MotionCard,
  MotionSection,
  fadeUpItem,
  staggerContainer,
} from "../components/motion/primitives.jsx";
import {
  clearAuthSession,
  getAuthName,
  getAuthRole,
  getAuthToken,
  getAuthUserId,
} from "../../lib/authStorage.js";
import {
  formatWhatsAppDisplay,
  isValidWhatsAppNumber,
} from "../../lib/whatsapp.js";
import useSessionChatHistory from "../../lib/useSessionChatHistory.js";
// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API_BASE = "";
const STUDENT_PAGE_SIZE = 8;
const ADMIN_CHAT_STORAGE_KEY_PREFIX = "flowlytiks_admin_chat_history_";
const DEFAULT_ADMIN_CHAT_STORAGE_KEY = `${ADMIN_CHAT_STORAGE_KEY_PREFIX}session`;
const DEFAULT_CHAT_MESSAGES = [
  {
    role: "bot",
    text: "Admin assistant ready. Use prompts like 'paid id 3 march', 'mark everyone as paid for May', 'send fee reminder for May', 'unpaid november', 'details id 3', 'update student id 3 phone 9876543210', 'fee 700', 'summary'.",
  },
];

const buildAdminChatStorageKey = (adminId) =>
  `${ADMIN_CHAT_STORAGE_KEY_PREFIX}${String(adminId || "session").trim() || "session"}`;

const sanitizeReminderStudent = (student) => {
  if (!student || typeof student !== "object") return null;

  return {
    id: Number(student.id),
    name: typeof student.name === "string" ? student.name : "",
    class: typeof student.class === "string" ? student.class : "",
    school: typeof student.school === "string" ? student.school : "",
    phone: typeof student.phone === "string" ? student.phone : "",
    amountDue: Number.isFinite(Number(student.amountDue))
      ? Number(student.amountDue)
      : 0,
    status: typeof student.status === "string" ? student.status : "unpaid",
    whatsappReminder:
      student.whatsappReminder && typeof student.whatsappReminder === "object"
        ? {
            canRemind: Boolean(student.whatsappReminder.canRemind),
            cooldownUntil:
              typeof student.whatsappReminder.cooldownUntil === "string"
                ? student.whatsappReminder.cooldownUntil
                : null,
            remainingMs: Number.isFinite(Number(student.whatsappReminder.remainingMs))
              ? Number(student.whatsappReminder.remainingMs)
              : 0,
            lastRemindedAt:
              typeof student.whatsappReminder.lastRemindedAt === "string"
                ? student.whatsappReminder.lastRemindedAt
                : null,
            reason:
              typeof student.whatsappReminder.reason === "string"
                ? student.whatsappReminder.reason
                : "available",
          }
        : null,
  };
};

const sanitizeChatMessages = (messages) => {
  if (!Array.isArray(messages)) return [];

  return messages
    .map((message) => {
      if (!message || typeof message !== "object") return null;

      const role = message.role === "user" ? "user" : "bot";
      const sanitizedMessage = { role };

      if (typeof message.text === "string") {
        sanitizedMessage.text = message.text;
      }

      if (typeof message.kind === "string") {
        sanitizedMessage.kind = message.kind;
      }

      if (typeof message.title === "string") {
        sanitizedMessage.title = message.title;
      }

      if (typeof message.subtitle === "string") {
        sanitizedMessage.subtitle = message.subtitle;
      }

      if (typeof message.helperText === "string") {
        sanitizedMessage.helperText = message.helperText;
      }

      if (typeof message.month === "string") {
        sanitizedMessage.month = message.month;
      }

      if (Number.isFinite(Number(message.academicYear))) {
        sanitizedMessage.academicYear = Number(message.academicYear);
      }

      if (Array.isArray(message.reminders)) {
        sanitizedMessage.reminders = message.reminders
          .map(sanitizeReminderStudent)
          .filter(Boolean);
      }

      return sanitizedMessage.text || sanitizedMessage.kind
        ? sanitizedMessage
        : null;
    })
    .filter(Boolean);
};

const AdminFeeStatusChart = dynamic(
  () => import("../components/dashboard/AdminFeeStatusChart.jsx"),
  {
    ssr: false,
    loading: () => (
      <div className="chart-loading">
        <PremiumLoader label="Loading analytics" />
      </div>
    ),
  }
);

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminName, setAdminName] = useState("");

  const [students, setStudents] = useState([]);
  const [studentPage, setStudentPage] = useState(1);
  const [studentTotalPages, setStudentTotalPages] = useState(1);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState({
    totalStudents: 0,
    paid: 0,
    unpaid: 0,
    revenue: 0,
    monthlyFee: 0,
  });
  const [monthlyFee, setMonthlyFee] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [assistantPortalRoot, setAssistantPortalRoot] = useState(null);
  const [adminChatStorageKey, setAdminChatStorageKey] = useState(
    DEFAULT_ADMIN_CHAT_STORAGE_KEY
  );

  // =========================
  // Date Filter State
  // =========================
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filteredRevenue, setFilteredRevenue] = useState(0);
  const [filteredPaid, setFilteredPaid] = useState(0);
  const [filterLoading, setFilterLoading] = useState(false);
  const dashboardRequestKeyRef = useRef("");
  const initialLoadRef = useRef(true);
  const {
    messages: chatMessages,
    setMessages: setChatMessages,
    clearMessages: clearChatHistory,
  } = useSessionChatHistory({
    storageKey: adminChatStorageKey,
    initialMessages: DEFAULT_CHAT_MESSAGES,
    maxMessages: 50,
    sanitizeMessages: sanitizeChatMessages,
  });

  useEffect(() => {
    setAssistantPortalRoot(document.body);
    setAdminName(getAuthName());
    const adminId = getAuthUserId();
    setAdminChatStorageKey(
      adminId
        ? buildAdminChatStorageKey(adminId)
        : DEFAULT_ADMIN_CHAT_STORAGE_KEY
    );
  }, []);

  const buildAssistantBotMessage = (data) => {
    if (data?.ui === "whatsapp_reminders" && Array.isArray(data?.reminders)) {
      return {
        role: "bot",
        kind: "whatsapp_reminders",
        title: data.title || `Unpaid Fee Reminders for ${data.month || "Current Month"}`,
        subtitle:
          data.subtitle ||
          `Found ${data.reminders.length} unpaid student${
            data.reminders.length === 1 ? "" : "s"
          }. Click a button to open WhatsApp with a pre-filled reminder.`,
        helperText:
          data.helperText ||
          "WhatsApp will open with a pre-filled message. Please review and press Send. Reminder buttons have a 24-hour cooldown after opening.",
        reminders: data.reminders,
        month: data.month || "",
        academicYear: data.academicYear || null,
      };
    }

    return {
      role: "bot",
      text: data?.message || "No response from assistant.",
    };
  };

  // =========================
  // Fetch dashboard summary + paginated students
  // =========================
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

    const params = new URLSearchParams({
      page: String(studentPage),
      limit: String(STUDENT_PAGE_SIZE),
      sort: "az",
    });

    if (studentPage === 1) {
      params.set("includeSummary", "1");
    }

    const requestKey = params.toString();
    if (dashboardRequestKeyRef.current === requestKey) {
      return;
    }
    dashboardRequestKeyRef.current = requestKey;

    const isInitialLoad = initialLoadRef.current;
    if (isInitialLoad) {
      setLoading(true);
    } else {
      setStudentsLoading(true);
    }

    fetch(`${API_BASE}/api/students?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            clearAuthSession();
            window.location.href = "/login";
            return;
          }
          throw new Error(data?.message || "Failed to fetch dashboard data");
        }
        if (dashboardRequestKeyRef.current !== requestKey) {
          return;
        }

        const nextStudents = Array.isArray(data) ? data : data.students || [];
        setStudents(nextStudents);

        if (!Array.isArray(data)) {
          setStudentTotalPages(data.totalPages || 1);
          if (data.summary) {
            setDashboardSummary(data.summary);
            setTotalRevenue(data.summary.revenue || 0);
            setMonthlyFee((current) => current || data.summary.monthlyFee || 0);
          }
        }
      })
      .catch((err) => {
        dashboardRequestKeyRef.current = "";
        console.error("Admin dashboard fetch error:", err);
      })
      .finally(() => {
        if (isInitialLoad) {
          setLoading(false);
          initialLoadRef.current = false;
        }
        setStudentsLoading(false);
      });
  }, [studentPage]);
  // Logout function
  const handleLogout = () => {
    const token = getAuthToken();
    if (token) {
      fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    clearChatHistory();
    clearAuthSession();
    alert("You are logged out from this device. Please login again.");
    window.location.href = "/login";
  };

  const handleClearChat = () => {
    clearChatHistory();
    setChatInput("");
  };

  // =========================
  // Filter Functions
  // =========================
  const applyFilter = async () => {
    if (!filterFrom || !filterTo) return;

    const token = getAuthToken();
    if (!token) {
      window.location.href = "/login";
      return;
    }

    setFilterLoading(true);

    try {
      const params = new URLSearchParams({
        from: filterFrom,
        to: filterTo,
      });

      const res = await fetch(`${API_BASE}/api/payments/revenue?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "Failed to apply date filter");
      }

      setFilteredRevenue(data.grossRevenue ?? data.totalRevenue ?? 0);
      setFilteredPaid(data.paidRevenue ?? data.totalRevenue ?? 0);
    } catch (err) {
      console.error("Admin revenue filter error:", err);
      alert("Failed to apply the date filter.");
    } finally {
      setFilterLoading(false);
    }
  };

  const clearFilter = () => {
    setFilterFrom("");
    setFilterTo("");
    setFilteredRevenue(0);
    setFilteredPaid(0);
  };

  const stats = {
    totalStudents: dashboardSummary.totalStudents,
    paid: dashboardSummary.paid,
    unpaid: dashboardSummary.unpaid,
    revenue: totalRevenue,
  };

  // =========================
  // SAVE MONTHLY FEE (NEW FUNCTIONALITY)
  // =========================
  const saveMonthlyFee = async () => {
    const token = getAuthToken();
    if (!token) return alert("No token found. Please login.");

    try {
      const res = await fetch(`${API_BASE}/api/settings/monthly-fee`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fee: Number(monthlyFee) }),
      });

      const data = await res.json();

      if (!res.ok) {
        // Show backend error message
        return alert(`Failed to update fee: ${data.message || "Unknown error"}`);
      }

      alert(`Monthly fee updated to ₹${monthlyFee}`);
    } catch (err) {
      console.error(err);
      alert("Failed to update fee. Check console for error.");
    }
  };

  const sendAdminPrompt = async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatLoading) return;

    const token = getAuthToken();
    if (!token) {
      window.location.href = "/login";
      return;
    }

    setChatMessages((prev) => [...prev, { role: "user", text: prompt }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/admin-assistant/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json().catch(() => ({}));
      setChatMessages((prev) => [
        ...prev,
        buildAssistantBotMessage(data),
      ]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        { role: "bot", text: "Assistant request failed. Please try again." },
      ]);
      console.error(err);
    } finally {
      setChatLoading(false);
    }
  };
 

  


  if (loading) {
    return <PremiumLoader fullScreen label="Loading admin dashboard" />;
  }

  return (
    <>
      <motion.div
        className="admin-dashboard"
        id="dashboard-root"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >

      {/* NAVBAR */}
      <MotionSection className="admin-nav" delay={0.02}>
        <div className="nav-left">
          <h2 className="nav-title">FLOWLYTIKS Fee Management Dashboard</h2>
        </div>

        <div className="nav-actions">
          <MotionButton
            className="hamburger"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            ☰
          </MotionButton>
        </div>

        <div className={`nav-links ${menuOpen ? "open" : ""}`}>
          <Link href="/students">Students</Link>
          <Link href="/payments">Payments</Link>
          <MotionButton className="logout-btn" onClick={handleLogout}>Logout</MotionButton>

        </div>
      </MotionSection>

      <MotionSection delay={0.04}>
        <GreetingPanel
          name={adminName}
          accent="violet"
          subtitle="Stay on top of collections, student activity, and daily institute operations with one clean live view."
        />
      </MotionSection>

      {/* SUMMARY */}
      <motion.div
        className="monthly-summary"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        <motion.div className="summary-box" variants={fadeUpItem}>
          <h3>Total Students</h3>
          <p>{stats.totalStudents}</p>
        </motion.div>
        <motion.div className="summary-box" variants={fadeUpItem}>
          <h3>Paid</h3>
          <p>{stats.paid}</p>
        </motion.div>
        <motion.div className="summary-box" variants={fadeUpItem}>
          <h3>Unpaid</h3>
          <p>{stats.unpaid}</p>
        </motion.div>
        <motion.div className="summary-box" variants={fadeUpItem}>
          <h3>Total Revenue</h3>
          <p>₹{stats.revenue}</p>
        </motion.div>
      </motion.div>

      {/* DATE FILTER */}
      <MotionCard className="date-filter-wrapper" delay={0.08}>
        <div className="date-inputs">
          <div className="date-input">
            <label>From:</label>
            <input
              type="date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>
          <div className="date-input">
            <label>To:</label>
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
        </div>
        <div className="filter-actions">
          <MotionButton className="apply-btn" onClick={applyFilter} disabled={filterLoading}>
            {filterLoading ? (
              <span className="button-loading-content">
                <PremiumLoader inline compact />
                <span>Applying</span>
              </span>
            ) : (
              "Apply"
            )}
          </MotionButton>
          <MotionButton className="clear-btn" onClick={clearFilter}>Clear</MotionButton>
        </div>
        <div className="filter-result">
          <p>Total Revenue: ₹{filteredRevenue}</p>
          <p>Fees Paid: ₹{filteredPaid}</p>
        </div>
      </MotionCard>
     


      {/* CHART + CALENDAR */}
      <MotionSection className="chart-calendar-row" delay={0.12}>
        <MotionCard className="chart-container" hover={false}>
          <h2 className="chart-title">Monthly Fee Status</h2>
          <AdminFeeStatusChart paid={stats.paid} unpaid={stats.unpaid} />
        </MotionCard>
        <Cal />
      </MotionSection>

      {/* SET MONTHLY FEES */}
      <MotionSection delay={0.16}>
      <h2>Set Monthly Fees</h2>
      <MotionCard className="set-fee-box" hover={false}>
        <input
          type="number"
          className="fee-input"
          placeholder="Enter monthly fee (₹)"
          value={monthlyFee}
          onChange={(e) => setMonthlyFee(e.target.value)}
        />
        <MotionButton className="fee-save-btn" onClick={saveMonthlyFee}>Save Fee</MotionButton>
      </MotionCard>
      </MotionSection>

      {/* STUDENTS LIST */}
      <MotionSection delay={0.2}>
      <h2>Students List</h2>
      <div className="student-list-meta">
        <span>
          Showing page {studentPage} of {studentTotalPages}
        </span>
        <div className="student-list-pagination">
          <MotionButton
            className="student-list-page-btn"
            disabled={studentsLoading || studentPage === 1}
            onClick={() => setStudentPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </MotionButton>
          <MotionButton
            className="student-list-page-btn"
            disabled={studentsLoading || studentPage >= studentTotalPages}
            onClick={() =>
              setStudentPage((current) =>
                Math.min(studentTotalPages, current + 1)
              )
            }
          >
            Next
          </MotionButton>
        </div>
      </div>
      <motion.div
        className="student-list"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {students.map((s, i) => (
          <motion.div key={s.id} variants={fadeUpItem} whileHover={{ y: -4 }}>
            <Link
              href={`/students/${s.id}`}
              className="student-item"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <div>
                <h3>
                  {s.name}
                  <span style={{ fontWeight: 400, fontSize: "14px", opacity: 0.85 }}>
                    {" "}— Class {s.class}, {s.school}
                  </span>
                </h3>
              </div>
              <span className={s.feesStatus === "paid" ? "status-paid" : "status-unpaid"}>
                {s.feesStatus === "paid" ? "Paid" : "Unpaid"}
              </span>
            </Link>
          </motion.div>
        ))}
        {!students.length && !studentsLoading ? (
          <MotionCard className="student-empty-state" hover={false}>
            No students found for this page.
          </MotionCard>
        ) : null}
      </motion.div>
      </MotionSection>

      </motion.div>

      {assistantPortalRoot
        ? createPortal(
            <div className="assistant-floating-layer" aria-live="polite">
              <MotionButton
                className="assistant-toggle"
                onClick={() => setChatOpen((v) => !v)}
              >
                {chatOpen ? "Close Assistant" : "Admin Assistant"}
              </MotionButton>

              <AnimatePresence>
                {chatOpen && (
                  <motion.div
                    className="assistant-panel"
                    initial={{ opacity: 0, y: 20, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.98 }}
                    transition={{ duration: 0.25 }}
                  >
                    <div className="assistant-header">
                      <h3>Admin Chatbot</h3>
                      <button
                        type="button"
                        className="assistant-clear-btn"
                        onClick={handleClearChat}
                      >
                        Clear Chat
                      </button>
                    </div>
                    <div className="assistant-messages">
                      {chatMessages.map((message, index) => (
                        <div
                          key={`${message.role}-${index}`}
                          className={`assistant-msg ${message.role === "user" ? "assistant-user" : "assistant-bot"} ${
                            message.kind === "whatsapp_reminders" ? "assistant-msg--rich" : ""
                          }`}
                        >
                          {message.kind === "whatsapp_reminders" ? (
                            <div className="assistant-reminder-block">
                              <div className="assistant-reminder-title">{message.title}</div>
                              <p className="assistant-reminder-subtitle">{message.subtitle}</p>
                              <p className="assistant-reminder-helper">{message.helperText}</p>
                              <div className="assistant-reminder-list">
                                {message.reminders.map((student) => {
                                  const hasWhatsApp = isValidWhatsAppNumber(student.phone);

                                  return (
                                    <article key={student.id} className="assistant-reminder-card">
                                      <div className="assistant-reminder-meta">
                                        <h4>{student.name}</h4>
                                        <p>
                                          Class {student.class}
                                          {student.school ? ` • ${student.school}` : ""}
                                        </p>
                                      </div>
                                      <div className="assistant-reminder-info">
                                        <span>Amount Due</span>
                                        <strong>₹{student.amountDue}</strong>
                                      </div>
                                      <div className="assistant-reminder-info">
                                        <span>Status</span>
                                        <strong>Unpaid</strong>
                                      </div>
                                      <div className="assistant-reminder-info">
                                        <span>WhatsApp</span>
                                        <strong>
                                          {hasWhatsApp
                                            ? formatWhatsAppDisplay(student.phone)
                                            : "No valid WhatsApp number"}
                                        </strong>
                                      </div>
                                      <WhatsAppReminderButton
                                        studentId={student.id}
                                        monthName={message.month}
                                        academicYear={
                                          Number.isFinite(Number(message.academicYear))
                                            ? Number(message.academicYear)
                                            : new Date().getMonth() >= 2
                                              ? new Date().getFullYear()
                                              : new Date().getFullYear() - 1
                                        }
                                        amount={student.amountDue}
                                        studentName={student.name}
                                        whatsappNumber={student.phone}
                                        senderName={adminName.trim() || "Flowlytiks"}
                                        reminderState={student.whatsappReminder}
                                        wrapperClassName="assistant-reminder-action"
                                        buttonClassName="assistant-reminder-btn"
                                        disabledButtonClassName="assistant-reminder-btn assistant-reminder-btn--disabled"
                                        noteClassName="assistant-reminder-note"
                                        invalidLabel="No valid WhatsApp number"
                                      />
                                    </article>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            message.text
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="assistant-input-row">
                      <input
                        type="text"
                        value={chatInput}
                        placeholder="Type command for admin actions..."
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") sendAdminPrompt();
                        }}
                      />
                      <MotionButton onClick={sendAdminPrompt} disabled={chatLoading}>
                        {chatLoading ? (
                          <span className="button-loading-content">
                            <PremiumLoader inline compact />
                            <span>Sending</span>
                          </span>
                        ) : (
                          "Send"
                        )}
                      </MotionButton>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>,
            assistantPortalRoot
          )
        : null}
    </>
  );
}
