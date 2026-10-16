import prisma from "../prisma/client.js";

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function attendanceDateKey(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + "T00:00:00Z");
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value) return value;
    fail(400, "Invalid attendance date.");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(400, "Invalid attendance date.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = type => parts.find(item => item.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export const attendanceDate = value => new Date(attendanceDateKey(value) + "T00:00:00Z");
export function attendanceWeek(value = new Date()) {
  const start = attendanceDate(value);
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 2) % 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  const deadline = new Date(start); deadline.setUTCDate(deadline.getUTCDate() + 7);
  deadline.setUTCHours(6, 30, 0, 0); // Following Friday, noon in Asia/Kolkata.
  return { start, end, deadline };
}
export function dailyAttendanceRate(value) {
  const day = attendanceDate(value).getUTCDay();
  return day === 0 || day === 6 ? 400 : 200;
}
export function assertAttendanceDeadline(role, value, now = new Date()) {
  if (role === "faculty" && now >= attendanceWeek(value).deadline) {
    fail(403, "Faculty attendance editing closed at Friday 12:00 noon Asia/Kolkata for this week.");
  }
}
export async function attendancePayoutLocked(db, facultyId, value) {
  const { start, end } = attendanceWeek(value);
  const [cycle, payout, weekly] = await Promise.all([
    db.payrollCycle.findFirst({ where: { startDate: { lte: end }, endDate: { gte: start }, OR: [
      { ledgerLocked: true }, { status: { in: ["APPROVED", "PAID", "LOCKED"] } },
      { payrolls: { some: { ...(facultyId ? { facultyId } : {}), status: { in: ["PAID", "LOCKED"] } } } },
    ] }, select: { id: true } }),
    db.facultyPayout.findFirst({ where: { ...(facultyId ? { facultyId } : {}), status: { in: ["PROCESSING", "SUCCESS", "FAILED"] }, payroll: { payrollCycle: { startDate: { lte: end }, endDate: { gte: start } } } }, select: { id: true } }),
    db.weeklyFacultyPaymentRecord.findFirst({ where: { weekStart: start, weekEnd: end, OR: [{ status: { in: ["PAID", "PROCESSING"] } }, { paidAmount: { gt: 0 } }] }, select: { id: true } }),
  ]);
  return Boolean(cycle || payout || weekly);
}
export async function lockAttendanceDates(tx, facultyId, values) {
  const keys = values.flatMap(value => [attendanceDateKey(value), "week:" + attendanceDateKey(attendanceWeek(value).start)]);
  for (const key of [...new Set(keys)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"attendance:" + facultyId + ":" + key})::bigint)`;
  }
}
export async function refreshDraftAttendancePayroll(tx, facultyId, value) {
  const { start, end } = attendanceWeek(value);
  const rows = await tx.workLedgerEntry.findMany({ where: { facultyId, date: { gte: start, lte: end } }, select: { amount: true } });
  // Only refresh editable drafts; never rewrite approved or settled payroll history.
  await tx.facultyEarningsPayroll.updateMany({
    where: { facultyId, status: { in: ["DRAFT", "PENDING_APPROVAL"] }, payrollCycle: { startDate: start, endDate: end, ledgerLocked: false, status: { in: ["DRAFT", "PENDING_APPROVAL"] } } },
    data: { totalEntries: rows.length, totalAmount: rows.reduce((total, row) => total + Number(row.amount || 0), 0) },
  });
}
export async function assertAttendanceMutable(tx, role, facultyId, value) {
  assertAttendanceDeadline(role, value);
  if (await attendancePayoutLocked(tx, facultyId, value)) fail(403, "Attendance is locked because payroll is approved, settled or a payout has been processed.");
  assertAttendanceDeadline(role, value);
}
export async function setDailyAttendance({ role, actorId, facultyId, date, shift, present, amount, actor, remarks, adminAdd = false }, db = prisma) {
  if (!["admin", "faculty"].includes(role)) fail(403, "Forbidden.");
  if (adminAdd && (role !== "admin" || amount !== undefined)) fail(400, "Admin additions use the configured attendance rate.");
  if (role === "faculty" && !actorId) fail(403, "Faculty identity is required.");
  const target = role === "faculty" ? String(actorId) : String(facultyId || "");
  if (!target || (role === "faculty" && facultyId && String(facultyId) !== target)) fail(403, "Faculty members can only change their own attendance.");
  if (typeof present !== "boolean") fail(400, "Attendance status must be true or false.");
  if (!date) fail(400, "Attendance date is required.");
  if (!["MORNING", "EVENING"].includes(shift)) fail(400, "Select Morning or Evening attendance.");
  if (role === "faculty" && amount !== undefined) fail(400, "Faculty attendance amounts are calculated automatically.");
  if (amount !== undefined && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) fail(400, "Amount must be a valid non-negative number.");
  const day = attendanceDate(date);
  return db.$transaction(async tx => {
    await lockAttendanceDates(tx, target, [day]);
    await assertAttendanceMutable(tx, role, target, day);
    const faculty = await tx.faculty.findUnique({ where: { id: target }, select: { id: true, status: true, joiningDate: true } });
    if (!faculty) fail(404, "Faculty member not found.");
    if (adminAdd && (faculty.status !== "ACTIVE" || attendanceDateKey(faculty.joiningDate) > attendanceDateKey(day))) fail(409, "Faculty member is not eligible for attendance on this date.");
    const existing = await tx.workLedgerEntry.findMany({ where: { facultyId: target, date: day } });
    if (existing.some(entry => ["DAILY", "AFTERNOON"].includes(entry.shift))) fail(409, "Historical daily or Afternoon attendance exists for this date. Its recorded amount is unchanged; Admin review is required before adding shift attendance.");
    const selected = existing.filter(entry => entry.shift === shift);
    if (present && selected.length) {
      if (adminAdd) fail(409, "Faculty member is already present in this shift.");
      // Repeat attendance must not reset recorded legacy amounts or an admin override.
      return { entry: selected[0] };
    }
    if (!present) {
      for (const entry of selected) {
        await tx.workLedgerEntryAudit.create({ data: { entryId: entry.id, action: "DELETE", changedBy: actor.updatedBy, previousData: JSON.parse(JSON.stringify(entry)) } });
        assertAttendanceDeadline(role, day);
        await tx.workLedgerEntry.delete({ where: { id: entry.id } });
      }
      await refreshDraftAttendancePayroll(tx, target, day);
      return { entry: null };
    }
    assertAttendanceDeadline(role, day);
    const entry = await tx.workLedgerEntry.create({ data: { facultyId: target, date: day, shift, amount: role === "admin" && amount !== undefined ? Number(amount) : dailyAttendanceRate(day), remarks: remarks || null, createdBy: actor.updatedBy, ...actor } });
    await tx.workLedgerEntryAudit.create({ data: { entryId: entry.id, action: "CREATE", changedBy: actor.updatedBy, newData: JSON.parse(JSON.stringify(entry)) } });
    await refreshDraftAttendancePayroll(tx, target, day);
    return { entry };
  });
}
