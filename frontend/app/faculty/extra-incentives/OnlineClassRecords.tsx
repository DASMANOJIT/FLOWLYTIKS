"use client";

import styles from "./online-classes.module.css";
import { useState } from "react";
import { apiFetch, readApiResponse } from "../../../lib/api.js";
import { CheckCircle2, Clock, Trash2, XCircle } from "lucide-react";
import pageStyles from "../online-classes/page.module.css";

export type OnlineClassRecord = {
  id: string; incentiveTypeId?: string; teacherName: string; facultyCode: string; batchName: string; className: string;
  topic: string; message: string | null; startsAt: string; endsAt: string | null; meetUrl: string;
  status: string; liveConfirmed?: boolean; canComplete: boolean; announcement: string; updatedAt: string;
  incentive: { id: string; rate: number; amount: number; status: string; paymentRecordId: string | null } | null;
  trackingEnabled?: boolean; verificationStatus?: string; verificationError?: string | null;
  verificationPending?: boolean; verificationMessage?: string;
  conferenceName?: string | null; actualStartAt?: string | null; actualEndAt?: string | null; actualDurationSeconds?: number | null; canDownloadAttendance?: boolean;
  attendance?: { totalParticipants: number; excludingTeacher: number | null; teacherVerified: boolean; participants: { identity: string; displayName: string; googleUserId: string | null; durationSeconds: number }[] } | null;
  batchIds?: string[]; batchNames?: string[]; canCancel?: boolean; canDelete?: boolean; deletionBlockedReason?: string | null;
  canEdit?: boolean;
  directoryGradeId?: string | null; directoryBatchId?: string | null;
};
const date = (value: string) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

function meetingBadge(record: OnlineClassRecord) {
  if (record.status === "LIVE" && !record.liveConfirmed) {
    return { label: record.verificationStatus?.endsWith("_REVIEW") ? "Review required" : "Status unconfirmed", style: pageStyles.scheduled, Icon: Clock };
  }
  if (record.status === "COMPLETED") return { label: "Completed", style: pageStyles.completed, Icon: CheckCircle2 };
  if (record.status === "CANCELLED") return { label: "Cancelled", style: pageStyles.cancelled, Icon: XCircle };
  if (record.status === "LIVE") return { label: "Live", style: pageStyles.live, Icon: null };
  return { label: "Scheduled", style: pageStyles.scheduled, Icon: Clock };
}

