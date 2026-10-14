import prisma from "../prisma/client.js";
import {
  getAcademicYear,
  getPromotionDateGate,
} from "../utils/academicYear.js";
import { withPgTransactionLock } from "../utils/dbLocks.js";
import { forEachStudentBatch } from "../utils/studentBatching.js";
import { runDailyFeeReminderJob } from "./reminderservice.js";
import { markPaidForStudent, sendReminderToStudent } from "./feeOpsService.js";
import {
  getPromotionHistoryForAcademicYear,
  normalizePromotionJobResult,
  promoteStudentForAcademicYear,
} from "./promotionService.js";

export const BACKGROUND_JOB_TYPES = {
  DAILY_FEE_REMINDER: "DAILY_FEE_REMINDER",
  ANNUAL_STUDENT_PROMOTION: "ANNUAL_STUDENT_PROMOTION",
  ASSISTANT_BULK_REMINDER: "ASSISTANT_BULK_REMINDER",
  ASSISTANT_BULK_MARK_PAID: "ASSISTANT_BULK_MARK_PAID",
};

const BACKGROUND_JOB_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
};

const parsePositiveInt = (value, fallback, max = 10_000) => {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, max);
};

const WORKER_POLL_INTERVAL_MS = parsePositiveInt(
  process.env.BACKGROUND_JOB_POLL_INTERVAL_MS,
  15_000,
  3_600_000
);
const WORKER_STALE_MINUTES = parsePositiveInt(
  process.env.BACKGROUND_JOB_STALE_MINUTES,
  15,
  24 * 60
);
const DEFAULT_BATCH_SIZE = parsePositiveInt(
  process.env.BACKGROUND_JOB_BATCH_SIZE,
  25,
  500
);

const backgroundJobLog = (event, meta = {}) => {
  console.log(`[background-job] ${event}`, meta);
};

const safeErrorMessage = (error) => {
  const message = String(error?.message || error || "Unknown error").trim();
  return message || "Unknown error";
};

export const createBackgroundJob = async ({
  type,
  source,
  requestedByRole = null,
  requestedByUserId = null,
  payload = null,
  dedupeKey = null,
}, db = prisma) => {
  const reviveFailedJobIfNeeded = async (existingJob) => {
    if (!existingJob || existingJob.status !== BACKGROUND_JOB_STATUS.FAILED) {
      return { job: existingJob, requeued: false };
    }

    const preservedResult =
      existingJob.type === BACKGROUND_JOB_TYPES.ANNUAL_STUDENT_PROMOTION
        ? existingJob.result
        : null;

    const job = await db.backgroundJob.update({
      where: { id: existingJob.id },
      data: {
        status: BACKGROUND_JOB_STATUS.PENDING,
        totalItems: 0,
        processedItems: 0,
        succeededItems: 0,
        failedItems: 0,
        errorMessage: null,
        result: preservedResult,
        startedAt: null,
        completedAt: null,
        lastHeartbeatAt: null,
        payload,
        source,
        requestedByRole,
        requestedByUserId,
      },
    });

    backgroundJobLog("requeued-failed", {
      jobId: job.id,
      type: job.type,
      source: job.source,
      dedupeKey: job.dedupeKey || null,
    });

    return { job, requeued: true };
  };

  if (dedupeKey) {
    const existing = await db.backgroundJob.findUnique({
      where: { dedupeKey },
    });
    if (existing) {
      const revived = await reviveFailedJobIfNeeded(existing);
      return { job: revived.job, created: false, requeued: revived.requeued };
    }
  }

  try {
    const job = await db.backgroundJob.create({
      data: {
        type,
        source,
        requestedByRole,
        requestedByUserId,
        payload,
        dedupeKey,
      },
    });

    backgroundJobLog("queued", {
      jobId: job.id,
      type: job.type,
      source: job.source,
      dedupeKey: job.dedupeKey || null,
    });

    return { job, created: true, requeued: false };
  } catch (error) {
    if (dedupeKey && error?.code === "P2002") {
      const existing = await db.backgroundJob.findUnique({
        where: { dedupeKey },
      });
      if (existing) {
        const revived = await reviveFailedJobIfNeeded(existing);
        return { job: revived.job, created: false, requeued: revived.requeued };
      }
    }
    throw error;
  }
};

