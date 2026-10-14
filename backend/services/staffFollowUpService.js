import prisma from "../prisma/client.js";

const fail = (message, status) => Object.assign(new Error(message), { status });
export function followUpStudentId(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) throw fail("Invalid student ID.", 400);
  return Number(value);
}
export async function createStaffFollowUp(staffId, studentId, note, db = prisma) {
  const id = followUpStudentId(studentId);
  if (typeof note !== "string" || !note.trim() || note.length > 4000) throw fail("Enter a follow-up note between 1 and 4000 characters.", 400);
  if (!await db.student.findUnique({ where: { id }, select: { id: true } })) throw fail("Student not found.", 404);
  await db.staffStudentFollowUp.create({ data: { studentId: id, staffId, note: note.trim() }, select: { id: true } });
  return { success: true, message: "Follow-up saved." };
}
export async function readStaffFollowUps(studentId, db = prisma, options = {}) {
  const id = followUpStudentId(studentId);
  if (!await db.student.findUnique({ where: { id }, select: { id: true } })) throw fail("Student not found.", 404);
  const pagination = {};
  if (options.limit !== undefined) {
    const limit = Number(options.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw fail("Invalid timeline limit.", 400);
    pagination.take = limit + 1;
    if (options.cursor) {
      if (typeof options.cursor !== "string" || options.cursor.length > 64) throw fail("Invalid timeline cursor.", 400);
      pagination.cursor = { id: options.cursor }; pagination.skip = 1;
    }
  }
  return db.staffStudentFollowUp.findMany({ where: { studentId: id }, ...pagination, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, note: true, createdAt: true, staff: { select: { name: true } } } });
}

export async function listFollowUpStudents(query, db = prisma) {
  const page = Number(query.page || 1);
  if (!Number.isInteger(page) || page < 1) throw fail("Invalid page.", 400);
  const search = String(query.search || "").trim().slice(0, 120);
  const where = { staffFollowUps: { some: {} } };
  if (search) {
    where.OR = [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }];
    if (/^\d+$/.test(search) && Number(search) <= 2147483647) where.OR.push({ id: Number(search) });
  }
  return db.$transaction(async (tx) => {
    const total = await tx.student.count({ where });
    const students = await tx.student.findMany({ where, select: { id: true, name: true, class: true, phone: true }, orderBy: { id: "asc" }, skip: (page - 1) * 20, take: 20 });
    return { success: true, students, page, pages: Math.ceil(total / 20) };
  }, { isolationLevel: "RepeatableRead" });
}
