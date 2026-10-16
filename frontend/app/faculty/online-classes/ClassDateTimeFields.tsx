"use client";

import { useEffect, useId, useRef, useState } from "react";
import Calendar from "react-calendar";
import { CalendarDays, Clock, X } from "lucide-react";
import styles from "./page.module.css";

export default function ClassDateTimeFields({ date, startTime, disabled, onChange }: {
  date: string; startTime: string; disabled: boolean;
  onChange: (field: "date" | "startTime", value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); opener.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    calendar.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const timeField = (name: "startTime", label: string, value: string) => {
    const [hour = "", minute = ""] = value.split(":");
    return <fieldset className={styles.timeField} disabled={disabled}><legend><Clock size={16} /> {label} (IST)</legend><div>
      <select required aria-label={`${label} hour`} value={hour} onChange={event => onChange(name, event.target.value ? `${event.target.value}:${minute || "00"}` : "")}><option value="">Hour</option>{Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")).map(item => <option key={item} value={item}>{item}</option>)}</select>
      <span aria-hidden="true">:</span>
      <select required aria-label={`${label} minute`} value={minute} onChange={event => onChange(name, event.target.value ? `${hour || "00"}:${event.target.value}` : "")}><option value="">Minute</option>{Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")).map(item => <option key={item} value={item}>{item}</option>)}</select>
    </div></fieldset>;
  };
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : null;
  return <div className={`faculty-field--wide ${styles.timeControls}`}>
    <div className={`faculty-field ${styles.dateField}`} ref={root}>
      <label htmlFor={`${id}-date`}>Class Date (IST)</label>
      <div className={styles.dateInput}><input id={`${id}-date`} required pattern="\d{4}-\d{2}-\d{2}" placeholder="YYYY-MM-DD" value={date} onChange={event => onChange("date", event.target.value)} disabled={disabled} /><button ref={opener} type="button" aria-label="Choose class date" aria-expanded={open} aria-controls={`${id}-calendar`} onClick={() => setOpen(current => !current)} disabled={disabled}><CalendarDays size={19} /></button></div>
      {open ? <div id={`${id}-calendar`} ref={calendar} className={styles.calendar} role="group" aria-label="Choose class date in IST" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
        <button type="button" className={styles.calendarClose} aria-label="Close calendar" onClick={close}><X size={16} /></button>
        <Calendar locale="en-IN" value={selected && Number.isFinite(selected.getTime()) ? selected : null} onChange={value => {
          if (value instanceof Date) { onChange("date", `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`); close(); }
        }} />
      </div> : null}
    </div>
    {timeField("startTime", "Start Time", startTime)}
  </div>;
}
