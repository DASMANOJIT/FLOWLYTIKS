import prisma from "../prisma/client.js";
import { ACADEMIC_YEAR_MONTHS, getKolkataDateParts } from "../utils/academicYear.js";
import { getFridayWeekStart } from "../controllers/workledgercontrollers.js";
import { buildStatusPayload } from "../controllers/facultyweeklypaymentcontrollers.js";
import { summarizeEntries } from "../controllers/facultyextraincentivecontrollers.js";

export function dashboardPeriod(query = {}, now = new Date()) {
  const parts = getKolkataDateParts(now);
  const month = query.month || new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "Asia/Kolkata" }).format(now);
  const academicYear = query.academicYear === undefined ? parts.year - (parts.month < 3 ? 1 : 0) : Number(query.academicYear);
  if (!ACADEMIC_YEAR_MONTHS.includes(month) || !Number.isInteger(academicYear) || academicYear < 2000 || academicYear > 2100) {
    throw Object.assign(new Error("Invalid fee month or academic session."), { status: 400 });
  }
  const weekStart = getFridayWeekStart(now);
  const weekEnd = new Date(weekStart); weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const weekExclusiveEnd = new Date(weekEnd); weekExclusiveEnd.setUTCDate(weekExclusiveEnd.getUTCDate() + 1);
  return { month, academicYear, weekStart, weekEnd, weekExclusiveEnd };
}

export async function readAdminDashboard(query, { db = prisma, weeklyStatus = buildStatusPayload, now = new Date() } = {}) {
  const period = dashboardPeriod(query, now);
  const paid = { month: period.month, academicYear: period.academicYear, status: "paid" };
  const [fees, weekly, entries] = await Promise.all([
    db.$transaction(async tx => {
      const [totalStudents, totalFaculties, totalStaff, paidStudents, received] = await Promise.all([
        tx.student.count(), tx.faculty.count({ where: { status: "ACTIVE" } }), tx.staff.count(),
        tx.student.count({ where: { payments: { some: paid } } }),
        // Payment is the canonical fee ledger: gateway attempts must not be summed again.
        tx.payment.aggregate({ where: paid, _sum: { amount: true } }),
      ]);
      return { totalStudents, totalFaculties, totalStaff, paidStudents, unpaidStudents: Math.max(0, totalStudents - paidStudents), paymentReceived: received._sum.amount ?? 0 };
    }, { isolationLevel: "RepeatableRead" }),
    weeklyStatus(period.weekStart, period.weekEnd),
    db.facultyExtraIncentiveEntry.findMany({
      where: { createdAt: { gte: period.weekStart, lt: period.weekExclusiveEnd } },
      select: { facultyId: true, incentiveTypeId: true, quantityChange: true, rateSnapshot: true, amountSnapshot: true },
    }),
  ]);
  const byFaculty = new Map();
  for (const entry of entries) {
    const group = byFaculty.get(entry.facultyId) || []; group.push(entry); byFaculty.set(entry.facultyId, group);
  }
  const extraIncentives = [...byFaculty.values()].flatMap(summarizeEntries).reduce((sum, item) => sum + item.amount, 0);
  return {
    success: true, month: period.month, academicYear: period.academicYear, ...fees,
    week: { start: period.weekStart.toISOString().slice(0, 10), end: period.weekEnd.toISOString().slice(0, 10), outstanding: weekly.pendingAmount, extraIncentives: Math.round(extraIncentives * 100) / 100 },
  };
}

export async function readFacultyBilling({ db = prisma, weeklyStatus = buildStatusPayload, now = new Date() } = {}) {
  const { weekStart, weekEnd } = dashboardPeriod({}, now);
  const [weekly, entries] = await Promise.all([
    weeklyStatus(weekStart, weekEnd),
    db.facultyExtraIncentiveEntry.findMany({
      where: { status: "PENDING" },
      select: { facultyId: true, incentiveTypeId: true, quantityChange: true, rateSnapshot: true, amountSnapshot: true },
    }),
  ]);
  const byFaculty = new Map();
  for (const entry of entries) {
    const group = byFaculty.get(entry.facultyId) || [];
    group.push(entry); byFaculty.set(entry.facultyId, group);
  }
  const unpaid = [...byFaculty.values()].flatMap(summarizeEntries).reduce((sum, item) => sum + item.amount, 0);
  return { success: true, weekStart: weekStart.toISOString().slice(0, 10), weekEnd: weekEnd.toISOString().slice(0, 10), totalWeeklyAmount: weekly.totalAmount, unpaidExtraIncentives: Math.round(unpaid * 100) / 100 };
}
