export const WHATSAPP_REMINDER_CHANNEL = "whatsapp";
export const WHATSAPP_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const toValidDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getReminderCooldownUntil = (lastRemindedAt) => {
  const remindedAt = toValidDate(lastRemindedAt);
  if (!remindedAt) return null;
  return new Date(remindedAt.getTime() + WHATSAPP_REMINDER_COOLDOWN_MS);
};

export const getRemainingReminderCooldown = (
  lastRemindedAt,
  now = new Date()
) => {
  const cooldownUntil = getReminderCooldownUntil(lastRemindedAt);
  if (!cooldownUntil) return 0;

  return Math.max(0, cooldownUntil.getTime() - now.getTime());
};

export const isReminderOnCooldown = (lastRemindedAt, now = new Date()) =>
  getRemainingReminderCooldown(lastRemindedAt, now) > 0;

export const buildWhatsAppReminderState = ({
  isPaid = false,
  lastRemindedAt = null,
  now = new Date(),
} = {}) => {
  const remindedAt = toValidDate(lastRemindedAt);
  const serializedLastRemindedAt = remindedAt ? remindedAt.toISOString() : null;

  if (isPaid) {
    return {
      canRemind: false,
      cooldownUntil: null,
      remainingMs: 0,
      lastRemindedAt: serializedLastRemindedAt,
      reason: "paid",
    };
  }

  const remainingMs = getRemainingReminderCooldown(remindedAt, now);
  if (remainingMs > 0) {
    const cooldownUntil = getReminderCooldownUntil(remindedAt);
    return {
      canRemind: false,
      cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
      remainingMs,
      lastRemindedAt: serializedLastRemindedAt,
      reason: "cooldown",
    };
  }

  return {
    canRemind: true,
    cooldownUntil: null,
    remainingMs: 0,
    lastRemindedAt: serializedLastRemindedAt,
    reason: "available",
  };
};

export const mapReminderLogsByStudentId = (logs = []) =>
  new Map(
    logs
      .filter((log) => Number.isFinite(Number(log?.studentId)))
      .map((log) => [Number(log.studentId), log])
  );
