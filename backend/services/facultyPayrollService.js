const toDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const dateOnly = (value) => new Date(`${toDateKey(value)}T00:00:00.000Z`);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const countInclusiveDays = (start, end) => {
  const startDate = dateOnly(start);
  const endDate = dateOnly(end);
  return Math.max(
    Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1,
    0
  );
};

export const buildDateKeys = (start, end) => {
  const days = countInclusiveDays(start, end);
  const keys = [];
  for (let index = 0; index < days; index += 1) {
    keys.push(toDateKey(addDays(dateOnly(start), index)));
  }
  return keys;
};

export const normalizeMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

export const getMonthlyWorkingDays = () => {
  const configured = Number.parseInt(
    String(process.env.FACULTY_MONTHLY_WORKING_DAYS || "25"),
    10
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 25;
};

export const buildAttendanceUnits = ({ facultyId, dateKeys, ledgerEntries }) => {
  const shiftsByDate = new Map();
  for (const entry of ledgerEntries) {
    if (String(entry.facultyId) !== String(facultyId)) continue;
    const key = toDateKey(entry.date);
    if (!shiftsByDate.has(key)) shiftsByDate.set(key, new Set());
    shiftsByDate.get(key).add(entry.shift);
  }

  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;

  for (const key of dateKeys) {
    const shiftCount = shiftsByDate.get(key)?.size || 0;
    if (shiftCount >= 2) {
      presentDays += 1;
    } else if (shiftCount === 1) {
      halfDays += 1;
    } else {
      absentDays += 1;
    }
  }

  return { presentDays, halfDays, absentDays };
};

export const calculateFacultyPayrollAmount = ({ faculty, presentDays, halfDays }) => {
  const salaryAmount = Number(faculty.salaryAmount || 0);
  const paidUnits = Number(presentDays || 0) + Number(halfDays || 0) * 0.5;

  if (faculty.salaryType === "MONTHLY_FIXED") {
    return normalizeMoney((salaryAmount / getMonthlyWorkingDays()) * paidUnits);
  }

  if (faculty.salaryType === "ATTENDANCE_BASED") {
    return normalizeMoney(salaryAmount * paidUnits);
  }

  return normalizeMoney(salaryAmount * paidUnits);
};

export const actorKey = (req) => `${req.userRole}:${req.user?.id}`;

export const buildBatchNumber = (weekStart) =>
  `FP-${toDateKey(weekStart).replace(/-/g, "")}-${Date.now().toString().slice(-6)}`;

export { toDateKey, dateOnly };
