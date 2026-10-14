import prisma from "../prisma/client.js";
import { ACADEMIC_YEAR_MONTHS, getKolkataDateParts } from "../utils/academicYear.js";

export function staffStudentCriteria(query = {}) {
  const now = getKolkataDateParts();
  const month = query.month || new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "Asia/Kolkata" }).format(new Date());
  const academicYear = query.academicYear === undefined ? now.year - (now.month < 3 ? 1 : 0) : Number(query.academicYear);
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 20 : Number(query.pageSize);
  const status = query.status || "all";
  if (!ACADEMIC_YEAR_MONTHS.includes(month) || !Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 3000 || !Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !["all", "paid", "unpaid"].includes(status)) {
    throw Object.assign(new Error("Invalid month, session, status or pagination."), { status: 400, code: "STAFF_FILTER_INVALID" });
  }
  const search = String(query.search || "").trim().slice(0, 120);
  const where = {};
  if (search) {
    where.OR = [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }];
    if (/^\d+$/.test(search) && Number.isSafeInteger(Number(search))) where.OR.push({ id: Number(search) });
  }
  if (query.class) where.class = String(query.class).slice(0, 80);
  const paid = { month, academicYear, status: "paid" };
  return { where, paid, month, academicYear, page, pageSize, status };
}

export async function readStaffStudents(query, db = prisma) {
  const filter = staffStudentCriteria(query);
  return db.$transaction(async (tx) => {
    const paidWhere = { ...filter.where, payments: { some: filter.paid } };
    const unpaidWhere = { ...filter.where, payments: { none: filter.paid } };
    const where = filter.status === "paid" ? paidWhere : filter.status === "unpaid" ? unpaidWhere : filter.where;
    const totalStudents = await tx.student.count({ where: filter.where });
    const paidStudents = await tx.student.count({ where: paidWhere });
    const total = filter.status === "paid" ? paidStudents : filter.status === "unpaid" ? totalStudents - paidStudents : totalStudents;
    const students = await tx.student.findMany({
      where, orderBy: { id: "asc" }, skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize,
      select: { id: true, name: true, class: true, phone: true, school: true, monthlyFee: true, payments: { where: filter.paid, select: { id: true }, take: 1 } },
    });
    const classes = await tx.student.findMany({ distinct: ["class"], select: { class: true }, orderBy: { class: "asc" } });
    return {
      success: true, month: filter.month, academicYear: filter.academicYear,
      summary: { totalStudents, paidStudents, unpaidStudents: totalStudents - paidStudents },
      students: students.map(({ payments, ...student }) => ({ ...student, paymentStatus: payments.length ? "Paid" : "Unpaid" })),
      classes: classes.map((row) => row.class), pagination: { page: filter.page, pageSize: filter.pageSize, total, pages: Math.ceil(total / filter.pageSize) },
    };
  }, { isolationLevel: "RepeatableRead" });
}

export async function readStaffActivity(staffId, db = prisma) {
  return db.auditLog.findMany({
    where: { actorType: "STAFF", actorId: String(staffId) }, orderBy: { createdAt: "desc" }, take: 10,
    select: { id: true, action: true, createdAt: true },
  });
}

export async function exportStaffStudents(query, db = prisma) {
  if (query.batch) throw Object.assign(new Error("Batch filtering is unavailable: no student batch field exists."), { status: 400 });
  const filter = staffStudentCriteria({ ...query, page: 1, pageSize: 100 });
  return db.$transaction(async (tx) => {
    const where = { ...filter.where, ...(filter.status === "all" ? {} : { payments: { [filter.status === "paid" ? "some" : "none"]: filter.paid } }) };
    const students = await tx.student.findMany({ where, orderBy: { id: "asc" }, select: { id: true, name: true, class: true, phone: true, payments: { where: filter.paid, select: { id: true }, take: 1 } } });
    return { success: true, generatedAt: new Date().toISOString(), filters: { search: String(query.search || "").trim().slice(0, 120), class: query.class || "All", batch: "Not available", month: filter.month, academicYear: filter.academicYear, status: filter.status }, count: students.length, students: students.map(({ payments, ...row }) => ({ ...row, paymentStatus: payments.length ? "Paid" : "Unpaid" })) };
  }, { isolationLevel: "RepeatableRead" });
}
