"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import "./students.css";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard, MotionSection, fadeUpItem, staggerContainer } from "../components/motion/primitives.jsx";
import { clearAuthSession, getAuthRole, getAuthToken } from "../../lib/authStorage.js";
// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API_BASE = "";
const PAGE_SIZE = 12;

export default function StudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [students, setStudents] = useState([]);
  const [totalStudents, setTotalStudents] = useState(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [page, setPage] = useState(
    () => Math.max(1, Number(searchParams.get("page") || 1) || 1)
  );
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("search") || "");
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
  const [classes, setClasses] = useState([]);
  const [schools, setSchools] = useState([]);
  const requestKeyRef = useRef("");
  const initialLoadRef = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search]);

  // 🔹 Sync filters TO URL
  useEffect(() => {
    const params = new URLSearchParams();

    if (search) params.set("search", search);
    if (page > 1) params.set("page", String(page));
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (classFilter !== "all") params.set("class", classFilter);
    if (schoolFilter !== "all") params.set("school", schoolFilter);
    if (sortOrder !== "none") params.set("sort", sortOrder);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    const queryString = params.toString();
    router.replace(queryString ? `/students?${queryString}` : "/students", {
      scroll: false,
    });
  }, [search, page, statusFilter, classFilter, schoolFilter, sortOrder, fromDate, toDate, router]);

  // 🔹 Fetch students from paginated backend response
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
      page: String(page),
      limit: String(PAGE_SIZE),
      includeFilters: "1",
    });

    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (classFilter !== "all") params.set("class", classFilter);
    if (schoolFilter !== "all") params.set("school", schoolFilter);
    if (sortOrder !== "none") params.set("sort", sortOrder);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    const requestKey = params.toString();
    if (requestKeyRef.current === requestKey) {
      return;
    }
    requestKeyRef.current = requestKey;

    if (initialLoadRef.current) {
      setLoading(true);
    } else {
      setListLoading(true);
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
          throw new Error(data?.message || "Failed to fetch students");
        }
        if (requestKeyRef.current !== requestKey) {
          return;
        }

        if (Array.isArray(data)) {
          setStudents(data);
          setTotalStudents(data.length);
          setTotalPages(1);
          setClasses([...new Set(data.map((student) => student.class).filter(Boolean))]);
          setSchools([...new Set(data.map((student) => student.school).filter(Boolean))]);
          return;
        }

        setStudents(Array.isArray(data.students) ? data.students : []);
        setTotalStudents(typeof data.totalStudents === "number" ? data.totalStudents : 0);
        const nextTotalPages = data.totalPages || 1;
        setTotalPages(nextTotalPages);
        if (page > nextTotalPages) {
          setPage(nextTotalPages);
        }
        setClasses(data.filters?.classes || []);
        setSchools(data.filters?.schools || []);
      })
      .catch((err) => {
        requestKeyRef.current = "";
        console.error("Students page fetch error:", err);
        setStudents([]);
        setTotalStudents(0);
        setTotalPages(1);
      })
      .finally(() => {
        if (initialLoadRef.current) {
          setLoading(false);
          initialLoadRef.current = false;
        }
        setListLoading(false);
      });
  }, [page, debouncedSearch, statusFilter, classFilter, schoolFilter, sortOrder, fromDate, toDate]);

  // 🔹 CLEAR ALL FILTERS
  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setClassFilter("all");
    setSchoolFilter("all");
    setSortOrder("none");
    setFromDate("");
    setToDate("");
    setPage(1);

    router.replace("/students", { scroll: false });
  };

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
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {/* FILTERS */}
      <div className="students-filters">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All Fees</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
        </select>

        <select
          value={sortOrder}
          onChange={(e) => {
            setSortOrder(e.target.value);
            setPage(1);
          }}
        >
          <option value="none">Sort</option>
          <option value="az">Name A–Z</option>
        </select>

        <select
          value={classFilter}
          onChange={(e) => {
            setClassFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All Classes</option>
          {classes.map((cls) => (
            <option key={cls} value={cls}>{cls}</option>
          ))}
        </select>

        <select
          value={schoolFilter}
          onChange={(e) => {
            setSchoolFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All Schools</option>
          {schools.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <input
          type="date"
          value={fromDate}
          onChange={(e) => {
            setFromDate(e.target.value);
            setPage(1);
          }}
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => {
            setToDate(e.target.value);
            setPage(1);
          }}
        />

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
        {students.map((student) => (
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
        {!students.length ? (
          <MotionCard className="students-empty-state" hover={false}>
            No students match the current filters.
          </MotionCard>
        ) : null}
      </motion.div>

      {totalPages > 1 ? (
        <div className="students-pagination">
          <MotionButton
            type="button"
            className="students-page-btn"
            disabled={listLoading || page === 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </MotionButton>
          <span className="students-page-indicator">
            {listLoading ? "Updating results…" : `Page ${page} of ${totalPages}`}
          </span>
          <MotionButton
            type="button"
            className="students-page-btn"
            disabled={listLoading || page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Next
          </MotionButton>
        </div>
      ) : null}
    </motion.div>
  );
}
