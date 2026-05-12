import prisma from "../prisma/client.js";
import {
  buildWhatsAppReminderState,
  getReminderCooldownUntil,
  getRemainingReminderCooldown,
  WHATSAPP_REMINDER_CHANNEL,
} from "../services/reminderCooldownService.js";

export const logWhatsAppReminder = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Admin only",
      });
    }

    const studentId = Number(req.body?.studentId);
    const month = String(req.body?.month || "").trim();
    const academicYear = Number(req.body?.academicYear);
    const adminId = Number(req.user?.id || 0) || null;

    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true },
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found.",
      });
    }

    const paidPayment = await prisma.payment.findFirst({
      where: {
        studentId,
        month,
        academicYear,
        status: "paid",
      },
      select: { id: true },
    });

    if (paidPayment) {
      return res.status(200).json({
        success: false,
        reason: "already_paid",
        message: "This fee is already paid.",
      });
    }

    const existingLog = await prisma.feeReminderLog.findUnique({
      where: {
        studentId_month_academicYear_channel: {
          studentId,
          month,
          academicYear,
          channel: WHATSAPP_REMINDER_CHANNEL,
        },
      },
      select: {
        lastRemindedAt: true,
      },
    });

    const remainingMs = getRemainingReminderCooldown(
      existingLog?.lastRemindedAt || null
    );

    if (remainingMs > 0) {
      const cooldownUntil = getReminderCooldownUntil(
        existingLog?.lastRemindedAt || null
      );

      return res.status(200).json({
        success: false,
        reason: "cooldown",
        cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
        remainingMs,
        lastRemindedAt: existingLog?.lastRemindedAt
          ? existingLog.lastRemindedAt.toISOString()
          : null,
        message: "Reminder is on cooldown.",
      });
    }

    const reminderLog = await prisma.feeReminderLog.upsert({
      where: {
        studentId_month_academicYear_channel: {
          studentId,
          month,
          academicYear,
          channel: WHATSAPP_REMINDER_CHANNEL,
        },
      },
      update: {
        adminId,
        lastRemindedAt: new Date(),
      },
      create: {
        studentId,
        adminId,
        month,
        academicYear,
        channel: WHATSAPP_REMINDER_CHANNEL,
      },
      select: {
        lastRemindedAt: true,
      },
    });

    const reminderState = buildWhatsAppReminderState({
      isPaid: false,
      lastRemindedAt: reminderLog.lastRemindedAt,
    });

    return res.status(200).json({
      success: true,
      cooldownUntil: reminderState.cooldownUntil,
      remainingMs: reminderState.remainingMs,
      lastRemindedAt: reminderState.lastRemindedAt,
      message: "Reminder logged successfully.",
    });
  } catch (error) {
    console.error("logWhatsAppReminder error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to log reminder.",
    });
  }
};
