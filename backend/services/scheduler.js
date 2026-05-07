import cron from "node-cron";
import prisma from "../prisma/client.js";
import { purgeAuthRateLimitEvents } from "../middleware/security.js";
import { purgeExpiredEmailOtps } from "./emailOtpService.js";
import { purgeExpiredSessions } from "../utils/sessionStore.js";
import { withPgAdvisoryLock } from "../utils/dbLocks.js";
import { getAcademicYear, getPromotionDateGate } from "../utils/academicYear.js";
import {
  BACKGROUND_JOB_TYPES,
  createBackgroundJob,
} from "./backgroundJobService.js";
import {
  buildPromotionJobDedupeKey,
  findActivePromotionJobForAcademicYear,
} from "./promotionService.js";

const shouldRunSchedulers = () => {
  return String(process.env.RUN_SCHEDULED_JOBS || "").trim() === "1";
};

const schedulerDateKey = (timeZone = "Asia/Kolkata") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export const registerScheduledJobs = () => {
  if (!shouldRunSchedulers()) {
    console.log("⏸ Scheduled jobs disabled for this process");
    return;
  }

  cron.schedule(
    "10 0 * * *",
    async () => {
      const gate = getPromotionDateGate();
      if (!gate.allowed || !Number.isInteger(Number(gate.academicYear))) {
        console.log("ℹ️ Annual promotion gate closed.", {
          date: gate.date,
          reason: gate.reason,
        });
        return;
      }

      const promotionDate = schedulerDateKey();

      await withPgAdvisoryLock(prisma, "annual-student-promotion", async () => {
        const targetAcademicYear = Number(gate.academicYear);
        const activeJob = await findActivePromotionJobForAcademicYear(
          targetAcademicYear
        );

        if (activeJob) {
          console.log("ℹ️ Annual promotion job already active.", {
            jobId: activeJob.id,
            targetAcademicYear,
            status: activeJob.status,
          });
          return;
        }

        const dedupeKey = buildPromotionJobDedupeKey(
          targetAcademicYear,
          promotionDate
        );
        const { job, created, requeued } = await createBackgroundJob({
          type: BACKGROUND_JOB_TYPES.ANNUAL_STUDENT_PROMOTION,
          source: "scheduler",
          dedupeKey,
          payload: {
            targetAcademicYear,
            scheduledDate: promotionDate,
          },
        });

        console.log(
          created
            ? "📥 Annual promotion job queued."
            : requeued
              ? "🔄 Annual promotion job requeued after failure."
              : "ℹ️ Annual promotion job already queued.",
          {
            jobId: job.id,
            targetAcademicYear,
            promotionDate,
          }
        );
      }).catch((err) => {
        console.error("❌ Error during promotion cron:", err?.message || err);
      });
    },
    {
      timezone: "Asia/Kolkata",
    }
  );

  cron.schedule(
    process.env.REMINDER_CRON || "0 9 * * *",
    async () => {
      await withPgAdvisoryLock(prisma, "daily-fee-reminders", async () => {
        const academicYear = getAcademicYear();
        const reminderDate = schedulerDateKey(
          process.env.REMINDER_TIMEZONE || "Asia/Kolkata"
        );
        const { job, created, requeued } = await createBackgroundJob({
          type: BACKGROUND_JOB_TYPES.DAILY_FEE_REMINDER,
          source: "scheduler",
          dedupeKey: `daily-reminder:${reminderDate}`,
          payload: {
            academicYear,
          },
        });

        console.log(
          created
            ? "📥 Daily reminder job queued."
            : requeued
              ? "🔄 Daily reminder job requeued after failure."
              : "ℹ️ Daily reminder job already queued.",
          {
            jobId: job.id,
            academicYear,
            reminderDate,
          }
        );
      }).catch((err) => {
        console.error("❌ Error during reminder cron:", err?.message || err);
      });
    },
    {
      timezone: process.env.REMINDER_TIMEZONE || "Asia/Kolkata",
    }
  );

  cron.schedule("0 * * * *", async () => {
    await withPgAdvisoryLock(prisma, "hourly-auth-maintenance", async () => {
      await Promise.all([
        purgeExpiredSessions(),
        purgeExpiredEmailOtps(),
        purgeAuthRateLimitEvents(),
      ]);
    }).catch((err) => {
      console.error("❌ Error during auth maintenance cron:", err?.message || err);
    });
  });
};
