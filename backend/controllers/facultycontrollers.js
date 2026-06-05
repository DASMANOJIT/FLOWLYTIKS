import bcrypt from "bcryptjs";
import prisma from "../prisma/client.js";
import { logInfo, logError, buildRequestLogMeta } from "../utils/appLogger.js";
import { successResponse, errorResponse } from "../utils/apiResponse.js";

const FACULTY_SELECT = {
  id: true,
  facultyId: true,
  username: true,
  fullName: true,
  email: true,
  phone: true,
  gender: true,
  dob: true,
  address: true,
  designation: true,
  qualification: true,
  experienceYears: true,
  joiningDate: true,
  employmentType: true,
  salaryType: true,
  salaryAmount: true,
  paymentNotes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

const normalizePhone = (value) => String(value || "").replace(/\D/g, "");

const toFacultyDto = (faculty) => ({
  ...faculty,
  salaryAmount:
    faculty?.salaryAmount === null || faculty?.salaryAmount === undefined
      ? null
      : Number(faculty.salaryAmount),
});

const buildFacultyWhere = ({ searchName, searchPhone, status }) => {
  const where = {};

  if (searchName) {
    where.fullName = { contains: searchName, mode: "insensitive" };
  }

  if (searchPhone) {
    where.phone = { contains: searchPhone };
  }

  if (status && status !== "all") {
    where.status = status;
  }

  return where;
};

const isMissingColumnOrTableError = (error) =>
  error?.code === "P2021" ||
  error?.code === "P2022" ||
  /does not exist|column .* does not exist/i.test(String(error?.message || ""));

const facultyTableExists = async (tableName) => {
  const rows = await prisma.$queryRaw`SELECT to_regclass(${tableName})::text AS name`;
  return Boolean(rows?.[0]?.name);
};

const getFacultyColumns = async () => {
  const rows = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Faculty'
  `;
  return new Set(rows.map((row) => row.column_name));
};

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const legacyFacultyExpression = (columns, column, fallback = "NULL") =>
  columns.has(column) ? quoteIdentifier(column) : fallback;

const getFacultyLegacyList = async ({ req, pageNum, limitNum, skip }) => {
  const columns = await getFacultyColumns();
  if (!columns.size) {
    return { facultyRows: [], total: 0, totalFaculty: 0, activeFaculty: 0, inactiveFaculty: 0 };
  }

  const whereParts = [];
  const values = [];
  const pushValue = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (req.query.searchName && columns.has("fullName")) {
    whereParts.push(`"fullName" ILIKE ${pushValue(`%${req.query.searchName}%`)}`);
  }
  if (req.query.searchPhone && columns.has("phone")) {
    whereParts.push(`"phone" ILIKE ${pushValue(`%${req.query.searchPhone}%`)}`);
  }
  if (req.query.status && req.query.status !== "all" && columns.has("status")) {
    whereParts.push(`UPPER("status"::text) = ${pushValue(String(req.query.status).toUpperCase())}`);
  }

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const countValues = [...values];
  const activeStatusSql = columns.has("status") ? `WHERE UPPER("status"::text) = 'ACTIVE'` : "";
  const inactiveStatusSql = columns.has("status") ? `WHERE UPPER("status"::text) IN ('INACTIVE', 'DELETED')` : "WHERE false";
  const createdOrderSql = columns.has("createdAt") ? `"createdAt" DESC` : `"id" DESC`;

  const selectSql = `
    SELECT
      ${legacyFacultyExpression(columns, "id")} AS "id",
      ${legacyFacultyExpression(columns, "facultyId", "'-'")} AS "facultyId",
      ${legacyFacultyExpression(columns, "username", "NULL")} AS "username",
      ${legacyFacultyExpression(columns, "fullName", "'Unnamed Faculty'")} AS "fullName",
      ${legacyFacultyExpression(columns, "email", "NULL")} AS "email",
      ${legacyFacultyExpression(columns, "phone", "''")} AS "phone",
      ${legacyFacultyExpression(columns, "gender", "NULL")} AS "gender",
      ${legacyFacultyExpression(columns, "dob", "NULL")} AS "dob",
      ${legacyFacultyExpression(columns, "address", "NULL")} AS "address",
      ${legacyFacultyExpression(columns, "designation", "NULL")} AS "designation",
      ${legacyFacultyExpression(columns, "qualification", "NULL")} AS "qualification",
      ${legacyFacultyExpression(columns, "experienceYears", "NULL")} AS "experienceYears",
      ${legacyFacultyExpression(columns, "joiningDate", "NULL")} AS "joiningDate",
      ${legacyFacultyExpression(columns, "employmentType", "NULL")} AS "employmentType",
      ${legacyFacultyExpression(columns, "salaryType", "'ATTENDANCE_BASED'")} AS "salaryType",
      ${legacyFacultyExpression(columns, "salaryAmount", "NULL")} AS "salaryAmount",
      ${legacyFacultyExpression(columns, "paymentNotes", "NULL")} AS "paymentNotes",
      ${legacyFacultyExpression(columns, "status", "'ACTIVE'")} AS "status",
      ${legacyFacultyExpression(columns, "createdAt", "NULL")} AS "createdAt",
      ${legacyFacultyExpression(columns, "updatedAt", "NULL")} AS "updatedAt"
    FROM "Faculty"
    ${whereSql}
    ORDER BY ${createdOrderSql}
    LIMIT ${pushValue(limitNum)} OFFSET ${pushValue(skip)}
  `;

  const facultyRows = await prisma.$queryRawUnsafe(selectSql, ...values);
  const countRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "Faculty" ${whereSql}`, ...countValues);
  const totalRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "Faculty"`);
  const activeRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "Faculty" ${activeStatusSql}`);
  const inactiveRows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM "Faculty" ${inactiveStatusSql}`);

  logInfo("faculty.fetch.legacy_success", buildRequestLogMeta(req, { returned: facultyRows.length, page: pageNum }));

  return {
    facultyRows,
    total: Number(countRows?.[0]?.count || 0),
    totalFaculty: Number(totalRows?.[0]?.count || 0),
    activeFaculty: Number(activeRows?.[0]?.count || 0),
    inactiveFaculty: Number(inactiveRows?.[0]?.count || 0),
  };
};

const sendFacultyListResponse = (res, { facultyRows, total, totalFaculty, activeFaculty, inactiveFaculty, pageNum, limitNum }) =>
  successResponse(res, {
    faculty: facultyRows.map(toFacultyDto),
    items: facultyRows.map(toFacultyDto),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(Math.ceil(total / limitNum), 1),
    },
    stats: {
      totalFaculty,
      activeFaculty,
      inactiveFaculty,
    },
    counts: {
      total: totalFaculty,
      active: activeFaculty,
      inactive: inactiveFaculty,
    },
  });

const generateFacultyId = async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(734001)`;
  const rows = await tx.faculty.findMany({
    select: { facultyId: true },
  });
  const maxValue = rows.reduce((max, row) => {
    const match = String(row.facultyId || "").match(/^FAC(\d+)$/);
    const value = match ? Number.parseInt(match[1], 10) : 0;
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);
  const nextValue = maxValue + 1;
  return `FAC${String(nextValue).padStart(4, "0")}`;
};

