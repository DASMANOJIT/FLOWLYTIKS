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

export const formatCooldownTime = (remainingMs) => {
  const normalizedRemainingMs = Math.max(0, Number(remainingMs) || 0);
  const totalMinutes = Math.max(1, Math.ceil(normalizedRemainingMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

export const normalizeReminderState = (reminderState = {}) => {
  const reason = String(reminderState?.reason || "").trim().toLowerCase();
  const lastRemindedAt = reminderState?.lastRemindedAt || null;
  const cooldownUntilDate =
    toValidDate(reminderState?.cooldownUntil) ||
    getReminderCooldownUntil(lastRemindedAt);
  const remainingMs = cooldownUntilDate
    ? Math.max(0, cooldownUntilDate.getTime() - Date.now())
    : 0;

  if (reason === "paid") {
    return {
      canRemind: false,
      cooldownUntil: null,
      remainingMs: 0,
      lastRemindedAt,
      reason: "paid",
    };
  }

  if (remainingMs > 0) {
    return {
      canRemind: false,
      cooldownUntil: cooldownUntilDate
        ? cooldownUntilDate.toISOString()
        : null,
      remainingMs,
      lastRemindedAt,
      reason: "cooldown",
    };
  }

  return {
    canRemind: true,
    cooldownUntil: null,
    remainingMs: 0,
    lastRemindedAt,
    reason: "available",
  };
};
