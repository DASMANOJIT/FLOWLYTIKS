import { Prisma } from "@prisma/client";
import prisma from "../prisma/client.js";
import { staffSelect } from "./staffAuthService.js";

const fail = message => Object.assign(new Error(message), { status: 400 });
const text = (value, max = 120) => {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > max) throw fail("Invalid overview filter.");
  return value.trim();
};
export function overviewFilters(query = {}, statuses = []) {
  const page = Number(query.page || 1), pageSize = Number(query.pageSize || 20);
  if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw fail("Invalid pagination.");
  const staffId = text(query.staffId, 64), search = text(query.search), status = text(query.status) || "all";
  if (staffId && !/^[a-zA-Z0-9_-]{10,64}$/.test(staffId)) throw fail("Invalid Staff ID.");
  if (status !== "all" && !statuses.includes(status)) throw fail("Invalid status filter.");
  const dates = {};
  for (const field of ["from", "to"]) {
    const value = text(query[field], 10);
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw fail("Invalid date range.");
    dates[field] = new Date(`${value}T00:00:00+05:30`);
  }
  if (dates.from && dates.to && dates.from > dates.to) throw fail("From date must not be after To date.");
  const createdAt = { ...(dates.from ? { gte: dates.from } : {}), ...(dates.to ? { lt: new Date(dates.to.getTime() + 86400000) } : {}) };
  return { page, pageSize, staffId, search, status, createdAt, skip: (page - 1) * pageSize };
}
const pagination = (filter, total) => ({ page: filter.page, pageSize: filter.pageSize, total, pages: Math.ceil(total / filter.pageSize) });
const orderBy = [{ createdAt: "desc" }, { id: "desc" }];
const studentSelect = { id: true, name: true, class: true, phone: true };

export async function readAdminStaffMembers(query, db = prisma) {
  const f = overviewFilters(query, ["active", "inactive"]);
  const where = { createdAt: f.createdAt, ...(f.staffId ? { id: f.staffId } : {}), ...(f.status === "all" ? {} : { isActive: f.status === "active" }) };
  if (f.search) where.OR = ["name", "email", "id"].map(field => ({ [field]: { contains: f.search, mode: "insensitive" } }));
  return db.$transaction(async tx => {
    const total = await tx.staff.count({ where });
    const rows = await tx.staff.findMany({ where, select: staffSelect, orderBy, skip: f.skip, take: f.pageSize });
    return { success: true, rows, pagination: pagination(f, total) };
  }, { isolationLevel: "RepeatableRead" });
}
export async function readAdminFollowUps(query, db = prisma) {
  const f = overviewFilters(query);
  const where = { createdAt: f.createdAt, ...(f.staffId ? { staffId: f.staffId } : {}) };
  if (f.search) {
    where.OR = [{ note: { contains: f.search, mode: "insensitive" } }, { student: { name: { contains: f.search, mode: "insensitive" } } }, { student: { phone: { contains: f.search } } }, { staff: { name: { contains: f.search, mode: "insensitive" } } }];
    if (/^\d+$/.test(f.search) && Number(f.search) <= 2147483647) where.OR.push({ studentId: Number(f.search) });
  }
  return db.$transaction(async tx => {
    const total = await tx.staffStudentFollowUp.count({ where });
    const rows = await tx.staffStudentFollowUp.findMany({ where, orderBy, skip: f.skip, take: f.pageSize, select: { id: true, note: true, createdAt: true, student: { select: studentSelect }, staff: { select: { id: true, name: true } } } });
    return { success: true, rows, pagination: pagination(f, total), unavailableFields: ["Call status", "Expected payment date", "Next follow-up date"] };
  }, { isolationLevel: "RepeatableRead" });
}

// Audit attribution is the source of truth; an un-attributed Payment is never assigned to Staff.
const cashSource = Prisma.sql`
  SELECT a."id", a."actorId" AS "staffId", COALESCE(a."actorName", st."name") AS "staffName",
    s."id" AS "studentId", s."name" AS "studentName", s."class" AS "studentClass", s."phone" AS "contact",
    a."metadataJson"->>'studentId' AS "recordedStudentId", a."entityId" AS "paymentId",
    COALESCE(a."metadataJson"->>'month', p."month") AS "month",
    COALESCE(a."metadataJson"->>'academicYear', p."academicYear"::text) AS "academicYear",
    COALESCE(a."metadataJson"->>'amount', p."amount"::text) AS "amount",
    COALESCE(a."metadataJson"->>'reference', a."entityId") AS "reference",
    COALESCE(a."metadataJson"->>'paidAt', p."paidAt"::text) AS "paidAt", a."createdAt",
    CASE WHEN EXISTS (SELECT 1 FROM "AuditLog" r WHERE r."entityType" = 'Payment' AND r."entityId" = a."entityId"
      AND r."action" IN ('PAYMENT_REVERSED', 'PAYMENT_MARKED_UNPAID') AND r."createdAt" >= a."createdAt") THEN 'reversed'
      WHEN p."id" IS NULL THEN 'removed'
      WHEN p."paymentProvider" IS DISTINCT FROM 'CASH'::"PaymentProvider" THEN 'changed'
      WHEN EXISTS (SELECT 1 FROM "AuditLog" newer WHERE newer."actorType" = 'STAFF' AND newer."action" = 'STAFF_CASH_PAYMENT_RECORDED'
        AND newer."entityType" = 'Payment' AND newer."entityId" = a."entityId" AND (newer."createdAt", newer."id") > (a."createdAt", a."id")) THEN 'superseded'
      WHEN p."status" = 'paid' THEN 'paid' ELSE 'not-paid' END AS "status"
  FROM "AuditLog" a LEFT JOIN "Staff" st ON st."id" = a."actorId"
    LEFT JOIN "Student" s ON s."id"::text = a."metadataJson"->>'studentId'
    LEFT JOIN "Payment" p ON p."id"::text = a."entityId"
  WHERE a."actorType" = 'STAFF' AND a."action" = 'STAFF_CASH_PAYMENT_RECORDED' AND a."entityType" = 'Payment'`;

