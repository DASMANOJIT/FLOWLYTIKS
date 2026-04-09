import prisma from "../prisma/client.js";
import { getAcademicYear } from "../utils/academicYear.js";
import { withPgAdvisoryLock } from "../utils/dbLocks.js";
import { forEachStudentBatch } from "../utils/studentBatching.js";
import { runDailyFeeReminderJob } from "./reminderservice.js";
import { markPaidForStudent, sendReminderToStudent } from "./feeOpsService.js";
import { autoPromoteIfEligible } from "../controllers/studentcontrollers.js";

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
}) => {
  const reviveFailedJobIfNeeded = async (existingJob) => {
    if (!existingJob || existingJob.status !== BACKGROUND_JOB_STATUS.FAILED) {
      return { job: existingJob, requeued: false };
    }

    const job = await prisma.backgroundJob.update({
      where: { id: existingJob.id },
      data: {
        status: BACKGROUND_JOB_STATUS.PENDING,
        totalItems: 0,
        processedItems: 0,
        succeededItems: 0,
        failedItems: 0,
        errorMessage: null,
        result: null,
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
    const existing = await prisma.backgroundJob.findUnique({
      where: { dedupeKey },
    });
    if (existing) {
      const revived = await reviveFailedJobIfNeeded(existing);
      return { job: revived.job, created: false, requeued: revived.requeued };
    }
  }

  try {
    const job = await prisma.backgroundJob.create({
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
      const existing = await prisma.backgroundJob.findUnique({
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

const updateBackgroundJobProgress = async (jobId, patch = {}) => {
  return prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      ...patch,
      lastHeartbeatAt: new Date(),
    },
  });
};

const completeBackgroundJob = async (jobId, result = {}) => {
  const completedAt = new Date();
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: BACKGROUND_JOB_STATUS.COMPLETED,
      result,
      completedAt,
      lastHeartbeatAt: completedAt,
    },
  });
};

const failBackgroundJob = async (jobId, error, patch = {}) => {
  const completedAt = new Date();
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: BACKGROUND_JOB_STATUS.FAILED,
      errorMessage: safeErrorMessage(error),
      completedAt,
      lastHeartbeatAt: completedAt,
      ...patch,
    },
  });
};

const requeueStaleRunningJobs = async () => {
  const staleBefore = new Date(Date.now() - WORKER_STALE_MINUTES * 60_000);
  const result = await prisma.backgroundJob.updateMany({
    where: {
      status: BACKGROUND_JOB_STATUS.RUNNING,
      lastHeartbeatAt: {
        lt: staleBefore,
      },
    },
    data: {
      status: BACKGROUND_JOB_STATUS.PENDING,
      totalItems: 0,
      processedItems: 0,
      succeededItems: 0,
      failedItems: 0,
      errorMessage: "Requeued after stale worker heartbeat.",
      result: null,
      startedAt: null,
      completedAt: null,
      lastHeartbeatAt: null,
    },
  });

  if (result.count) {
    backgroundJobLog("requeued-stale", { count: result.count });
  }
};

const claimNextPendingJob = async () => {
  const nextJob = await prisma.backgroundJob.findFirst({
    where: { status: BACKGROUND_JOB_STATUS.PENDING },
    orderBy: { createdAt: "asc" },
  });

  if (!nextJob) {
    return null;
  }

  const claimed = await prisma.backgroundJob.updateMany({
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

  return prisma.backgroundJob.findUnique({
    where: { id: nextJob.id },
  });
};

const runAnnualPromotionJob = async ({ jobId, payload }) => {
  const targetAcademicYear = Number(payload?.targetAcademicYear || new Date().getFullYear() - 1);
  const totalItems = await prisma.student.count();
  const summary = {
    totalItems,
    processedItems: 0,
    succeededItems: 0,
    failedItems: 0,
    batchesProcessed: 0,
    targetAcademicYear,
  };

  await updateBackgroundJobProgress(jobId, { totalItems });

  const batchSize = parsePositiveInt(payload?.batchSize, DEFAULT_BATCH_SIZE, 500);

  await forEachStudentBatch({
    prisma,
    batchSize,
    select: { id: true },
    processBatch: async (students, meta) => {
      summary.batchesProcessed = meta.batchNumber;

      for (const student of students) {
        try {
          await autoPromoteIfEligible(student.id, targetAcademicYear);
          summary.succeededItems += 1;
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
      });

      backgroundJobLog("promotion-batch", {
        jobId,
        batchNumber: meta.batchNumber,
        processedItems: summary.processedItems,
      });
    },
  });

  return summary;
};

const runAssistantBulkReminderJob = async ({ jobId, payload }) => {
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

  await updateBackgroundJobProgress(jobId, { totalItems });

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
      });

      backgroundJobLog("reminder-batch", {
        jobId,
        batchNumber: meta.batchNumber,
        processedItems: summary.processedItems,
      });
    },
  });

  return summary;
};

const runAssistantBulkMarkPaidJob = async ({ jobId, payload, requestedByUserId }) => {
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

  await updateBackgroundJobProgress(jobId, { totalItems });

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
      });

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
          await updateBackgroundJobProgress(job.id, progress);
        },
      });
    case BACKGROUND_JOB_TYPES.ANNUAL_STUDENT_PROMOTION:
      return runAnnualPromotionJob({
        jobId: job.id,
        payload: job.payload || {},
      });
    case BACKGROUND_JOB_TYPES.ASSISTANT_BULK_REMINDER:
      return runAssistantBulkReminderJob({
        jobId: job.id,
        payload: job.payload || {},
      });
    case BACKGROUND_JOB_TYPES.ASSISTANT_BULK_MARK_PAID:
      return runAssistantBulkMarkPaidJob({
        jobId: job.id,
        payload: job.payload || {},
        requestedByUserId: job.requestedByUserId,
      });
    default:
      throw new Error(`Unsupported background job type: ${job.type}`);
  }
};

export const processPendingBackgroundJobs = async ({ maxJobs = 3 } = {}) => {
  return withPgAdvisoryLock(
    prisma,
    "background-job-dispatcher",
    async () => {
      await requeueStaleRunningJobs();

      let processed = 0;
      while (processed < maxJobs) {
        const job = await claimNextPendingJob();
        if (!job) break;

        backgroundJobLog("started", {
          jobId: job.id,
          type: job.type,
          source: job.source,
        });

        try {
          const result = await executeBackgroundJob(job);
          await completeBackgroundJob(job.id, result);
          backgroundJobLog("completed", {
            jobId: job.id,
            type: job.type,
            processedItems: result?.processedItems ?? 0,
            succeededItems: result?.succeededItems ?? 0,
            failedItems: result?.failedItems ?? 0,
          });
        } catch (error) {
          await failBackgroundJob(job.id, error);
          backgroundJobLog("failed", {
            jobId: job.id,
            type: job.type,
            error: safeErrorMessage(error),
          });
        }

        processed += 1;
      }

      return processed;
    },
    { onLocked: () => 0 }
  );
};

export const startBackgroundJobWorker = () => {
  let stopped = false;
  let timer = null;

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
        timer = setTimeout(runLoop, WORKER_POLL_INTERVAL_MS);
      }
    }
  };

  void runLoop();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
};