const handleFacultyError = (res, error) => {
  console.error("Faculty API error:", {
    code: error?.code,
    message: error?.message || error,
    meta: error?.meta,
  });

  if (error?.code === "P2002") {
    const target = Array.isArray(error.meta?.target)
      ? error.meta.target.join(", ")
      : "field";
    return res.status(409).json({
      success: false,
      message: `A faculty member with this ${target} already exists.`,
    });
  }

  return res.status(500).json({
    success: false,
    message:
      error?.code === "P2021" || error?.code === "P2022" || /does not exist/i.test(String(error?.message || ""))
        ? "Faculty database schema is not ready. Please run the latest migrations."
        : "Faculty request failed. Please try again.",
  });
};

export const createFaculty = async (req, res) => {
  try {
    const faculty = await prisma.$transaction(async (tx) => {
      const facultyId = await generateFacultyId(tx);
      const { password, confirmPassword, ...facultyData } = req.body;
      const passwordHash = await bcrypt.hash(password, 10);
      return tx.faculty.create({
        data: {
          ...facultyData,
          phone: normalizePhone(facultyData.phone),
          facultyId,
          username: facultyId,
          passwordHash,
          adminId: Number(req.user?.id || 0) || null,
        },
        select: FACULTY_SELECT,
      });
    });

    logInfo("faculty.created", {
      id: faculty.id,
      facultyId: faculty.facultyId,
      username: faculty.username,
      adminId: req.user?.id || null,
    });
    return res.status(201).json({ success: true, faculty: toFacultyDto(faculty) });
  } catch (error) {
    return handleFacultyError(res, error);
  }
};

