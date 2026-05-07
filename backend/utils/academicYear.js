export const ACADEMIC_YEAR_MONTHS = [
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
];

export const ACADEMIC_YEAR_TIMEZONE = "Asia/Kolkata";

export const getAcademicYear = () => {
  const now = new Date();
  // March → December = current year
  // Jan–Feb = previous academic year
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
};

const getTimeZoneDateParts = (
  now = new Date(),
  timeZone = ACADEMIC_YEAR_TIMEZONE
) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const readPart = (type) =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: readPart("year"),
    month: readPart("month"),
    day: readPart("day"),
    timeZone,
  };
};

export const getKolkataDateParts = (now = new Date()) =>
  getTimeZoneDateParts(now, ACADEMIC_YEAR_TIMEZONE);

export const getPromotionDateGate = (now = new Date()) => {
  const { year, month, day, timeZone } = getKolkataDateParts(now);
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  if (month === 1 || (month === 2 && day < 28)) {
    return {
      allowed: false,
      academicYear: null,
      date,
      timeZone,
      reason: "Promotion opens only on February 28 or later in Asia/Kolkata.",
    };
  }

  return {
    allowed: true,
    academicYear: year - 1,
    date,
    timeZone,
    reason: null,
  };
};

export const isFebruary = () => {
  return new Date().getMonth() === 1;
};
