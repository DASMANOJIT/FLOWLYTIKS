import cron from "node-cron";
import prisma from "../prisma/client.js";
import { purgeAuthRateLimitEvents } from "../middleware/security.js";
import { purgeExpiredEmailOtps } from "./emailOtpService.js";
import { purgeExpiredSessions } from "../utils/sessionStore.js";
import { withPgAdvisoryLock } from "../utils/dbLocks.js";
import { getAcademicYear } from "../utils/academicYear.js";
import {
  BACKGROUND_JOB_TYPES,
  createBackgroundJob,
} from "./backgroundJobService.js";

const shouldRunSchedulers = () => {
  return process.env.RUN_SCHEDULED_JOBS !== "0";
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

  cron.schedule("0 0 1 3 *", async () => {
    await withPgAdvisoryLock(prisma, "annual-student-promotion", async () => {
      const targetAcademicYear = new Date().getFullYear() - 1;
      const dedupeKey = `annual-promotion:${targetAcademicYear}`;
      const { job, created, requeued } = await createBackgroundJob({
        type: BACKGROUND_JOB_TYPES.ANNUAL_STUDENT_PROMOTION,
        source: "scheduler",
        dedupeKey,
        payload: {
          targetAcademicYear,
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
        }
      );
    }).catch((err) => {
      console.error("❌ Error during promotion cron:", err?.message || err);
    });
  });

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
