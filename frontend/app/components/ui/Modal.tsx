"use client";

import { useEffect, useRef, type RefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";

const scrollLocks = new Map<HTMLElement, { count: number; overflow: string }>();

export function useModalDialog(ref: RefObject<HTMLDialogElement | null>, open = true) {
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.classList.add(styles.dialog);
    if (!dialog.hasAttribute("aria-labelledby") && !dialog.hasAttribute("aria-label")) {
      dialog.setAttribute("aria-label", dialog.querySelector("h2, h3")?.textContent || "Dialog");
    }
    if (!dialog.open) dialog.showModal();
    const containers = [document.body];
    for (let parent = dialog.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) containers.push(parent);
    }
    for (const element of containers) {
      const lock = scrollLocks.get(element) || { count: 0, overflow: element.style.overflow };
      lock.count++; scrollLocks.set(element, lock); element.style.overflow = "hidden";
    }
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", trap);
    return () => {
      dialog.removeEventListener("keydown", trap);
      dialog.close();
      for (const element of containers) {
        const lock = scrollLocks.get(element);
        if (lock && --lock.count === 0) { element.style.overflow = lock.overflow; scrollLocks.delete(element); }
      }
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref, open]);
}

export default function Modal({ children, className = "", onClose }: { children: ReactNode; className?: string; onClose?: () => void; role?: string; "aria-modal"?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref);
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={ref} className={`${styles.overlay} ${className}`} aria-modal="true" onCancel={event => {
    event.preventDefault();
    if (onClose) onClose();
    else {
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") || [])];
      const close = buttons.find(button => /^(cancel|close)$/i.test(button.textContent?.trim() || "") || /close/i.test(button.getAttribute("aria-label") || ""));
      (close || ref.current?.querySelector<HTMLButtonElement>(".faculty-modal-header .faculty-icon-button"))?.click();
    }
  }}><div className={styles.content}>{children}</div></dialog>, document.body);
}
