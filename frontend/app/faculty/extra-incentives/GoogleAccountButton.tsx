"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import Modal from "../../components/ui/Modal";
import GoogleConnectionCard from "./GoogleConnectionCard";
import styles from "./google-account.module.css";

export default function GoogleAccountButton({ token, summary = false }: { token: string | null; summary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (new URLSearchParams(window.location.hash.slice(1)).has("google_connection")) setOpen(true); });
    return () => cancelAnimationFrame(frame);
  }, []);
  const close = () => { if (!busy) { setOpen(false); requestAnimationFrame(() => opener.current?.focus({ preventScroll: true })); } };
  return <div className={summary ? `faculty-stat-card ${styles.summary}` : styles.inline}>
    <button ref={opener} type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-haspopup="dialog" disabled={!token}>
      <svg className={styles.googleIcon} width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.06.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59A5.99 5.99 0 0 1 12 5.96Z"/></svg><span>Google Account</span>
    </button>
    {open ? <Modal onClose={close}><section className={styles.card}>
      <div className={styles.heading}><h2>Google Account</h2><button type="button" className="faculty-icon-button" aria-label="Close Google account" onClick={close} disabled={busy}><X size={20} /></button></div>
      <GoogleConnectionCard token={token} onBusy={setBusy} compact connectLabel="Connect Google" />
    </section></Modal> : null}
  </div>;
}