export const getFaculty = async (req, res) => {
  try {
    const where = buildFacultyWhere(req.query);
    // Coerce page/limit to numbers (validation middleware should ensure this,
    // but be defensive to avoid NaN skip calculation causing empty results).
    const pageNum = Number(req.query.page) || 1;
    const limitNum = Number(req.query.limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Minimal request logging to help diagnose missing faculty records.
    logInfo("faculty.fetch.start", buildRequestLogMeta(req, {
      page: pageNum,
      limit: limitNum,
      whereClause: where,
    }));

    const [facultyRows, total, totalFaculty, activeFaculty, inactiveFaculty] =
      await Promise.all([
        prisma.faculty.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limitNum,
        select: FACULTY_SELECT,
      }),
        prisma.faculty.count({ where }),
        prisma.faculty.count(),
        prisma.faculty.count({ where: { status: "ACTIVE" } }),
        prisma.faculty.count({ where: { status: "INACTIVE" } }),
      ]);
    logInfo("faculty.fetch.success", buildRequestLogMeta(req, {
      returned: facultyRows.length,
      totalMatching: total,
    }));

    return sendFacultyListResponse(res, {
      facultyRows,
      total,
      totalFaculty,
      activeFaculty,
      inactiveFaculty,
      pageNum,
      limitNum,
    });
  } catch (error) {
    if (isMissingColumnOrTableError(error)) {
      try {
        const pageNum = Number(req.query.page) || 1;
        const limitNum = Number(req.query.limit) || 10;
        const skip = (pageNum - 1) * limitNum;
        const legacyResult = await getFacultyLegacyList({ req, pageNum, limitNum, skip });
        return sendFacultyListResponse(res, { ...legacyResult, pageNum, limitNum });
      } catch (fallbackError) {
        logError("faculty.fetch.legacy_error", buildRequestLogMeta(req, { error: fallbackError?.message || String(fallbackError) }));
      }
    }

    // Structured error logging for production diagnostics (no sensitive data)
    try {
      logError("faculty.fetch.error", buildRequestLogMeta(req, { error: error?.message || String(error) }));
    } catch (e) {
      // swallow logging errors to avoid masking the original error
    }

    // Ensure a stable JSON error response
    return errorResponse(
      res,
      error?.code === "P2021" || error?.code === "P2022" || /does not exist/i.test(String(error?.message || ""))
        ? "Faculty database schema is not ready. Please run the latest migrations."
        : "Faculty request failed. Please try again.",
      500
    );
  }
};

export const getMyFacultyProfile = async (req, res) => {
  try {
    if (req.userRole !== "faculty") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    return res.json({ success: true, faculty: toFacultyDto(req.user) });
  } catch (error) {
    return handleFacultyError(res, error);
  }
};

export const updateMyFacultyProfile = async (req, res) => {
  try {
    if (req.userRole !== "faculty") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const faculty = await prisma.faculty.update({
      where: { id: req.user.id },
      data: req.body,
      select: FACULTY_SELECT,
    });
    return res.json({ success: true, faculty: toFacultyDto(faculty) });
  } catch (error) {
    return handleFacultyError(res, error);
  }
};

export const changeMyFacultyPassword = async (req, res) => {
  try {
    if (req.userRole !== "faculty") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const faculty = await prisma.faculty.findUnique({
      where: { id: req.user.id },
      select: { id: true, passwordHash: true },
    });
    const isMatch = faculty
      ? await bcrypt.compare(req.body.currentPassword, faculty.passwordHash)
      : false;
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }
    const passwordHash = await bcrypt.hash(req.body.newPassword, 10);
    await prisma.faculty.update({
      where: { id: req.user.id },
      data: { passwordHash },
    });
    return res.json({ success: true, message: "Password changed successfully." });
  } catch (error) {
    return handleFacultyError(res, error);
  }
};

export const getFacultyById = async (req, res) => {
  try {
    const faculty = await prisma.faculty.findUnique({
      where: { id: req.params.id },
      select: FACULTY_SELECT,
    });

    if (!faculty) {
      return res.status(404).json({ success: false, message: "Faculty member not found." });
    }

    return res.json({ success: true, faculty: toFacultyDto(faculty) });
  } catch (error) {
    return handleFacultyError(res, error);
  }
};

export const updateFaculty = async (req, res) => {
  try {
    const faculty = await prisma.faculty.update({
      where: { id: req.params.id },
      data: {
        ...req.body,
        phone: normalizePhone(req.body.phone),
      },
      select: FACULTY_SELECT,
    });

    return res.json({ success: true, faculty: toFacultyDto(faculty) });
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ success: false, message: "Faculty member not found." });
    }
    return handleFacultyError(res, error);
  }
};

export const updateFacultyStatus = async (req, res) => {
  try {
    const faculty = await prisma.faculty.update({
      where: { id: req.params.id },
      data: { status: req.body.status },
      select: FACULTY_SELECT,
    });

    return res.json({ success: true, faculty: toFacultyDto(faculty) });
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ success: false, message: "Faculty member not found." });
    }
    return handleFacultyError(res, error);
  }
};

export const deleteFaculty = async (req, res) => {
  try {
    const facultyId = req.params.id;
    await prisma.faculty.update({
      where: { id: facultyId },
      data: { status: "INACTIVE" },
    });

    return res.json({ success: true, message: "Faculty member deleted successfully." });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    if (error?.code === "P2025") {
      return res.status(404).json({ success: false, message: "Faculty member not found." });
    }
    return handleFacultyError(res, error);
  }
};
