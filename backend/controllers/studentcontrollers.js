import prisma from "../prisma/client.js";
import {
  getAcademicYear,
  getPromotionDateGate,
} from "../utils/academicYear.js";
import { legacyPaymentSelect } from "../utils/paymentCompat.js";
import { isStudentEligibleForPromotion } from "../services/promotionService.js";

const stripStudentSecrets = (student) => {
  if (!student || typeof student !== "object") return student;
  const safe = { ...student };
  delete safe.password;
  return safe;
};

const currentMonthName = () =>
  new Date().toLocaleString("en-US", { month: "long" });

const VALID_PAYMENT_MONTHS = new Set([
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
]);

const studentBaseSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  school: true,
  class: true,
  joinDate: true,
  monthlyFee: true,
  isVerified: true,
  isTwoFactorEnabled: true,
  createdAt: true,
  updatedAt: true,
};

const studentListCompactSelect = {
  id: true,
  name: true,
  phone: true,
  school: true,
  class: true,
};

const parsePositiveInt = (value, fallback, max = 100) => {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, max);
};

const normalizeDateBoundary = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  return date;
};

const normalizeStudentMonthFilter = (value) => {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  const normalized = `${rawValue.charAt(0).toUpperCase()}${rawValue.slice(1).toLowerCase()}`;
  return VALID_PAYMENT_MONTHS.has(normalized) ? normalized : "";
};

const buildStudentWhere = ({
  search,
  statusFilter,
  classFilter,
  schoolFilter,
  fromDate,
  toDate,
  currentMonth,
  currentAcademicYear,
}) => {
  const where = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ];
  }

  if (classFilter && classFilter !== "all") {
    where.class = classFilter;
  }

  if (schoolFilter && schoolFilter !== "all") {
    where.school = schoolFilter;
  }

  if (fromDate || toDate) {
    where.joinDate = {};
    if (fromDate) where.joinDate.gte = fromDate;
    if (toDate) where.joinDate.lte = toDate;
  }

  if (statusFilter === "paid") {
    where.payments = {
      some: {
        academicYear: currentAcademicYear,
        month: currentMonth,
        status: "paid",
      },
    };
  } else if (statusFilter === "unpaid") {
    where.payments = {
      none: {
        academicYear: currentAcademicYear,
        month: currentMonth,
        status: "paid",
      },
    };
  }

  return where;
};

const buildAdminDashboardSummary = async ({
  currentAcademicYear,
  currentMonth,
}) => {
  const [totalStudents, paidStudents, settings, revenue] = await Promise.all([
    prisma.student.count(),
    prisma.payment.findMany({
      where: {
        academicYear: currentAcademicYear,
        month: currentMonth,
        status: "paid",
      },
      select: { studentId: true },
      distinct: ["studentId"],
    }),
    prisma.appSettings.findUnique({
      where: { id: 1 },
      select: { monthlyFee: true },
    }),
    prisma.payment.aggregate({
      _sum: { amount: true },
      where: { status: "paid" },
    }),
  ]);

  const paidCount = paidStudents.length;

  return {
    totalStudents,
    paid: paidCount,
    unpaid: Math.max(totalStudents - paidCount, 0),
    revenue: revenue._sum.amount ?? 0,
    monthlyFee: settings?.monthlyFee ?? 0,
  };
};

