"use client";

import { useEffect, useMemo, useState } from "react";
import {
  clearAuthSession,
  getAuthToken,
} from "../../../lib/authStorage.js";
import {
  createWhatsAppReminderLink,
  isValidWhatsAppNumber,
} from "../../../lib/whatsapp.js";
import {
  formatCooldownTime,
  normalizeReminderState,
} from "../../../lib/reminderCooldown.js";

const API_BASE = "";

const DEFAULT_SUCCESS_MESSAGE =
  "Reminder opened. Available again in 24 hours if unpaid.";

export default function WhatsAppReminderButton({
  studentId,
  monthName,
  academicYear,
  amount,
  studentName,
  whatsappNumber,
  senderName,
  reminderState,
  wrapperClassName = "",
  buttonClassName = "",
  disabledButtonClassName = "",
  noteClassName = "",
  invalidLabel = "No valid WhatsApp number",
  successMessage = DEFAULT_SUCCESS_MESSAGE,
}) {
  const hasValidWhatsAppNumber = isValidWhatsAppNumber(whatsappNumber);
  const [currentReminderState, setCurrentReminderState] = useState(() =>
    normalizeReminderState(reminderState)
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPaidOverride, setIsPaidOverride] = useState(
    String(reminderState?.reason || "").toLowerCase() === "paid"
  );

  useEffect(() => {
    setCurrentReminderState(normalizeReminderState(reminderState));
    setIsPaidOverride(String(reminderState?.reason || "").toLowerCase() === "paid");
    setStatusMessage("");
  }, [
    reminderState?.canRemind,
    reminderState?.cooldownUntil,
    reminderState?.lastRemindedAt,
    reminderState?.reason,
  ]);

  useEffect(() => {
    if (currentReminderState.canRemind || !currentReminderState.cooldownUntil) {
      return undefined;
    }

    const syncRemainingTime = () => {
      const nextState = normalizeReminderState(currentReminderState);
      if (
        nextState.canRemind !== currentReminderState.canRemind ||
        nextState.remainingMs !== currentReminderState.remainingMs ||
        nextState.cooldownUntil !== currentReminderState.cooldownUntil
      ) {
        if (nextState.canRemind) {
          setStatusMessage("");
        }
        setCurrentReminderState(nextState);
      }
    };

    syncRemainingTime();
    const intervalId = window.setInterval(syncRemainingTime, 60_000);
    return () => window.clearInterval(intervalId);
  }, [
    currentReminderState.canRemind,
    currentReminderState.cooldownUntil,
    currentReminderState.remainingMs,
  ]);

  const whatsappLink = useMemo(
    () =>
      createWhatsAppReminderLink({
        number: whatsappNumber,
        studentName,
        monthName,
        amount,
        senderName,
      }),
    [amount, monthName, senderName, studentName, whatsappNumber]
  );

  const disabledClassName = [buttonClassName, disabledButtonClassName]
    .filter(Boolean)
    .join(" ");

  const handleReminderClick = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (
      isSubmitting ||
      isPaidOverride ||
      !currentReminderState.canRemind ||
      !hasValidWhatsAppNumber ||
      !whatsappLink
    ) {
      return;
    }

    const token = getAuthToken();
    if (!token) {
      window.location.href = "/login";
      return;
    }

    let popupWindow = null;
    try {
      popupWindow = window.open("about:blank", "_blank");
      if (popupWindow) {
        popupWindow.opener = null;
      }
    } catch {
      popupWindow = null;
    }

    setIsSubmitting(true);
    setStatusMessage("");

    try {
      const res = await fetch(`${API_BASE}/api/reminders/whatsapp/log`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          studentId,
          month: monthName,
          academicYear,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 401 || res.status === 403) {
        if (popupWindow && !popupWindow.closed) {
          popupWindow.close();
        }
        clearAuthSession();
        window.location.href = "/login";
        return;
      }

      if (!res.ok || data?.success === false) {
        if (popupWindow && !popupWindow.closed) {
          popupWindow.close();
        }

        if (data?.reason === "already_paid") {
          setIsPaidOverride(true);
          setStatusMessage(data?.message || "This fee is already paid.");
          return;
        }

        if (data?.reason === "cooldown") {
          setCurrentReminderState(
            normalizeReminderState({
              canRemind: false,
              cooldownUntil: data?.cooldownUntil || null,
              remainingMs: data?.remainingMs || 0,
              lastRemindedAt: data?.lastRemindedAt || null,
              reason: "cooldown",
            })
          );
          setStatusMessage(data?.message || "");
          return;
        }

        setStatusMessage(data?.message || "Failed to open reminder.");
        return;
      }

      const nextReminderState = normalizeReminderState({
        canRemind: false,
        cooldownUntil: data?.cooldownUntil || null,
        remainingMs: data?.remainingMs || 0,
        lastRemindedAt: data?.lastRemindedAt || null,
        reason: "cooldown",
      });

      setCurrentReminderState(nextReminderState);
      setStatusMessage(successMessage);

      if (popupWindow && !popupWindow.closed) {
        popupWindow.location.replace(whatsappLink);
      } else {
        window.open(whatsappLink, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
      }
      console.error("WhatsApp reminder open error:", error);
      setStatusMessage("Failed to open reminder.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const shouldShowPaidState = isPaidOverride;
  const cooldownActive =
    !shouldShowPaidState &&
    !currentReminderState.canRemind &&
    currentReminderState.remainingMs > 0;

  const buttonLabel = isSubmitting
    ? "Opening Reminder…"
    : shouldShowPaidState
      ? "Paid"
      : cooldownActive
        ? `Reminder available in ${formatCooldownTime(
            currentReminderState.remainingMs
          )}`
        : "WhatsApp Reminder";

  const isButtonDisabled =
    isSubmitting ||
    shouldShowPaidState ||
    cooldownActive ||
    !hasValidWhatsAppNumber ||
    !whatsappLink;

  return (
    <div className={wrapperClassName}>
      <button
        type="button"
        className={isButtonDisabled ? disabledClassName : buttonClassName}
        aria-label={
          hasValidWhatsAppNumber
            ? `Open WhatsApp reminder for ${studentName}`
            : `No WhatsApp number for ${studentName}`
        }
        disabled={isButtonDisabled}
        onClick={handleReminderClick}
      >
        {!hasValidWhatsAppNumber ? invalidLabel : buttonLabel}
      </button>
      {statusMessage ? (
        <p className={noteClassName}>{statusMessage}</p>
      ) : null}
    </div>
  );
}
