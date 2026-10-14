"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send } from "lucide-react";
import { useModalDialog } from "../components/ui/Modal";
import { apiFetch, readApiResponse } from "../../lib/api.js";
import { getAuthToken } from "../../lib/authStorage.js";

type Entry = { id: string; note: string; createdAt: string; staff: { name: string } };
export default function StudentFollowUpPanel({ student, onClose, onSaved }: { student: { id: number; name: string; class: string; phone: string }; onClose: () => void; onSaved?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const moreRequest = useRef<AbortController | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyBusy, setHistoryBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setHistoryBusy(true); setHistoryError(""); setEntries([]); setCursor(null);
    void (async () => {
      try {
        const response = await apiFetch(`/api/staff/students/${student.id}/timeline?limit=30`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
        const result = await readApiResponse(response);
        if (!result.ok) throw new Error(result.error);
        if (!controller.signal.aborted) { setEntries(result.data.events); setCursor(result.data.nextCursor); }
      } catch (error) { if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "Unable to load timeline."); }
      finally { if (!controller.signal.aborted) setHistoryBusy(false); }
    })();
    return () => { controller.abort(); moreRequest.current?.abort(); moreRequest.current = null; };
  }, [student.id, refresh]);
  const loadMore = async () => {
    if (historyBusy || !cursor || moreRequest.current) return;
    const controller = new AbortController(); moreRequest.current = controller;
    setHistoryBusy(true); setHistoryError("");
    try {
      const response = await apiFetch(`/api/staff/students/${student.id}/timeline?limit=30&cursor=${encodeURIComponent(cursor)}`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
      const result = await readApiResponse(response);
      if (!result.ok) throw new Error(result.error);
      if (controller.signal.aborted) return;
      setEntries((current) => [...current, ...result.data.events.filter((entry: Entry) => !current.some((saved) => saved.id === entry.id))]); setCursor(result.data.nextCursor);
    } catch (error) { if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "Unable to load timeline."); }
    finally { if (moreRequest.current === controller) { moreRequest.current = null; setHistoryBusy(false); } }
  };
  useModalDialog(dialog);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || !note.trim()) return;
    submitting.current = true; setBusy(true); setError(""); setSuccess("");
    try {
      const response = await apiFetch(`/api/staff/students/${student.id}/follow-ups`, { method: "POST", headers: { Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ note }) });
      const result = await readApiResponse(response);
      if (!result.ok) throw new Error(result.error);
      setNote(""); setSuccess(result.data.message);
      setRefresh((current) => current + 1); onSaved?.();
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save follow-up. Please try again."); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="staff-note-dialog staff-timeline-dialog" aria-labelledby="staff-note-title" onCancel={(event) => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <header><div><h2 id="staff-note-title">Follow-Up · {student.name}</h2><p>ID {student.id} · Class {student.class} · {student.phone}</p></div><button aria-label="Close follow-up" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    <div className="staff-note-bubble">Internal Staff / Admin follow-up. No message is sent to the student.</div>
    <div className="staff-timeline-columns"><div className="staff-timeline-history"><h3>Student Activity Timeline</h3><button type="button" disabled={historyBusy || busy} onClick={() => setRefresh((current) => current + 1)}>Refresh Timeline</button>
    {historyError && <p role="alert">{historyError}</p>}{historyBusy && <p role="status">Loading timeline...</p>}
    {!historyBusy && !historyError && !entries.length && <p>No activity recorded.</p>}
    <ol className="staff-followup-thread">{entries.map((entry) => <li key={entry.id}><div><strong>{entry.staff.name}</strong><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></div><p>{entry.note}</p></li>)}</ol>
    {cursor && <button type="button" disabled={historyBusy || busy} onClick={() => void loadMore()}>Load More</button>}
    </div><div>
    {success && <p role="status">{success}</p>}
    <form onSubmit={submit}><label className="staff-field">Follow-up information<textarea autoFocus required maxLength={4000} rows={6} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="Call outcome, parent's response or promised payment date..." /></label>
      {error && <p role="alert">{error}</p>}<div className="staff-modal-actions"><button type="submit" disabled={busy || historyBusy || !note.trim()}><Send size={17} />{busy ? "Saving..." : "Add Follow-Up"}</button><button type="button" disabled={busy} onClick={onClose}>Close</button></div>
    </form>
    </div></div>
  </dialog>;
}
