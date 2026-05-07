import prisma from "../prisma/client.js";
import {
  ACADEMIC_YEAR_MONTHS,
  getPromotionDateGate,
} from "../utils/academicYear.js";

const ANNUAL_PROMOTION_JOB_TYPE = "ANNUAL_STUDENT_PROMOTION";
const ACTIVE_JOB_STATUSES = new Set(["PENDING", "RUNNING"]);

const toUniqueIntArray = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => Number(item)).filter(Number.isInteger))];
};

const safeJsonObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const getJobAcademicYear = (job) => {
  const payloadYear = Number(safeJsonObject(job?.payload).targetAcademicYear);
  if (Number.isInteger(payloadYear)) {
    return payloadYear;
  }

  const match = String(job?.dedupeKey || "").match(/^annual-promotion:(\d{4})/i);
  return match ? Number(match[1]) : null;
};

const buildEligibilityFromPayments = (payments, academicYear) => {
  const paymentByMonth = new Map(
    payments
      .filter((payment) => Number(payment.academicYear) === Number(academicYear))
      .map((payment) => [payment.month, payment])
  );

  const missingOrUnpaidMonths = ACADEMIC_YEAR_MONTHS.filter((month) => {
    const payment = paymentByMonth.get(month);
    return !payment || String(payment.status || "").toLowerCase() !== "paid";
  });

  return {
    eligible: missingOrUnpaidMonths.length === 0,
    paidMonths: ACADEMIC_YEAR_MONTHS.length - missingOrUnpaidMonths.length,
    missingOrUnpaidMonths,
    academicYear: Number(academicYear),
  };
};

export const normalizePromotionJobResult = (rawResult, academicYear = null) => {
  const result = safeJsonObject(rawResult);
  const normalizedAcademicYear = Number(result.academicYear ?? academicYear);

  return {
    academicYear: Number.isInteger(normalizedAcademicYear)
      ? normalizedAcademicYear
      : null,
    promotedStudentIds: toUniqueIntArray(result.promotedStudentIds),
    class12ManualReviewStudentIds: toUniqueIntArray(
      result.class12ManualReviewStudentIds
    ),
    alreadyPromotedStudentIds: toUniqueIntArray(result.alreadyPromotedStudentIds),
  };
};

export const buildPromotionJobDedupeKey = (academicYear, dateKey) =>
  `annual-promotion:${Number(academicYear)}:${String(dateKey || "").trim()}`;

export const isStudentEligibleForPromotion = async (studentId, academicYear) => {
  const payments = await prisma.payment.findMany({
    where: {
      studentId: Number(studentId),
      academicYear: Number(academicYear),
      month: { in: ACADEMIC_YEAR_MONTHS },
    },
    select: {
      month: true,
      status: true,
      academicYear: true,
    },
  });

  return buildEligibilityFromPayments(payments, academicYear);
};

