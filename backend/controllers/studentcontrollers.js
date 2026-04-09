import prisma from "../prisma/client.js";
import { getAcademicYear } from "../utils/academicYear.js";
import { legacyPaymentSelect } from "../utils/paymentCompat.js";

const stripStudentSecrets = (student) => {
  if (!student || typeof student !== "object") return student;
  const safe = { ...student };
  delete safe.password;
  return safe;
};

const currentMonthName = () =>
  new Date().toLocaleString("en-US", { month: "long" });

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

const hasStructuredStudentQuery = (query) => [
  "page",
  "limit",
  "search",
  "status",
  "class",
  "school",
  "from",
  "to",
  "sort",
  "compact",
  "includeSummary",
  "includeFilters",
].some((key) => key in query);

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
    const currentMonth = currentMonthName();

    if (!hasStructuredStudentQuery(req.query)) {
      const students = await prisma.student.findMany({
        select: {
          ...studentBaseSelect,
          payments: {
            select: legacyPaymentSelect,
          },
        },
        orderBy: { name: "asc" },
      });

      const enriched = students.map((student) => {
        const hasPaidCurrentMonth = student.payments.some(
          (payment) =>
            payment.status === "paid" &&
            payment.academicYear === currentAcademicYear &&
            payment.month === currentMonth
        );

        return {
          ...stripStudentSecrets(student),
          feesStatus: hasPaidCurrentMonth ? "paid" : "unpaid",
        };
      });

      return res.json(enriched);
    }

    const page = parsePositiveInt(req.query.page, 1, 10_000);
    const limit = parsePositiveInt(req.query.limit, 12, 100);
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

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      payments: {
        select: {
          month: true,
          status: true,
          academicYear: true,
        },
      },
    },
  });

  if (!student) return;

  const paidMonths = student.payments
    .filter(
      (p) =>
        p.status === "paid" &&
        p.academicYear === academicYear &&
        p.month
    )
    .map((p) => p.month);

  const uniqueMonths = [...new Set(paidMonths)];

  if (uniqueMonths.length !== 12) return;

  const currentClassNum = parseInt(student.class, 10);
  if (isNaN(currentClassNum)) return;

  await prisma.student.update({
    where: { id: studentId },
    data: {
      class: String(currentClassNum + 1),
    },
  });

  console.log(
    `✅ Auto-promoted ${student.name} for academic year ${academicYear}`
  );
};
