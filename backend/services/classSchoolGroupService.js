import prisma from "../prisma/client.js";
import { normalizeSchoolText } from "../utils/authValidation.js";

const collapseWhitespace = (value) =>
  String(value || "").replace(/\s+/g, " ").trim();

const stripClassPrefix = (value) =>
  collapseWhitespace(value).replace(/^class\s+/i, "").trim();

export const normalizeClassSchoolValue = (value) =>
  collapseWhitespace(value).toLowerCase();

export const normalizeClassNameForMatch = (value) =>
  normalizeClassSchoolValue(stripClassPrefix(value));

export const normalizeSchoolNameForMatch = (value) =>
  normalizeClassSchoolValue(value);

export const normalizeWhatsAppGroupLink = (value) =>
  String(value || "").trim();

export const isValidWhatsAppGroupLink = (value) =>
  /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(
    normalizeWhatsAppGroupLink(value)
  );

export const buildClassSchoolGroupWriteData = ({
  className,
  schoolName,
  whatsappGroupLink,
}) => {
  const normalizedDisplayClassName = collapseWhitespace(className);
  const normalizedDisplaySchoolName = normalizeSchoolText(schoolName);
  const normalizedLink = normalizeWhatsAppGroupLink(whatsappGroupLink);

  return {
    className: normalizedDisplayClassName,
    schoolName: normalizedDisplaySchoolName,
    normalizedClassName: normalizeClassNameForMatch(normalizedDisplayClassName),
    normalizedSchoolName: normalizeSchoolNameForMatch(normalizedDisplaySchoolName),
    whatsappGroupLink: normalizedLink,
  };
};

export const resolveDefaultAdminId = async () => {
  const admins = await prisma.admin.findMany({
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });

  return admins.length === 1 ? Number(admins[0].id) : null;
};

export const resolveStudentAdminIdMap = async (students = []) => {
  const studentRows = Array.isArray(students) ? students : [];
  const studentIds = studentRows
    .map((student) => Number(student?.id))
    .filter((studentId) => Number.isFinite(studentId));
  const adminIdMap = new Map();

  for (const student of studentRows) {
    const studentId = Number(student?.id);
    const adminId = Number(student?.adminId);
    if (Number.isFinite(studentId) && Number.isFinite(adminId) && adminId > 0) {
      adminIdMap.set(studentId, adminId);
    }
  }

  const unresolvedStudentIds = studentIds.filter((studentId) => !adminIdMap.has(studentId));

  if (unresolvedStudentIds.length) {
    const payments = await prisma.payment.findMany({
      where: {
        studentId: { in: unresolvedStudentIds },
        teacherAdminId: { not: null },
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        studentId: true,
        teacherAdminId: true,
      },
    });

    for (const payment of payments) {
      const studentId = Number(payment.studentId);
      const adminId = Number(payment.teacherAdminId);
      if (!adminIdMap.has(studentId) && Number.isFinite(adminId) && adminId > 0) {
        adminIdMap.set(studentId, adminId);
      }
    }
  }

  const stillUnresolvedIds = studentIds.filter((studentId) => !adminIdMap.has(studentId));
  if (stillUnresolvedIds.length) {
    const defaultAdminId = await resolveDefaultAdminId();
    if (Number.isFinite(defaultAdminId) && defaultAdminId > 0) {
      for (const studentId of stillUnresolvedIds) {
        adminIdMap.set(studentId, defaultAdminId);
      }
    }
  }

  return adminIdMap;
};

export const resolveStudentAdminId = async (student) => {
  const adminIdMap = await resolveStudentAdminIdMap([student]);
  return adminIdMap.get(Number(student?.id)) || null;
};

export const findMatchingClassSchoolGroupForStudent = async (student) => {
  const normalizedStudentId = Number(student?.id);
  if (!Number.isFinite(normalizedStudentId)) return null;

  const adminId = await resolveStudentAdminId(student);
  if (!adminId) return null;

  const normalizedClassName = normalizeClassNameForMatch(student?.class);
  const normalizedSchoolName = normalizeSchoolNameForMatch(student?.school);
  if (!normalizedClassName || !normalizedSchoolName) return null;

  return prisma.classSchoolGroup.findUnique({
    where: {
      adminId_normalizedClassName_normalizedSchoolName: {
        adminId,
        normalizedClassName,
        normalizedSchoolName,
      },
    },
    select: {
      id: true,
      className: true,
      schoolName: true,
      whatsappGroupLink: true,
      updatedAt: true,
    },
  });
};

export const getMissingClassSchoolCombinationsForAdmin = async (adminId) => {
  const normalizedAdminId = Number(adminId);
  if (!Number.isFinite(normalizedAdminId) || normalizedAdminId <= 0) return [];

  const [students, groups] = await Promise.all([
    prisma.student.findMany({
      select: {
        id: true,
        adminId: true,
        class: true,
        school: true,
      },
      orderBy: [{ class: "asc" }, { school: "asc" }, { id: "asc" }],
    }),
    prisma.classSchoolGroup.findMany({
      where: { adminId: normalizedAdminId },
      select: {
        normalizedClassName: true,
        normalizedSchoolName: true,
      },
    }),
  ]);

  const studentAdminIdMap = await resolveStudentAdminIdMap(students);
  const existingGroupKeys = new Set(
    groups.map(
      (group) =>
        `${group.normalizedClassName}::${group.normalizedSchoolName}`
    )
  );
  const missingCombinations = new Map();

  for (const student of students) {
    if (studentAdminIdMap.get(Number(student.id)) !== normalizedAdminId) {
      continue;
    }

    const normalizedClassName = normalizeClassNameForMatch(student.class);
    const normalizedSchoolName = normalizeSchoolNameForMatch(student.school);
    if (!normalizedClassName || !normalizedSchoolName) continue;

    const groupKey = `${normalizedClassName}::${normalizedSchoolName}`;
    if (existingGroupKeys.has(groupKey)) continue;

    if (!missingCombinations.has(groupKey)) {
      missingCombinations.set(groupKey, {
        className: collapseWhitespace(student.class),
        schoolName: normalizeSchoolText(student.school),
        normalizedClassName,
        normalizedSchoolName,
        studentCount: 0,
      });
    }

    missingCombinations.get(groupKey).studentCount += 1;
  }

  return [...missingCombinations.values()].sort((left, right) => {
    const byClass = left.className.localeCompare(right.className, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (byClass !== 0) return byClass;
    return left.schoolName.localeCompare(right.schoolName, undefined, {
      sensitivity: "base",
    });
  });
};