// Notes have their own timestamp and author, even when no separate audit event was written.
const activitySource = Prisma.sql`
  SELECT ('audit:' || a."id") AS "id", a."actorId" AS "staffId", COALESCE(a."actorName", st."name") AS "staffName",
    a."action", a."entityType", a."entityId", a."createdAt", s."id" AS "studentId", s."name" AS "studentName",
    a."metadataJson"->>'month' AS "month", a."metadataJson"->>'academicYear' AS "academicYear",
    a."metadataJson"->>'amount' AS "amount", a."metadataJson"->>'reference' AS "reference", NULL::text AS "note"
  FROM "AuditLog" a LEFT JOIN "Staff" st ON st."id" = a."actorId"
    LEFT JOIN "Student" s ON s."id"::text = a."metadataJson"->>'studentId'
  WHERE a."actorType" = 'STAFF'
  UNION ALL
  SELECT ('follow-up:' || f."id"), f."staffId", st."name", 'FOLLOW_UP_ADDED', 'Student', f."studentId"::text,
    f."createdAt", s."id", s."name", NULL, NULL, NULL, NULL, f."note"
  FROM "StaffStudentFollowUp" f JOIN "Staff" st ON st."id" = f."staffId" JOIN "Student" s ON s."id" = f."studentId"`;

async function readSqlOverview(source, query, statuses, db) {
  const f = overviewFilters(query, statuses), conditions = [Prisma.sql`TRUE`];
  if (f.staffId) conditions.push(Prisma.sql`"staffId" = ${f.staffId}`);
  if (f.createdAt.gte) conditions.push(Prisma.sql`"createdAt" >= ${f.createdAt.gte}`);
  if (f.createdAt.lt) conditions.push(Prisma.sql`"createdAt" < ${f.createdAt.lt}`);
  if (f.status !== "all") conditions.push(statuses.length ? Prisma.sql`"status" = ${f.status}` : Prisma.sql`TRUE`);
  const action = text(query.action, 100);
  if (!statuses.length && action) {
    if (!/^[A-Z0-9_]+$/.test(action)) throw fail("Invalid action filter.");
    conditions.push(Prisma.sql`"action" = ${action}`);
  }
  if (f.search) {
    const pattern = `%${f.search.replace(/[\\%_]/g, "\\$&")}%`;
    const fields = statuses.length ? Prisma.sql`"month", "paymentId", "recordedStudentId"` : Prisma.sql`"action", "entityType", "entityId", "note"`;
    conditions.push(Prisma.sql`concat_ws(' ', "studentName", "studentId"::text, "staffName", "staffId", "reference", ${fields}) ILIKE ${pattern}`);
  }
  const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
  return db.$transaction(async tx => {
    const count = await tx.$queryRaw(Prisma.sql`SELECT count(*)::int AS total FROM (${source}) records ${where}`);
    const rows = await tx.$queryRaw(Prisma.sql`SELECT * FROM (${source}) records ${where} ORDER BY "createdAt" DESC, "id" DESC LIMIT ${f.pageSize} OFFSET ${f.skip}`);
    return { success: true, rows, pagination: pagination(f, count[0].total) };
  }, { isolationLevel: "RepeatableRead" });
}
export const readAdminCashCollections = (query, db = prisma) => readSqlOverview(cashSource, query, ["paid", "reversed", "removed", "changed", "not-paid", "superseded"], db);
export const readAdminStaffActivity = (query, db = prisma) => readSqlOverview(activitySource, query, [], db);
export const readAdminStaffOptions = (db = prisma) => db.staff.findMany({ select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
export const readAdminEnquiries = query => {
  overviewFilters(query);
  return { success: true, available: false, message: "Admission enquiries are unavailable: the Staff portal has no saved enquiry data source." };
};