export default function OnlineClassRecords({ records, busy, onEdit, onAction, onPreview, onDelete, token, enhanced = false }: {
  records: OnlineClassRecord[]; busy?: boolean;
  onEdit?: (record: OnlineClassRecord) => void;
  onAction?: (record: OnlineClassRecord, action: "cancel" | "check") => void;
  onPreview?: (record: OnlineClassRecord) => void;
  token?: string | null;
  enhanced?: boolean;
  onDelete?: (record: OnlineClassRecord) => void;
}) {
  const [downloading, setDownloading] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const download = async (record: OnlineClassRecord) => {
    if (downloading || !token) return;
    setDownloading(record.id); setDownloadError("");
    try {
      const response = await apiFetch(`/api/faculty-extra-incentives/online-classes/${encodeURIComponent(record.id)}/attendance.pdf`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error((await readApiResponse(response, "Attendance PDF could not be downloaded.")).error);
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `online-class-${record.id}-attendance.pdf`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setDownloadError(error instanceof Error ? error.message : "Unable to download attendance PDF."); }
    finally { setDownloading(""); }
  };
  return <div className={styles.records}>{downloadError ? <p role="alert" className="faculty-toast--error">{downloadError}</p> : null}{records.map(record => {
    const badge = meetingBadge(record);
    return <article key={record.id} className={`${styles.record} ${enhanced ? pageStyles.historyCard : ""}`}>
    <div className={styles.recordHeading}><strong>{record.topic}</strong>{enhanced ? <span className={`${pageStyles.badge} ${badge.style}`}>
      {badge.Icon ? <badge.Icon size={16} /> : <span className={pageStyles.liveDot} aria-hidden="true" />}
      {badge.label}
    </span> : <span className="faculty-status">{badge.label}</span>}</div>
    <dl className={styles.details}>
      <div><dt>Teacher</dt><dd>{record.teacherName} ({record.facultyCode})</dd></div>
      <div><dt>Batches</dt><dd>{record.batchName}</dd></div>
      <div><dt>Start (IST)</dt><dd>{date(record.startsAt)}</dd></div>
      <div><dt>Google Meet</dt><dd><a href={record.meetUrl} target="_blank" rel="noopener noreferrer">{record.meetUrl}</a></dd></div>
      {record.actualStartAt ? <div><dt>Actual start (IST)</dt><dd>{date(record.actualStartAt)}</dd></div> : null}
      <div><dt>Actual end (IST)</dt><dd>{record.actualEndAt ? date(record.actualEndAt) : "Pending Google end time"}</dd></div>
      <div><dt>Actual duration</dt><dd>{record.actualDurationSeconds != null ? `${Math.floor(record.actualDurationSeconds / 60)}m ${Math.floor(record.actualDurationSeconds % 60)}s` : "Pending Google end time"}</dd></div>
      {record.attendance ? <><div><dt>Total participants</dt><dd>{record.attendance.totalParticipants}</dd></div><div><dt>Excluding teacher</dt><dd>{record.attendance.excludingTeacher ?? "Unavailable: teacher identity not verified"}</dd></div></> : null}
      {record.incentive ? <div><dt>Linked incentive</dt><dd>{!enhanced ? <>{record.incentive.id}<br /></> : null}{record.incentive.status} · {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(record.incentive.amount)}</dd></div> : null}
    </dl>
    {record.message ? <p className={styles.message}>{record.message}</p> : null}
    {!record.trackingEnabled ? <p className={styles.muted}>Legacy record. Google attendance is not verified; historical incentives are unchanged.</p> : <p className={styles.muted}>Verification: {record.verificationStatus === "MISSING_DATA" ? "Pending Google meeting data" : record.verificationStatus?.replaceAll("_", " ") || "Pending"}. Participants are not necessarily registered students.</p>}
    {record.verificationError ? <p className={record.verificationPending ? styles.muted : "faculty-toast--error"} role="status">{record.verificationStatus === "MISSING_DATA" ? "Waiting for Google meeting data. Verification retries automatically; no incentive has been credited." : record.verificationError}</p> : null}
    {record.attendance ? <details><summary>Participant attendance</summary>{record.attendance.participants.map(person => <p key={person.identity} className={styles.message}>{person.displayName} · {Math.floor(person.durationSeconds / 60)}m {Math.floor(person.durationSeconds % 60)}s</p>)}</details> : null}
    <div className={styles.actions}>
      {onPreview ? <button type="button" className="faculty-button faculty-button--ghost" onClick={() => onPreview(record)} disabled={busy}>Message Preview</button> : null}
      {onEdit && record.status === "SCHEDULED" ? <button type="button" className="faculty-button faculty-button--soft" onClick={() => onEdit(record)} disabled={busy || record.canEdit === false} title={record.canEdit === false ? "This class is already tracked or credited. Refresh or use admin correction." : undefined}>Edit Class</button> : null}
      {onAction && record.canCancel ? <>
        <button type="button" className="faculty-button faculty-button--ghost" onClick={() => onAction(record, "cancel")} disabled={busy}>Cancel Class</button>
      </> : null}
      {onAction && record.trackingEnabled && record.status !== "CANCELLED" ? <button type="button" className="faculty-button faculty-button--primary" onClick={() => onAction(record, "check")} disabled={busy}>Check Meeting Status</button> : null}
      {token && record.canDownloadAttendance ? <button type="button" className="faculty-button faculty-button--soft" onClick={() => void download(record)} disabled={busy || Boolean(downloading)}>{downloading === record.id ? "Downloading..." : "Download Attendance PDF"}</button> : null}
      {onDelete ? <button type="button" className={`faculty-button faculty-button--ghost ${pageStyles.deleteButton}`} onClick={() => onDelete(record)} disabled={busy || !record.canDelete} title={record.deletionBlockedReason || undefined}><Trash2 size={16} />Delete Class</button> : null}
    </div>
    {onDelete && record.deletionBlockedReason ? <p className={styles.muted}>{record.deletionBlockedReason}</p> : null}
  </article>; })}</div>;
}
