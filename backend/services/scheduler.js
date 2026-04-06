import cron from "node-cron";
import prisma from "../prisma/client.js";
import { autoPromoteIfEligible } from "../controllers/studentcontrollers.js";
import { purgeAuthRateLimitEvents } from "../middleware/security.js";
import { runDailyFeeReminderJob } from "./reminderservice.js";
import { purgeExpiredEmailOtps } from "./emailOtpService.js";
import { purgeExpiredSessions } from "../utils/sessionStore.js";
import { withPgAdvisoryLock } from "../utils/dbLocks.js";

const shouldRunSchedulers = () => {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.RUN_SCHEDULED_JOBS !== "0";
};

export const registerScheduledJobs = () => {
  if (!shouldRunSchedulers()) {
    console.log("⏸ Scheduled jobs disabled for this process");
    return;
  }

  cron.schedule("0 0 1 3 *", async () => {
    await withPgAdvisoryLock(prisma, "annual-student-promotion", async () => {
      console.log("🔔 Running annual promotion check...");
      const targetAcademicYear = new Date().getFullYear() - 1;
      const students = await prisma.student.findMany({
        select: { id: true },
      });
      for (const student of students) {
        await autoPromoteIfEligible(student.id, targetAcademicYear);
      }
      console.log("✅ Promotion check completed.");
    }).catch((err) => {
      console.error("❌ Error during promotion cron:", err?.message || err);
    });
  });

  cron.schedule(
    process.env.REMINDER_CRON || "0 9 * * *",
    async () => {
      await withPgAdvisoryLock(prisma, "daily-fee-reminders", async () => {
        console.log("🔔 Running daily fee reminder job...");
        await runDailyFeeReminderJob();
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