// =======================
// ADMIN: GET ALL STUDENTS (WITH PAYMENT STATUS)
// =======================
export const getStudents = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const currentAcademicYear = getAcademicYear();
    const requestedMonth = normalizeStudentMonthFilter(req.query.month);
    if (req.query.month && !requestedMonth) {
      return res.status(400).json({ message: "Invalid month filter" });
    }
    const currentMonth = requestedMonth || currentMonthName();
    const page = parsePositiveInt(req.query.page, 1, 10_000);
    const limit = parsePositiveInt(req.query.limit, 25, 100);
    const search = String(req.query.search || "").trim();
    const statusFilter = String(req.query.status || "all");
    const classFilter = String(req.query.class || "all");
    const schoolFilter = String(req.query.school || "all");
    const sortOrder = String(req.query.sort || "az");
    const compact = req.query.compact === "1";
    const includeSummary = req.query.includeSummary === "1";
    const includeFilters = req.query.includeFilters === "1";

    const fromDate =
      req.query.from && !normalizeDateBoundary(req.query.from)
        ? null
        : normalizeDateBoundary(req.query.from);
    const toDate =
      req.query.to && !normalizeDateBoundary(req.query.to, true)
        ? null
        : normalizeDateBoundary(req.query.to, true);

    if ((req.query.from && !fromDate) || (req.query.to && !toDate)) {
      return res.status(400).json({ message: "Invalid date filter" });
    }

    const where = buildStudentWhere({
      search,
      statusFilter,
      classFilter,
      schoolFilter,
      fromDate,
      toDate,
      currentMonth,
      currentAcademicYear,
    });

    const orderBy =
      sortOrder === "az" ? { name: "asc" } : { createdAt: "desc" };

    const studentSelect = compact
      ? studentListCompactSelect
      : {
          ...studentBaseSelect,
          payments: {
            where: {
              academicYear: currentAcademicYear,
              month: currentMonth,
              status: "paid",
            },
            select: { id: true },
            take: 1,
          },
        };

    const tasks = [
      prisma.student.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: studentSelect,
      }),
      prisma.student.count({ where }),
      prisma.student.count(),
    ];

    if (includeFilters) {
      tasks.push(
        prisma.student.findMany({
          select: { class: true },
          distinct: ["class"],
        }),
        prisma.student.findMany({
          select: { school: true },
          distinct: ["school"],
        })
      );
    }

    if (includeSummary) {
      tasks.push(
        buildAdminDashboardSummary({
          currentAcademicYear,
          currentMonth,
        })
      );
    }

    const results = await Promise.all(tasks);
    const studentRows = results[0];
    const filteredStudents = results[1];
    const totalStudents = results[2];
    let cursor = 3;

    let filters = undefined;
    if (includeFilters) {
      const classRows = results[cursor];
      const schoolRows = results[cursor + 1];
      cursor += 2;
      filters = {
        classes: classRows
          .map((row) => row.class)
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right)),
        schools: schoolRows
          .map((row) => row.school)
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right)),
      };
    }

    const summary = includeSummary ? results[cursor] : undefined;

    const students = studentRows.map((student) => {
      if (compact) {
        return stripStudentSecrets(student);
      }

      const { payments, ...rest } = student;
      return {
        ...stripStudentSecrets(rest),
        feesStatus: payments.length ? "paid" : "unpaid",
      };
    });

    const totalPages = Math.max(1, Math.ceil(filteredStudents / limit));

    return res.json({
      students,
      totalStudents,
      filteredStudents,
      page,
      limit,
      selectedMonth: currentMonth,
      totalPages,
      ...(filters ? { filters } : {}),
      ...(summary ? { summary } : {}),
    });
  } catch (err) {
    console.error("getStudents error:", err);
    res.status(500).json({ message: "Failed to fetch students" });
  }
};

// =======================
// ADMIN: GET TOTAL STUDENT COUNT
// =======================
export const getStudentCount = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const totalStudents = await prisma.student.count();
    res.json({ totalStudents });
  } catch (err) {
    console.error("getStudentCount error:", err);
    res.status(500).json({ message: "Failed to fetch student count" });
  }
};

// =======================
// STUDENT: OWN PROFILE (GET)
// =======================
export const getLoggedInStudent = async (req, res) => {
  try {
    if (req.userRole !== "student") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const studentId = Number(req.user.id);

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: studentBaseSelect,
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.json(stripStudentSecrets(student));
  } catch (err) {
    console.error("getLoggedInStudent error:", err);
    res.status(500).json({ message: "Failed to fetch student profile" });
  }
};

// =======================
// ❌ REMOVE MANUAL PROFILE UPDATE
// Student cannot update class/school manually
// =======================
// export const updateLoggedInStudent = async (req, res) => { ... }
// removed to prevent manual class update

// =======================
// GET STUDENT BY ID
// =======================
export const getStudentById = async (req, res) => {
  try {
    const studentId = Number(req.params.id);

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        ...studentBaseSelect,
        payments: {
          select: legacyPaymentSelect,
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.json(stripStudentSecrets(student));
  } catch (err) {
    console.error("getStudentById error:", err);
    res.status(500).json({ message: "Failed to fetch student" });
  }
};

// =======================
// ADMIN: DELETE STUDENT
// =======================
export const deleteStudent = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const studentId = Number(req.params.id);

    await prisma.payment.deleteMany({ where: { studentId } });
    await prisma.student.delete({ where: { id: studentId } });

    res.json({ message: "Student deleted successfully" });
  } catch (err) {
    console.error("deleteStudent error:", err);
    res.status(500).json({ message: "Failed to delete student" });
  }
};

// =======================
// AUTO PROMOTION (INTERNAL USE)
// =======================
export const autoPromoteIfEligible = async (
  studentId,
  targetAcademicYear = getAcademicYear()
) => {
  const academicYear = Number(targetAcademicYear);
  const gate = getPromotionDateGate();

  if (!gate.allowed || Number(gate.academicYear) !== academicYear) {
    return {
      promoted: false,
      academicYear,
      reason: "date_gate_closed",
      gate,
    };
  }

  const eligibility = await isStudentEligibleForPromotion(studentId, academicYear);

  return {
    promoted: false,
    academicYear,
    reason: eligibility.eligible ? "worker_job_required" : "not_eligible",
    ...eligibility,
  };
};
