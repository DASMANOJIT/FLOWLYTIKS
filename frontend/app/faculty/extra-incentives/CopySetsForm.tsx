"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Plus, Pencil } from "lucide-react";
import { apiCall } from "../../../lib/api.js";
import styles from "./copy-sets.module.css";

type Entry = { id: string; quantityChange: number; rate: number; amount: number; note: string | null; status: string; createdAt: string; updatedAt: string; editable: boolean };
type Props = { token: string | null; incentiveTypeId: string; rate: number; pendingCount: number; pendingAmount: number; onChanged: () => Promise<void>; onBusy: (busy: boolean) => void; adminFacultyId?: string };
const call = apiCall as <T>(path: string, method: string, body: unknown, token: string | null) => Promise<T>;
const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);

export default function CopySetsForm({ token, incentiveTypeId, rate, pendingCount, pendingAmount, onChanged, onBusy, adminFacultyId }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [draft, setDraft] = useState<{ quantity: string; remark: string; requestId: string; entry?: Entry } | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldId = useId();
  const load = useCallback(async (nextPage = 1) => {
    setLoading(true); setError("");
    try {
      const path = adminFacultyId ? `/faculty-extra-incentives/admin/${adminFacultyId}/sets/${incentiveTypeId}` : `/faculty-extra-incentives/my/${incentiveTypeId}/sets`;
      const data = await call<{ entries: Entry[]; totalPages: number }>(`${path}?page=${nextPage}`, "GET", null, token);
      setEntries(data.entries); setPage(nextPage); setPages(data.totalPages);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load saved sets."); }
    finally { setLoading(false); }
  }, [token, incentiveTypeId, adminFacultyId]);
  useEffect(() => { void load(); }, [load]);
  const openDraft = (entry?: Entry) => {
    setDraft({ quantity: entry ? String(entry.quantityChange) : "", remark: entry?.note || "", requestId: crypto.randomUUID(), entry });
    setError(""); setSuccess("");
    requestAnimationFrame(() => { formRef.current?.scrollIntoView({ block: "nearest" }); formRef.current?.querySelector("input")?.focus({ preventScroll: true }); });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || submitting.current || adminFacultyId) return;
    const quantity = Number(draft.quantity);
    if (!/^\d+$/.test(draft.quantity) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) { setError("Number of copies must be a positive whole number."); return; }
    if (draft.remark.trim().length > 2000) { setError("Remark must be 2000 characters or fewer."); return; }
    submitting.current = true; setSaving(true); onBusy(true); setError(""); setSuccess("");
    try {
      const path = `/faculty-extra-incentives/my/${incentiveTypeId}/sets${draft.entry ? `/${draft.entry.id}` : ""}`;
      await call(path, draft.entry ? "PATCH" : "POST", { quantity, remark: draft.remark, requestId: draft.requestId, expectedUpdatedAt: draft.entry?.updatedAt }, token);
      setDraft(null); setSuccess(draft.entry ? "Set updated." : "Set added.");
      await Promise.all([load(1), onChanged()]);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to save the set."); }
    finally { submitting.current = false; setSaving(false); onBusy(false); }
  };
  const preview = draft && /^\d+$/.test(draft.quantity) && Number(draft.quantity) > 0 ? Number(draft.quantity) * (draft.entry?.rate ?? rate) : null;
  return <div className={styles.sets}>
    <dl className={styles.summary}><div><dt>Configured Rate</dt><dd>{money(rate)}</dd></div><div><dt>Pending Count</dt><dd>{pendingCount}</dd></div><div><dt>Pending Amount</dt><dd>{money(pendingAmount)}</dd></div></dl>
    {!adminFacultyId ? <button type="button" className="faculty-button faculty-button--primary" disabled={saving} onClick={() => openDraft()}><Plus size={16} /> Add Number of Copies</button> : null}
    {error ? <div className="faculty-toast--error" role="alert">{error}</div> : null}
    {success ? <p role="status" className={styles.success}>{success}</p> : null}
    {draft ? <form ref={formRef} className={styles.form} onSubmit={save}>
      <h3>{draft.entry ? "Edit Set" : "New Set of Copies"}</h3>
      <div className="faculty-field"><label htmlFor={`${fieldId}-quantity`}>Number of Copies</label><input id={`${fieldId}-quantity`} autoFocus type="number" inputMode="numeric" min="1" max="2147483647" step="1" required value={draft.quantity} disabled={saving} onChange={event => setDraft({ ...draft, quantity: event.target.value })} /></div>
      <div className="faculty-field"><label htmlFor={`${fieldId}-remark`}>Remark</label><textarea id={`${fieldId}-remark`} rows={3} maxLength={2000} value={draft.remark} disabled={saving} onChange={event => setDraft({ ...draft, remark: event.target.value })} /></div>
      <p>Applied rate: <strong>{money(draft.entry?.rate ?? rate)}</strong> | Amount: <strong>{preview === null ? "-" : money(preview)}</strong></p>
      <div className={styles.actions}><button type="button" className="faculty-button faculty-button--ghost" disabled={saving} onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="faculty-button faculty-button--primary" disabled={saving}>{saving ? "Saving..." : draft.entry ? "Save" : "Add"}</button></div>
    </form> : null}
    <div className={styles.actions}><h3>Saved Sets</h3><button type="button" className="faculty-button faculty-button--ghost" disabled={loading || saving} onClick={() => void load(page)}>Refresh</button></div>
    {loading ? <p role="status">Loading saved sets...</p> : entries.length ? <ul className={styles.entries}>{entries.map(entry => <li key={entry.id}>
      <div className={styles.actions}><strong>{entry.quantityChange > 0 ? `${entry.quantityChange} copies` : `Legacy adjustment: ${entry.quantityChange}`}</strong><span className={styles.status}>{entry.status}</span></div>
      <p>{money(entry.rate)} per copy | {money(entry.amount)}</p>
      <p className={styles.remark}>{entry.note || "No remark recorded."}</p>
      <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST</time>
      {!adminFacultyId && entry.editable ? <button type="button" className="faculty-button faculty-button--ghost" disabled={saving} onClick={() => openDraft(entry)}><Pencil size={16} /> Edit Set</button> : <span className={styles.readonly}>Read-only</span>}
    </li>)}</ul> : !error ? <p>No saved sets found.</p> : null}
    <div className={styles.actions}><button type="button" className="faculty-button faculty-button--ghost" disabled={loading || saving || page <= 1} onClick={() => void load(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button type="button" className="faculty-button faculty-button--ghost" disabled={loading || saving || page >= pages} onClick={() => void load(page + 1)}>Next</button></div>
    {!adminFacultyId ? <button type="button" className="faculty-button faculty-button--soft" disabled={saving} onClick={() => openDraft()}><Plus size={16} /> Add Another Set of Copies</button> : null}
  </div>;
}
