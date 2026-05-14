import prisma from "../prisma/client.js";
import {
  getAcademicYear,
  getPromotionDateGate,
} from "../utils/academicYear.js";
import { legacyPaymentSelect } from "../utils/paymentCompat.js";
import { isStudentEligibleForPromotion } from "../services/promotionService.js";
import {
  buildWhatsAppReminderState,
  WHATSAPP_REMINDER_CHANNEL,
} from "../services/reminderCooldownService.js";
import { findMatchingClassSchoolGroupForStudent } from "../services/classSchoolGroupService.js";

const stripStudentSecrets = (student) => {
  if (!student || typeof student !== "object") return student;
  const safe = { ...student };
  delete safe.password;
  delete safe.adminId;
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
  adminId: true,
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

const normalizeAcademicYearFilter = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) {
    return null;
  }

  return parsed;
};

const resolveStudentListQuery = (query = {}) => {
  const currentAcademicYear = normalizeAcademicYearFilter(
    query.academicYear,
    getAcademicYear()
  );
  if (query.academicYear && currentAcademicYear === null) {
    return { error: "Invalid academic year" };
  }

  const requestedMonth = normalizeStudentMonthFilter(query.month);
  if (query.month && !requestedMonth) {
    return { error: "Invalid month filter" };
  }

  const currentMonth = requestedMonth || currentMonthName();
  const page = parsePositiveInt(query.page, 1, 10_000);
  const limit = parsePositiveInt(query.limit, 25, 100);
  const search = String(query.search || "").trim();
  const statusFilter = String(query.status || "all");
  const classFilter = String(query.class || "all");
  const schoolFilter = String(query.school || "all");
  const sortOrder = String(query.sort || "az");
  const compact = query.compact === "1";
  const includeSummary = query.includeSummary === "1";
  const includeFilters = query.includeFilters === "1";

  const fromDate =
    query.from && !normalizeDateBoundary(query.from)
      ? null
      : normalizeDateBoundary(query.from);
  const toDate =
    query.to && !normalizeDateBoundary(query.to, true)
      ? null
      : normalizeDateBoundary(query.to, true);

  if ((query.from && !fromDate) || (query.to && !toDate)) {
    return { error: "Invalid date filter" };
  }

  return {
    currentAcademicYear,
    requestedMonth,
    currentMonth,
    page,
    limit,
    search,
    statusFilter,
    classFilter,
    schoolFilter,
    sortOrder,
    compact,
    includeSummary,
    includeFilters,
    fromDate,
    toDate,
  };
};

const buildStudentOrderBy = (sortOrder) =>
  sortOrder === "az" ? { name: "asc" } : { createdAt: "desc" };

const safeCsvCell = (value) => {
  const normalized = value === null || value === undefined ? "" : String(value);
  const formulaSafe = /^[=+\-@]/.test(normalized) ? `'${normalized}` : normalized;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
};

const formatCsvDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

const resolveStudentMonthPaymentStatus = ({
  studentPayments,
  currentMonth,
}) => {
  const monthPayment = studentPayments.find(
    (payment) => String(payment.month || "") === String(currentMonth)
  );

  if (!monthPayment) return "missing/unpaid";

  const status = String(monthPayment.status || "").trim().toLowerCase();
  return status || "missing/unpaid";
};