export const getBackgroundJobStatus = async (jobId) => {
  return prisma.backgroundJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      type: true,
      status: true,
      source: true,
      totalItems: true,
      processedItems: true,
      succeededItems: true,
      failedItems: true,
      errorMessage: true,
      result: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
};

const assertBackgroundJobClaim = async (jobId, claimStartedAt) => {
  if (!claimStartedAt) return;
  const owned = await prisma.backgroundJob.findFirst({ where: { id: jobId, status: BACKGROUND_JOB_STATUS.RUNNING, startedAt: claimStartedAt }, select: { id: true } });
  if (!owned) throw new Error("Background job claim was lost.");
};

const updateBackgroundJobProgress = async (jobId, patch = {}, claimStartedAt) => {
  const result = await prisma.backgroundJob.updateMany({
    where: { id: jobId, ...(claimStartedAt ? { status: BACKGROUND_JOB_STATUS.RUNNING, startedAt: claimStartedAt } : {}) },
    data: { ...patch, lastHeartbeatAt: new Date() },
  });
  if (!result.count) throw new Error("Background job claim was lost.");
};

const requeueStaleRunningJobs = async (db) => {
  const staleBefore = new Date(Date.now() - WORKER_STALE_MINUTES * 60_000);
  const staleJobs = await db.backgroundJob.findMany({
    where: {
      status: BACKGROUND_JOB_STATUS.RUNNING,
      lastHeartbeatAt: {
        lt: staleBefore,
      },
    },
    select: {
      id: true,
      type: true,
      result: true,
    },
  });

  for (const job of staleJobs) {
    const preservedResult =
      job.type === BACKGROUND_JOB_TYPES.ANNUAL_STUDENT_PROMOTION
        ? job.result
        : null;

    await db.backgroundJob.updateMany({
      where: { id: job.id, status: BACKGROUND_JOB_STATUS.RUNNING, lastHeartbeatAt: { lt: staleBefore } },
      data: {
        status: BACKGROUND_JOB_STATUS.PENDING,
        totalItems: 0,
        processedItems: 0,
        succeededItems: 0,
        failedItems: 0,
        errorMessage: "Requeued after stale worker heartbeat.",
        result: preservedResult,
        startedAt: null,
        completedAt: null,
        lastHeartbeatAt: null,
      },
    });
  }

  if (staleJobs.length) {
    backgroundJobLog("requeued-stale", { count: staleJobs.length });
  }
};