export const getPromotionHistoryForAcademicYear = async (
  academicYear,
  { excludeJobId = null } = {}
) => {
  const jobs = await prisma.backgroundJob.findMany({
    where: {
      type: ANNUAL_PROMOTION_JOB_TYPE,
    },
    select: {
      id: true,
      status: true,
      dedupeKey: true,
      payload: true,
      result: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const filteredJobs = jobs.filter((job) => {
    if (excludeJobId && job.id === excludeJobId) return false;
    return Number(getJobAcademicYear(job)) === Number(academicYear);
  });

  const promotedStudentIds = new Set();
  const class12ManualReviewStudentIds = new Set();

  for (const job of filteredJobs) {
    const normalized = normalizePromotionJobResult(job.result, academicYear);
    normalized.promotedStudentIds.forEach((studentId) =>
      promotedStudentIds.add(Number(studentId))
    );
    normalized.class12ManualReviewStudentIds.forEach((studentId) =>
      class12ManualReviewStudentIds.add(Number(studentId))
    );
  }

  return {
    academicYear: Number(academicYear),
    promotedStudentIds,
    class12ManualReviewStudentIds,
  };
};

export const findActivePromotionJobForAcademicYear = async (academicYear) => {
  const jobs = await prisma.backgroundJob.findMany({
    where: {
      type: ANNUAL_PROMOTION_JOB_TYPE,
      status: {
        in: [...ACTIVE_JOB_STATUSES],
      },
    },
    select: {
      id: true,
      status: true,
      source: true,
      createdAt: true,
      dedupeKey: true,
      payload: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    jobs.find((job) => Number(getJobAcademicYear(job)) === Number(academicYear)) ||
    null
  );
};

export const promoteStudentForAcademicYear = async ({
  studentId,
  academicYear,
  jobId,
}) => {
  const gate = getPromotionDateGate();
  const normalizedAcademicYear = Number(academicYear);

  if (!gate.allowed || Number(gate.academicYear) !== normalizedAcademicYear) {
    return {
      outcome: "date_blocked",
      academicYear: normalizedAcademicYear,
      gate,
    };
  }

  if (!jobId) {
    return {
      outcome: "job_required",
      academicYear: normalizedAcademicYear,
      gate,
    };
  }

  return prisma.$transaction(async (tx) => {
    const [student, job, payments] = await Promise.all([
      tx.student.findUnique({
        where: { id: Number(studentId) },
        select: {
          id: true,
          name: true,
          class: true,
        },
      }),
      tx.backgroundJob.findUnique({
        where: { id: String(jobId) },
        select: {
          id: true,
          result: true,
        },
      }),
      tx.payment.findMany({
        where: {
          studentId: Number(studentId),
          academicYear: normalizedAcademicYear,
          month: { in: ACADEMIC_YEAR_MONTHS },
        },
        select: {
          month: true,
          status: true,
          academicYear: true,
        },
      }),
    ]);

    if (!student) {
      return {
        outcome: "missing_student",
        academicYear: normalizedAcademicYear,
      };
    }

    if (!job) {
      return {
        outcome: "missing_job",
        academicYear: normalizedAcademicYear,
      };
    }

    const resultState = normalizePromotionJobResult(
      job.result,
      normalizedAcademicYear
    );

    if (resultState.promotedStudentIds.includes(Number(student.id))) {
      return {
        outcome: "already_promoted",
        academicYear: normalizedAcademicYear,
        studentId: Number(student.id),
      };
    }

    const eligibility = buildEligibilityFromPayments(
      payments,
      normalizedAcademicYear
    );
    if (!eligibility.eligible) {
      return {
        outcome: "not_eligible",
        studentId: Number(student.id),
        ...eligibility,
      };
    }

    const currentClassNum = Number.parseInt(String(student.class || ""), 10);
    if (!Number.isFinite(currentClassNum)) {
      return {
        outcome: "invalid_class",
        academicYear: normalizedAcademicYear,
        studentId: Number(student.id),
        currentClass: student.class,
      };
    }

    if (currentClassNum >= 12) {
      const nextResult = {
        ...resultState,
        academicYear: normalizedAcademicYear,
        class12ManualReviewStudentIds: [
          ...new Set([
            ...resultState.class12ManualReviewStudentIds,
            Number(student.id),
          ]),
        ],
      };

      await tx.backgroundJob.update({
        where: { id: String(jobId) },
        data: { result: nextResult },
      });

      return {
        outcome: "class12_manual_review",
        academicYear: normalizedAcademicYear,
        studentId: Number(student.id),
        currentClass: student.class,
      };
    }

    const nextClass = String(currentClassNum + 1);
    const nextResult = {
      ...resultState,
      academicYear: normalizedAcademicYear,
      promotedStudentIds: [
        ...new Set([...resultState.promotedStudentIds, Number(student.id)]),
      ],
    };

    await tx.student.update({
      where: { id: Number(student.id) },
      data: { class: nextClass },
    });

    await tx.backgroundJob.update({
      where: { id: String(jobId) },
      data: { result: nextResult },
    });

    return {
      outcome: "promoted",
      academicYear: normalizedAcademicYear,
      studentId: Number(student.id),
      fromClass: String(currentClassNum),
      toClass: nextClass,
    };
  });
};
