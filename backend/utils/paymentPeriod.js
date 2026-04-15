const MONTH_TO_INDEX = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11,
};

const normalizeMonthName = (month) => {
  const value = String(month || "").trim();
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}` : "";
};

export const getPaymentPeriodDate = (month, academicYear) => {
  const normalizedMonth = normalizeMonthName(month);
  const monthIndex = MONTH_TO_INDEX[normalizedMonth];
  const normalizedAcademicYear = Number(academicYear);

  if (!Number.isInteger(monthIndex) || !Number.isInteger(normalizedAcademicYear)) {
    return null;
  }

  const calendarYear = monthIndex >= 2 ? normalizedAcademicYear : normalizedAcademicYear + 1;
  return new Date(calendarYear, monthIndex, 1);
};

export const getPaymentPeriodEnd = (month, academicYear) => {
  const paymentPeriodDate = getPaymentPeriodDate(month, academicYear);
  if (!paymentPeriodDate) return null;

  return new Date(
    paymentPeriodDate.getFullYear(),
    paymentPeriodDate.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );
};

export const isLatePaymentForPeriod = ({ month, academicYear, paidAt }) => {
  const paidDate = paidAt ? new Date(paidAt) : null;
  const periodEnd = getPaymentPeriodEnd(month, academicYear);

  if (!paidDate || Number.isNaN(paidDate.getTime()) || !periodEnd) {
    return false;
  }

  return paidDate.getTime() > periodEnd.getTime();
};