export const claimNextBackgroundJob = async (db = prisma, jobId = null) => withPgTransactionLock(db, "background-job-dispatcher", async tx => {
  await requeueStaleRunningJobs(tx);
  // Retain the existing single-dispatcher behavior without a session lock or
  // a transaction spanning job execution. RUNNING is the persisted lease.
  if (await tx.backgroundJob.findFirst({ where: { status: BACKGROUND_JOB_STATUS.RUNNING }, select: { id: true } })) return null;
  const nextJob = await tx.backgroundJob.findFirst({
    where: { status: BACKGROUND_JOB_STATUS.PENDING, ...(jobId ? { id: jobId } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  if (!nextJob) {
    return null;
  }

  const claimed = await tx.backgroundJob.updateMany({
    where: {
      id: nextJob.id,
      status: BACKGROUND_JOB_STATUS.PENDING,
    },
    data: {
      status: BACKGROUND_JOB_STATUS.RUNNING,
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      errorMessage: null,
    },
  });

  if (!claimed.count) {
    return null;
  }

  return tx.backgroundJob.findUnique({
    where: { id: nextJob.id },
  });
});

const runAnnualPromotionJob = async ({ jobId, payload, claimStartedAt }) => {
  const gate = getPromotionDateGate();
  const targetAcademicYear = Number(
    payload?.targetAcademicYear ?? gate.academicYear ?? NaN
  );
  const totalItems = await prisma.student.count();
  const currentJob = await prisma.backgroundJob.findUnique({
    where: { id: jobId },
    select: { result: true },
  });
  const currentJobState = normalizePromotionJobResult(
    currentJob?.result,
    targetAcademicYear
  );
  const historicalState = Number.isInteger(targetAcademicYear)
    ? await getPromotionHistoryForAcademicYear(targetAcademicYear, {
        excludeJobId: jobId,
      })
    : {
        academicYear: null,
        promotedStudentIds: new Set(),
        class12ManualReviewStudentIds: new Set(),
      };
  const summary = {
    totalItems,
    processedItems: 0,
    succeededItems: 0,
    failedItems: 0,
    batchesProcessed: 0,
    targetAcademicYear,
    academicYear: Number.isInteger(targetAcademicYear) ? targetAcademicYear : null,
    dateGateOpen: gate.allowed,
    gateDate: gate.date,
    gateTimeZone: gate.timeZone,
    gateReason: gate.reason,
    promotedCount: currentJobState.promotedStudentIds.length,
    skippedUnpaidCount: 0,
    skippedAlreadyPromotedCount: 0,
    skippedClass12ManualReviewCount: 0,
    promotedStudentIds: [...currentJobState.promotedStudentIds],
    class12ManualReviewStudentIds: [
      ...currentJobState.class12ManualReviewStudentIds,
    ],
  };

  await updateBackgroundJobProgress(jobId, { totalItems }, claimStartedAt);

  if (!gate.allowed || Number(gate.academicYear) !== targetAcademicYear) {
    return summary;
  }

  const batchSize = parsePositiveInt(payload?.batchSize, DEFAULT_BATCH_SIZE, 500);

  await forEachStudentBatch({
    prisma,
    batchSize,
    select: { id: true },
    processBatch: async (students, meta) => {
      summary.batchesProcessed = meta.batchNumber;

      for (const student of students) {
        await assertBackgroundJobClaim(jobId, claimStartedAt);
        try {
          const normalizedStudentId = Number(student.id);

          if (
            historicalState.promotedStudentIds.has(normalizedStudentId) ||
            summary.promotedStudentIds.includes(normalizedStudentId)
          ) {
            summary.skippedAlreadyPromotedCount += 1;
            continue;
          }

          const result = await promoteStudentForAcademicYear({
            jobId,
            studentId: normalizedStudentId,
            academicYear: targetAcademicYear,
          });

          if (result?.outcome === "promoted") {
            summary.succeededItems += 1;
            summary.promotedCount += 1;
            if (!summary.promotedStudentIds.includes(normalizedStudentId)) {
              summary.promotedStudentIds.push(normalizedStudentId);
            }
          } else if (result?.outcome === "not_eligible") {
            summary.skippedUnpaidCount += 1;
          } else if (result?.outcome === "already_promoted") {
            summary.skippedAlreadyPromotedCount += 1;
          } else if (
            result?.outcome === "class12_manual_review" ||
            result?.outcome === "invalid_class"
          ) {
            summary.skippedClass12ManualReviewCount += 1;
            if (!summary.class12ManualReviewStudentIds.includes(normalizedStudentId)) {
              summary.class12ManualReviewStudentIds.push(normalizedStudentId);
            }
          } else if (result?.outcome === "missing_student") {
            summary.failedItems += 1;
          } else if (
            result?.outcome === "date_blocked" ||
            result?.outcome === "job_required" ||
            result?.outcome === "missing_job"
          ) {
            summary.failedItems += 1;
          }
        } catch (error) {
          summary.failedItems += 1;
          console.error(`Promotion check failed for student ${student.id}:`, safeErrorMessage(error));
        } finally {
          summary.processedItems += 1;
        }
      }

      await updateBackgroundJobProgress(jobId, {
        processedItems: summary.processedItems,
        succeededItems: summary.succeededItems,
        failedItems: summary.failedItems,
        totalItems: summary.totalItems,
        result: {
          academicYear: summary.academicYear,
          promotedStudentIds: summary.promotedStudentIds,
          class12ManualReviewStudentIds: summary.class12ManualReviewStudentIds,
          alreadyPromotedStudentIds: [],
        },
      }, claimStartedAt);

      backgroundJobLog("promotion-batch", {
        jobId,
        batchNumber: meta.batchNumber,
        processedItems: summary.processedItems,
        promotedCount: summary.promotedCount,
      });
    },
  });

  return summary;
};

const runAssistantBulkReminderJob = async ({ jobId, payload, claimStartedAt }) => {
  const academicYear = Number(payload?.academicYear || getAcademicYear());
  const month = payload?.month || null;
  const monthlyFee = Number(payload?.monthlyFee || 0);
  const totalItems = await prisma.student.count();
  const summary = {
    totalItems,
    processedItems: 0,
    succeededItems: 0,
    failedItems: 0,
    skippedItems: 0,
    batchesProcessed: 0,
    academicYear,
    month,
  };

  await updateBackgroundJobProgress(jobId, { totalItems }, claimStartedAt);

  const batchSize = parsePositiveInt(payload?.batchSize, DEFAULT_BATCH_SIZE, 500);

  await forEachStudentBatch({
    prisma,
    batchSize,
    select: {
      id: true,
      name: true,
      phone: true,
      payments: {
        where: {
          academicYear,
          status: "paid",
        },
        select: {
          month: true,
          status: true,
        },
      },
    },
    processBatch: async (students, meta) => {
      summary.batchesProcessed = meta.batchNumber;

      for (const student of students) {
        await assertBackgroundJobClaim(jobId, claimStartedAt);
        try {
          const result = await sendReminderToStudent({
            student,
            month,
            academicYear,
            monthlyFee,
          });
          if (result.sent) {
            summary.succeededItems += 1;
          } else {
            summary.skippedItems += 1;
          }
        } catch (error) {
          summary.failedItems += 1;
          console.error(`Bulk reminder failed for student ${student.id}:`, safeErrorMessage(error));
        } finally {
          summary.processedItems += 1;
        }
      }

      await updateBackgroundJobProgress(jobId, {
        processedItems: summary.processedItems,
        succeededItems: summary.succeededItems,
        failedItems: summary.failedItems,
        totalItems: summary.totalItems,
      }, claimStartedAt);

      backgroundJobLog("reminder-batch", {
        jobId,
        batchNumber: meta.batchNumber,
        processedItems: summary.processedItems,
      });
    },
  });

  return summary;
};

const runAssistantBulkMarkPaidJob = async ({ jobId, payload, requestedByUserId, claimStartedAt }) => {
  const academicYear = Number(payload?.academicYear || getAcademicYear());
  const month = payload?.month;
  const monthlyFee = Number(payload?.monthlyFee || 0);
  const totalItems = await prisma.student.count();
  const summary = {
    totalItems,
    processedItems: 0,
    succeededItems: 0,
    failedItems: 0,
    alreadyPaid: 0,
    batchesProcessed: 0,
    academicYear,
    month,
  };

  if (!month) {
    throw new Error("Bulk mark-paid job is missing a month.");
  }

  await updateBackgroundJobProgress(jobId, { totalItems }, claimStartedAt);

  const batchSize = parsePositiveInt(payload?.batchSize, DEFAULT_BATCH_SIZE, 500);

  await forEachStudentBatch({
    prisma,
    batchSize,
    select: {
      id: true,
      name: true,
      phone: true,
    },
    processBatch: async (students, meta) => {
      summary.batchesProcessed = meta.batchNumber;

      for (const student of students) {
        await assertBackgroundJobClaim(jobId, claimStartedAt);
        try {
          const result = await markPaidForStudent({
            student,
            month,
            academicYear,
            monthlyFee,
            teacherAdminId: requestedByUserId,
          });

          if (result.status === "created") {
            summary.succeededItems += 1;
          } else if (result.status === "already_paid") {
            summary.alreadyPaid += 1;
          }
        } catch (error) {
          summary.failedItems += 1;
          console.error(`Bulk mark-paid failed for student ${student.id}:`, safeErrorMessage(error));
        } finally {
          summary.processedItems += 1;
        }
      }

      await updateBackgroundJobProgress(jobId, {
        processedItems: summary.processedItems,
        succeededItems: summary.succeededItems,
        failedItems: summary.failedItems,
        totalItems: summary.totalItems,
      }, claimStartedAt);

      backgroundJobLog("mark-paid-batch", {
        jobId,
        batchNumber: meta.batchNumber,
        processedItems: summary.processedItems,
      });
    },
  });

  return summary;
};

const executeBackgroundJob = async (job) => {
  switch (job.type) {
    case BACKGROUND_JOB_TYPES.DAILY_FEE_REMINDER:
      return runDailyFeeReminderJob({
        jobId: job.id,
        payload: job.payload || {},
        onProgress: async (progress) => {
          await updateBackgroundJobProgress(job.id, progress, job.startedAt);
        },
        beforeStudent: () => assertBackgroundJobClaim(job.id, job.startedAt),
      });
    case BACKGROUND_JOB_TYPES.ANNUAL_STUDENT_PROMOTION:
      return runAnnualPromotionJob({
        jobId: job.id,
        claimStartedAt: job.startedAt,
        payload: job.payload || {},
      });
    case BACKGROUND_JOB_TYPES.ASSISTANT_BULK_REMINDER:
      return runAssistantBulkReminderJob({
        jobId: job.id,
        claimStartedAt: job.startedAt,
        payload: job.payload || {},
      });
    case BACKGROUND_JOB_TYPES.ASSISTANT_BULK_MARK_PAID:
      return runAssistantBulkMarkPaidJob({
        jobId: job.id,
        claimStartedAt: job.startedAt,
        payload: job.payload || {},
        requestedByUserId: job.requestedByUserId,
      });
    default:
      throw new Error(`Unsupported background job type: ${job.type}`);
  }
};

export const processPendingBackgroundJobs = async ({ maxJobs = 3, db = prisma, execute = executeBackgroundJob, jobId = null } = {}) => {
  let processed = 0;
  while (processed < maxJobs) {
    const job = await claimNextBackgroundJob(db, jobId);
    if (!job) break;
    const owned = { id: job.id, status: BACKGROUND_JOB_STATUS.RUNNING, startedAt: job.startedAt };
    let renewing = null;
    let leaseLost = false;
    const renew = async () => {
      try {
        const result = await db.backgroundJob.updateMany({ where: owned, data: { lastHeartbeatAt: new Date() } });
        if (!result.count) leaseLost = true;
      } catch { leaseLost = true; }
    };
    const timer = setInterval(() => {
      if (!renewing) renewing = renew().finally(() => { renewing = null; });
    }, Math.min(30000, WORKER_STALE_MINUTES * 20000));
    timer.unref?.();
    backgroundJobLog("started", { jobId: job.id, type: job.type, source: job.source });
    try {
      const result = await execute(job);
      clearInterval(timer); await renewing;
      if (leaseLost) throw new Error("Background job claim was lost.");
      const completedAt = new Date();
      const saved = await db.backgroundJob.updateMany({ where: owned, data: { status: BACKGROUND_JOB_STATUS.COMPLETED, result, completedAt, lastHeartbeatAt: completedAt } });
      if (saved.count) backgroundJobLog("completed", { jobId: job.id, type: job.type, processedItems: result?.processedItems ?? 0 });
    } catch (error) {
      clearInterval(timer); await renewing;
      const completedAt = new Date();
      await db.backgroundJob.updateMany({ where: owned, data: { status: BACKGROUND_JOB_STATUS.FAILED, errorMessage: safeErrorMessage(error), completedAt, lastHeartbeatAt: completedAt } });
      backgroundJobLog("failed", { jobId: job.id, type: job.type, error: safeErrorMessage(error) });
    } finally { clearInterval(timer); await renewing; }
    processed += 1;
  }
  return processed;
};

export const startBackgroundJobWorker = () => {
  let stopped = false;
  let timer = null;
  let active;

  const runLoop = async () => {
    if (stopped) return;

    try {
      await processPendingBackgroundJobs();
    } catch (error) {
      backgroundJobLog("worker-loop-error", {
        error: safeErrorMessage(error),
      });
    } finally {
      if (!stopped) {
        timer = setTimeout(() => { active = runLoop(); }, WORKER_POLL_INTERVAL_MS);
      }
    }
  };

  active = runLoop();

  return async () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
    await active;
  };
};
