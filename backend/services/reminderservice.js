import prisma from "../prisma/client.js";
import { getAcademicYear } from "../utils/academicYear.js";
import { forEachStudentBatch } from "../utils/studentBatching.js";
import {
  isWhatsAppConfigured,
  getDueMonthsForReminder,
} from "./whatsappservice.js";
import { sendReminderToStudent } from "./feeOpsService.js";

const parsePositiveInt = (value, fallback, max = 500) => {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(numeric, max);
};

export const runDailyFeeReminderJob = async ({
  jobId = null,
  payload = {},
  onProgress = null,
} = {}) => {
  if (!isWhatsAppConfigured()) {
    console.log("WhatsApp reminder skipped: config missing.");
    return {
      totalItems: 0,
      processedItems: 0,
      succeededItems: 0,
      failedItems: 0,
      skippedItems: 0,
      batchesProcessed: 0,
      skippedReason: "config_missing",
    };
  }

  try {
    const academicYear = Number(payload?.academicYear || getAcademicYear());
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    const monthlyFee = settings?.monthlyFee || 0;
    const summary = {
      totalItems: await prisma.student.count(),
      processedItems: 0,
      succeededItems: 0,
      failedItems: 0,
      skippedItems: 0,
      batchesProcessed: 0,
      academicYear,
      jobId,
    };

    if (typeof onProgress === "function") {
      await onProgress({ totalItems: summary.totalItems });
    }

    const batchSize = parsePositiveInt(
      payload?.batchSize || process.env.BACKGROUND_JOB_BATCH_SIZE,
      25
    );

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
          select: { month: true, status: true },
        },
      },
      processBatch: async (students, meta) => {
        summary.batchesProcessed = meta.batchNumber;

        for (const student of students) {
          const paidMonths = student.payments.map((payment) => payment.month);
          const dueMonths = getDueMonthsForReminder({ paidMonths });

          if (!dueMonths.length) {
            summary.processedItems += 1;
            summary.skippedItems += 1;
            continue;
          }

          try {
            const result = await sendReminderToStudent({
              student,
              academicYear,
              monthlyFee,
            });

            if (result.sent) {
              summary.succeededItems += 1;
              console.log(`Reminder sent to ${student.name} (${student.phone})`);
            } else {
              summary.skippedItems += 1;
            }
          } catch (err) {
            summary.failedItems += 1;
            console.error(`Reminder failed for student ${student.id}:`, err.message);
          } finally {
            summary.processedItems += 1;
          }
        }

        if (typeof onProgress === "function") {
          await onProgress({
            totalItems: summary.totalItems,
            processedItems: summary.processedItems,
            succeededItems: summary.succeededItems,
            failedItems: summary.failedItems,
          });
        }

        console.log("Reminder batch completed", {
          jobId,
          batchNumber: meta.batchNumber,
          processedItems: summary.processedItems,
          succeededItems: summary.succeededItems,
          failedItems: summary.failedItems,
          skippedItems: summary.skippedItems,
        });
      },
    });

    return summary;
  } catch (err) {
    console.error("Daily reminder job failed:", err.message);
    throw err;
  }
};
