"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import "./students.css";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard, MotionSection, fadeUpItem, staggerContainer } from "../components/motion/primitives.jsx";
import WhatsAppReminderButton from "../components/reminders/WhatsAppReminderButton.jsx";
import {
  clearAuthSession,
  getAuthName,
  getAuthRole,
  getAuthToken,
} from "../../lib/authStorage.js";
import {
  formatWhatsAppDisplay,
  isValidWhatsAppNumber,
} from "../../lib/whatsapp.js";
// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API_BASE = "";
const PAGE_SIZE = 12;
const ACADEMIC_MONTHS = [
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "January",
  "February",
];
const VALID_MONTH_FILTERS = new Set(ACADEMIC_MONTHS);
const CURRENT_FEE_STATUS_MONTH = new Date().toLocaleString("en-US", { month: "long" });

const normalizeMonthFilterValue = (value) => {
  const rawValue = String(value || "").trim();
  return VALID_MONTH_FILTERS.has(rawValue) ? rawValue : "";
};

export default function StudentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [students, setStudents] = useState([]);
  const [totalStudents, setTotalStudents] = useState(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [page, setPage] = useState(
    () => Math.max(1, Number(searchParams.get("page") || 1) || 1)
  );
  const [search, setSearch] = useState(() => searchParams.get("search") || "");
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get("search") || "");
  const [statusFilter, setStatusFilter] = useState(
    () => searchParams.get("status") || "all"
  );
  const [monthFilter, setMonthFilter] = useState(
    () => normalizeMonthFilterValue(searchParams.get("month"))
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
  const [resolvedMonthLabel, setResolvedMonthLabel] = useState(CURRENT_FEE_STATUS_MONTH);
  const [resolvedAcademicYear, setResolvedAcademicYear] = useState(
    new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1
  );
  const requestKeyRef = useRef("");
  const initialLoadRef = useRef(true);
  const reminderSenderName = getAuthName().trim() || "Flowlytiks";

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
    if (monthFilter) params.set("month", monthFilter);
    if (classFilter !== "all") params.set("class", classFilter);
    if (schoolFilter !== "all") params.set("school", schoolFilter);
    if (sortOrder !== "none") params.set("sort", sortOrder);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    const queryString = params.toString();
    router.replace(queryString ? `/students?${queryString}` : "/students", {
      scroll: false,
    });
  }, [search, page, statusFilter, monthFilter, classFilter, schoolFilter, sortOrder, fromDate, toDate, router]);

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
    if (monthFilter) params.set("month", monthFilter);
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

    let listLoadingTimer = null;
    if (!initialLoadRef.current) {
      listLoadingTimer = window.setTimeout(() => {
        setListLoading(true);
      }, 0);
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
          setResolvedMonthLabel(monthFilter || CURRENT_FEE_STATUS_MONTH);
          setResolvedAcademicYear(
            new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1
          );
          setClasses([...new Set(data.map((student) => student.class).filter(Boolean))]);
          setSchools([...new Set(data.map((student) => student.school).filter(Boolean))]);
          return;
        }

        setStudents(Array.isArray(data.students) ? data.students : []);
        setTotalStudents(typeof data.totalStudents === "number" ? data.totalStudents : 0);
        setResolvedMonthLabel(data.selectedMonth || monthFilter || CURRENT_FEE_STATUS_MONTH);
        setResolvedAcademicYear(
          Number.isFinite(Number(data.selectedAcademicYear))
            ? Number(data.selectedAcademicYear)
            : new Date().getMonth() >= 2
              ? new Date().getFullYear()
              : new Date().getFullYear() - 1
        );
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

    return () => {
      if (listLoadingTimer) {
        window.clearTimeout(listLoadingTimer);
      }
    };
  }, [page, debouncedSearch, statusFilter, monthFilter, classFilter, schoolFilter, sortOrder, fromDate, toDate]);

  // 🔹 CLEAR ALL FILTERS
  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setMonthFilter("");
    setClassFilter("all");
    setSchoolFilter("all");
    setSortOrder("none");
    setFromDate("");
    setToDate("");
    setPage(1);
    setResolvedMonthLabel(CURRENT_FEE_STATUS_MONTH);
    setResolvedAcademicYear(
      new Date().getMonth() >= 2 ? new Date().getFullYear() : new Date().getFullYear() - 1
    );

    router.replace("/students", { scroll: false });
  };

  const buildExportParams = () => {
    const params = new URLSearchParams();
    const nextSearch = search.trim();

    if (nextSearch) params.set("search", nextSearch);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (monthFilter) params.set("month", monthFilter);
    if (classFilter !== "all") params.set("class", classFilter);
    if (schoolFilter !== "all") params.set("school", schoolFilter);
    if (sortOrder !== "none") params.set("sort", sortOrder);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    return params;
  };

  const parseDownloadFileName = (contentDisposition) => {
    const headerValue = String(contentDisposition || "");
    const utfMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch?.[1]) {
      return decodeURIComponent(utfMatch[1]);
    }

    const asciiMatch = headerValue.match(/filename="([^"]+)"/i);
    return asciiMatch?.[1] || "students-export.csv";
  };

  const handleExportCsv = async () => {
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

    setExportLoading(true);

    try {
      const params = buildExportParams();
      const res = await fetch(`${API_BASE}/api/students/export.csv?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearAuthSession();
          window.location.href = "/login";
          return;
        }

        const contentType = res.headers.get("content-type") || "";
        let message = "Failed to export students CSV";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          message = data?.message || message;
        } else {
          const text = await res.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const fileName = parseDownloadFileName(
        res.headers.get("content-disposition")
      );
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Students CSV export error:", err);
      window.alert(err?.message || "Failed to export students CSV.");
    } finally {
      setExportLoading(false);
    }
  };

  const openStudentProfile = (studentId) => {
    router.push(`/students/${studentId}`);
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
      <div className="students-header-row">
        <h1 className="students-title">Students</h1>
        <div className="students-header-actions">
          <MotionButton
            type="button"
            className="students-export-btn"
            onClick={handleExportCsv}
            disabled={exportLoading}
          >
            {exportLoading ? "Exporting…" : "Export CSV"}
          </MotionButton>
          <Link href="/students/add" className="students-add-btn">
            Add Student
          </Link>
        </div>
      </div>

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
          value={monthFilter}
          onChange={(e) => {
            setMonthFilter(normalizeMonthFilterValue(e.target.value));
            setPage(1);
          }}
        >
          <option value="">Current Month ({CURRENT_FEE_STATUS_MONTH})</option>
          {ACADEMIC_MONTHS.map((month) => (
            <option key={month} value={month}>{month}</option>
          ))}
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
        {students.map((student) => {
          const isPaid = student.feesStatus === "paid";
          const hasValidWhatsAppNumber = isValidWhatsAppNumber(student.phone);

          return (
            <motion.article key={student.id} className="student-card" variants={fadeUpItem} whileHover={{ y: -4 }}>
              <div
                className="student-card__content"
                role="link"
                tabIndex={0}
                onClick={() => openStudentProfile(student.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openStudentProfile(student.id);
                  }
                }}
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
                <div className="student-card__whatsapp">
                  <span className="student-card__label">WhatsApp</span>
                  <p>
                    {hasValidWhatsAppNumber
                      ? formatWhatsAppDisplay(student.phone)
                      : "No WhatsApp number"}
                  </p>
                </div>
                <div className="student-card__status">
                  <span className="student-card__label">{resolvedMonthLabel} Fee Status</span>
                  <span className={`fee-status ${isPaid ? "paid" : "unpaid"}`}>
                    {isPaid ? "Paid" : "Unpaid"}
                  </span>
                </div>
              </div>

              {!isPaid ? (
                <div className="student-card__actions">
                  <WhatsAppReminderButton
                    studentId={student.id}
                    monthName={resolvedMonthLabel}
                    academicYear={resolvedAcademicYear}
                    amount={student.monthlyFee ?? 0}
                    studentName={student.name}
                    whatsappNumber={student.phone}
                    senderName={reminderSenderName}
                    reminderState={student.whatsappReminder}
                    wrapperClassName="student-reminder-control"
                    buttonClassName="student-whatsapp-btn"
                    disabledButtonClassName="student-whatsapp-btn student-whatsapp-btn--disabled"
                    noteClassName="student-reminder-note"
                    invalidLabel="No valid WhatsApp number"
                  />
                </div>
              ) : null}
            </motion.article>
          );
        })}
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
