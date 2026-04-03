"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import "./admin.css";
import Cal from "../components/calender/calender.jsx";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import {
  MotionButton,
  MotionCard,
  MotionSection,
  fadeUpItem,
  staggerContainer,
} from "../components/motion/primitives.jsx";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from "chart.js";
import { Pie } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);
// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API_BASE = "";

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const [students, setStudents] = useState([]);
  const [monthlyFee, setMonthlyFee] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: "bot",
      text: "Admin assistant ready. Use keyword prompts: 'paid id 3 march', 'reminder all', 'unpaid november', 'details id 3', 'update student id 3 phone 9876543210', 'fee 700', 'summary'.",
    },
  ]);

  // =========================
  // Date Filter State
  // =========================
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filteredRevenue, setFilteredRevenue] = useState(0);
  const [filteredPaid, setFilteredPaid] = useState(0);

  // =========================
  // Fetch Students & Revenue
  // =========================
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      window.location.href = "/login";
      return;
    }

    const studentsRequest = fetch(`${API_BASE}/api/students`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setStudents(data);
          // Optional: set initial monthly fee from first student
          if (data.length > 0) setMonthlyFee(data[0].monthlyFee);
        }
      })
      .catch(err => console.error(err));

    const revenueRequest = fetch(`${API_BASE}/api/payments/revenue`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => setTotalRevenue(data.totalRevenue || 0))
      .catch(err => console.error(err));

    Promise.allSettled([studentsRequest, revenueRequest]).finally(() => {
      setLoading(false);
    });

  }, []);
  // Logout function
  const handleLogout = () => {
    const token = localStorage.getItem("token");
    if (token) {
      fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem("token");
    localStorage.removeItem("studentName");
    alert("You are logged out from this device. Please login again.");
    window.location.href = "/login";
  };

  // =========================
  // Filter Functions
  // =========================
  const applyFilter = () => {
    if (!filterFrom || !filterTo) return;

    const from = new Date(filterFrom);
    const to = new Date(filterTo);
    let revenue = 0;
    let paid = 0;

    students.forEach(s => {
      if (s.payments && s.payments.length) {
        s.payments.forEach(p => {
          const pDate = new Date(p.date);
          if (pDate >= from && pDate <= to) {
            revenue += p.amount;
            if (p.status === "paid") paid += p.amount;
          }
        });
      }
    });

    setFilteredRevenue(revenue);
    setFilteredPaid(paid);
  };

  const clearFilter = () => {
    setFilterFrom("");
    setFilterTo("");
    setFilteredRevenue(0);
    setFilteredPaid(0);
  };

  const filteredStudents = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    totalStudents: students.length,
    paid: students.filter(s => s.feesStatus === "paid").length,
    unpaid: students.filter(s => s.feesStatus !== "paid").length,
    revenue: totalRevenue,
  };

  const pieData = {
    labels: ["Paid", "Unpaid"],
    datasets: [
      {
        data: [stats.paid, stats.unpaid],
        backgroundColor: ["#16a34a", "#dc2626"],
        borderWidth: 0
      }
    ]
  };

  const pieOptions = {
    responsive: true,
    plugins: { legend: { position: "bottom" } }
  };

  useEffect(() => {
    function onResize() {
      if (window.innerWidth > 820 && mobileSearchOpen) {
        setMobileSearchOpen(false);
      }
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mobileSearchOpen]);

  // =========================
  // SAVE MONTHLY FEE (NEW FUNCTIONALITY)
  // =========================
  const saveMonthlyFee = async () => {
    const token = localStorage.getItem("token");
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

    const token = localStorage.getItem("token");
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
        {
          role: "bot",
          text: data?.message || "No response from assistant.",
        },
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
            className="search-toggle-btn"
            onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
          >
            🔍
          </MotionButton>
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

      {/* SEARCH */}
      <MotionSection className={`sliding-search-wrapper ${mobileSearchOpen ? "open" : ""}`} delay={0.04}>
        <div className="modern-search-wrapper">
          <input
            type="text"
            className="modern-search-bar"
            placeholder="Search students..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <MotionButton className="modern-search-btn">Search</MotionButton>
        </div>
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
          <MotionButton className="apply-btn" onClick={applyFilter}>Apply</MotionButton>
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
          <Pie data={pieData} options={pieOptions} />
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
      <motion.div
        className="student-list"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {filteredStudents.map((s, i) => (
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
      </motion.div>
      </MotionSection>

      <MotionButton className="assistant-toggle" onClick={() => setChatOpen((v) => !v)}>
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
          <h3>Admin Chatbot</h3>
          <div className="assistant-messages">
            {chatMessages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`assistant-msg ${message.role === "user" ? "assistant-user" : "assistant-bot"}`}
              >
                {message.text}
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
              {chatLoading ? <span className="button-loading-content"><PremiumLoader inline compact /><span>Sending</span></span> : "Send"}
            </MotionButton>
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </motion.div>
  );
}
