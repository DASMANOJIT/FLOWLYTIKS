"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import "./students.css";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard, MotionSection, fadeUpItem, staggerContainer } from "../components/motion/primitives.jsx";
// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API_BASE = "";
export default function StudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [students, setStudents] = useState([]);
  const [totalStudents, setTotalStudents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const [statusFilter, setStatusFilter] = useState(
    () => searchParams.get("status") || "all"
  );
  const [classFilter, setClassFilter] = useState(
    () => searchParams.get("class") || "all"
  );
  const [schoolFilter, setSchoolFilter] = useState(
    () => searchParams.get("school") || "all"
  );
  const [sortOrder, setSortOrder] = useState(
    () => searchParams.get("sort") || "none"
  );
  const [fromDate, setFromDate] = useState(() => searchParams.get("from") || "");
  const [toDate, setToDate] = useState(() => searchParams.get("to") || "");

  // 🔹 Fetch students
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      window.location.href = "/login";
      return;
    }

    const studentsRequest = fetch(`${API_BASE}/api/students`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setStudents(data);
        else if (Array.isArray(data.students)) setStudents(data.students);
        else setStudents([]);
      })
      .catch((err) => console.error(err));

    const countRequest = fetch(`${API_BASE}/api/students/count`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (typeof data?.totalStudents === "number") setTotalStudents(data.totalStudents);
      })
      .catch((err) => console.error(err));

    Promise.allSettled([studentsRequest, countRequest]).finally(() => {
      setLoading(false);
    });
  }, []);

  // 🔹 Sync filters TO URL
  useEffect(() => {
    const params = new URLSearchParams();

    if (search) params.set("search", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (classFilter !== "all") params.set("class", classFilter);
    if (schoolFilter !== "all") params.set("school", schoolFilter);
    if (sortOrder !== "none") params.set("sort", sortOrder);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    router.replace(`/students?${params.toString()}`, { scroll: false });
  }, [search, statusFilter, classFilter, schoolFilter, sortOrder, fromDate, toDate, router]);

  // 🔹 CLEAR ALL FILTERS
  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setClassFilter("all");
    setSchoolFilter("all");
    setSortOrder("none");
    setFromDate("");
    setToDate("");

    router.replace("/students", { scroll: false });
  };

  // 🔹 FILTER + SORT PIPELINE
  const filtered = students
  .filter((s) => {
    const query = search.toLowerCase();
    return (
      s?.name?.toLowerCase().includes(query) ||
      s?.phone?.toLowerCase().includes(query)
    );
  })
  .filter((s) => (statusFilter === "all" ? true : s.feesStatus === statusFilter))
  .filter((s) => (classFilter === "all" ? true : s.class === classFilter))
  .filter((s) => (schoolFilter === "all" ? true : s.school === schoolFilter))
  .filter((s) => {
    if (!fromDate && !toDate) return true;
    const joinDate = new Date(s.joinDate);
    if (fromDate && joinDate < new Date(fromDate)) return false;
    if (toDate && joinDate > new Date(toDate)) return false;
    return true;
  })
  .sort((a, b) => {
    if (sortOrder === "az") return a.name.localeCompare(b.name);
    return 0;
  });


  const classes = [...new Set(students.map((s) => s.class).filter(Boolean))];
  const schools = [...new Set(students.map((s) => s.school).filter(Boolean))];

  if (loading) {
    return <PremiumLoader fullScreen label="Loading students" />;
  }

  return (
    <motion.div
      className="students-container"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <h1 className="students-title">Students</h1>

      <MotionSection className="students-statbar" delay={0.04}>
        <MotionCard className="students-statcard">
          <span className="students-statlabel">Total Students</span>
          <span className="students-statvalue">{totalStudents ?? "—"}</span>
        </MotionCard>
      </MotionSection>

      <Link href="/admin" className="back-btn">
        ← Back to Dashboard
      </Link>

      {/* SEARCH */}
      <div className="students-search-box">
        <input
          type="text"
          placeholder="Search students..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* FILTERS */}
      <div className="students-filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Fees</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>

        <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
          <option value="none">Sort</option>
          <option value="az">Name A–Z</option>
        </select>

        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
          <option value="all">All Classes</option>
          {classes.map((cls) => (
            <option key={cls} value={cls}>{cls}</option>
          ))}
        </select>

        <select value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)}>
          <option value="all">All Schools</option>
          {schools.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />

        {/* ✅ CLEAR ALL BUTTON */}
        <MotionButton
          type="button"
          className="clear-filters-btn"
          onClick={clearAllFilters}
        >
          Clear All
        </MotionButton>
      </div>

      {/* STUDENT LIST */}
      <motion.div
        className="students-list"
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
      >
        {filtered.map((student) => (
          <motion.div key={student.id} variants={fadeUpItem} whileHover={{ y: -4 }}>
            <Link
              href={`/students/${student.id}`}
              className="student-card"
            >
              <div className="student-card__name">
                <span className="student-card__label">Student Name</span>
                <h3>{student.name}</h3>
              </div>
              <div className="student-card__class">
                <span className="student-card__label">Class</span>
                <p>{student.class}</p>
              </div>
              <div className="student-card__school">
                <span className="student-card__label">School</span>
                <p>{student.school}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