const resolveAcademicYearPaymentSummary = (studentPayments = []) => {
  const paidMonths = new Set(
    studentPayments
      .filter(
        (payment) =>
          String(payment.status || "").trim().toLowerCase() === "paid" &&
          VALID_PAYMENT_MONTHS.has(String(payment.month || ""))
      )
      .map((payment) => payment.month)
  );

  return {
    totalPaidMonths: paidMonths.size,
    totalUnpaidMonths: Math.max(VALID_PAYMENT_MONTHS.size - paidMonths.size, 0),
  };
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

    const resolvedQuery = resolveStudentListQuery(req.query);
    if (resolvedQuery.error) {
      return res.status(400).json({ message: resolvedQuery.error });
    }
    const {
      currentAcademicYear,
      currentMonth,
      page,
      limit,
      search,
      statusFilter,
      classFilter,
      schoolFilter,
      sortOrder,
      compact,
      includeSummary,
      includeFilters,
      fromDate,
      toDate,
    } = resolvedQuery;

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

    const orderBy = buildStudentOrderBy(sortOrder);

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
          feeReminderLogs: {
            where: {
              academicYear: currentAcademicYear,
              month: currentMonth,
              channel: WHATSAPP_REMINDER_CHANNEL,
            },
            select: {
              lastRemindedAt: true,
            },
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

      const { payments, feeReminderLogs, ...rest } = student;
      const isPaid = payments.length > 0;
      return {
        ...stripStudentSecrets(rest),
        feesStatus: isPaid ? "paid" : "unpaid",
        whatsappReminder: buildWhatsAppReminderState({
          isPaid,
          lastRemindedAt: feeReminderLogs[0]?.lastRemindedAt || null,
        }),
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
      selectedAcademicYear: currentAcademicYear,
      totalPages,
      ...(filters ? { filters } : {}),
      ...(summary ? { summary } : {}),
    });
  } catch (err) {
    console.error("getStudents error:", err);
    res.status(500).json({ message: "Failed to fetch students" });
  }
};

export const exportStudentsCsv = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const resolvedQuery = resolveStudentListQuery(req.query);
    if (resolvedQuery.error) {
      return res.status(400).json({ message: resolvedQuery.error });
    }

    const {
      currentAcademicYear,
      currentMonth,
      search,
      statusFilter,
      classFilter,
      schoolFilter,
      sortOrder,
      fromDate,
      toDate,
    } = resolvedQuery;

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

    const students = await prisma.student.findMany({
      where,
      orderBy: buildStudentOrderBy(sortOrder),
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        class: true,
        school: true,
        monthlyFee: true,
        createdAt: true,
        updatedAt: true,
        payments: {
          where: {
            academicYear: currentAcademicYear,
            month: {
              in: [...VALID_PAYMENT_MONTHS],
            },
          },
          select: {
            month: true,
            status: true,
          },
        },
      },
    });

    const headers = [
      "Student ID",
      "Name",
      "Email",
      "Phone",
      "Class",
      "School",
      "Monthly Fee",
      "Selected Month",
      "Selected Month Payment Status",
      "Academic Year",
      "Total Paid Months",
      "Total Unpaid Months",
      "Created At",
      "Last Updated At",
    ];

    const rows = students.map((student) => {
      const summary = resolveAcademicYearPaymentSummary(student.payments);
      const selectedMonthStatus = resolveStudentMonthPaymentStatus({
        studentPayments: student.payments,
        currentMonth,
      });

      return [
        student.id,
        student.name,
        student.email || "",
        student.phone || "",
        student.class || "",
        student.school || "",
        student.monthlyFee ?? "",
        currentMonth,
        selectedMonthStatus,
        currentAcademicYear,
        summary.totalPaidMonths,
        summary.totalUnpaidMonths,
        formatCsvDate(student.createdAt),
        formatCsvDate(student.updatedAt),
      ];
    });

    const csvContent = [
      headers.map(safeCsvCell).join(","),
      ...rows.map((row) => row.map(safeCsvCell).join(",")),
    ].join("\n");

    const exportDate = new Date().toISOString().slice(0, 10);
    const fileName = `students-export-${exportDate}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    return res.status(200).send(`\uFEFF${csvContent}`);
  } catch (err) {
    console.error("exportStudentsCsv error:", err);
    return res.status(500).json({ message: "Failed to export students CSV" });
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

    const classSchoolGroup = await findMatchingClassSchoolGroupForStudent(student);

    res.json({
      ...stripStudentSecrets(student),
      classSchoolGroup: classSchoolGroup
        ? {
            className: classSchoolGroup.className,
            schoolName: classSchoolGroup.schoolName,
            whatsappGroupLink: classSchoolGroup.whatsappGroupLink,
          }
        : null,
    });
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
