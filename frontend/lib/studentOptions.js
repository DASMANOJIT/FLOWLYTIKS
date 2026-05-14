export const SCHOOL_OTHER_VALUE = "other";

export const SCHOOL_OPTIONS = [
  "St. Augustine's Day School - Barrackpore",
  "St. Augustine's Day School - Shyamnagar",
  "Modern English Academy",
  "St. Claret School",
  "Douglas Memorial Higher Secondary School",
  "Assembly of Angels Secondary School",
  "STEM World School",
];

export const CLASS_OPTIONS = ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

const normalizeOptionValue = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const resolveSchoolOptionState = (schoolName) => {
  const normalizedSchoolName = normalizeOptionValue(schoolName);
  const matchedSchool =
    SCHOOL_OPTIONS.find(
      (option) => normalizeOptionValue(option) === normalizedSchoolName
    ) || "";

  if (matchedSchool) {
    return {
      schoolOption: matchedSchool,
      customSchool: "",
    };
  }

  return {
    schoolOption: normalizedSchoolName ? SCHOOL_OTHER_VALUE : "",
    customSchool: String(schoolName || "").replace(/\s+/g, " ").trim(),
  };
};
