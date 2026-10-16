"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { apiCall } from "../../../lib/api.js";
import { getAuthRole, getAuthToken } from "../../../lib/authStorage.js";
import Modal from "../../components/ui/Modal";
import BackToDashboard from "../../components/admin/BackToDashboard";
import OnlineClassRecords, { type OnlineClassRecord } from "../../faculty/extra-incentives/OnlineClassRecords";
import ClassDirectoryFields, { type DirectoryBatch } from "../../faculty/online-classes/ClassDirectoryFields";
import ClassDateTimeFields from "../../faculty/online-classes/ClassDateTimeFields";
import "../faculty/faculty.css";
import styles from "./page.module.css";

const call = apiCall as <T>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const base = "/faculty-extra-incentives";
type History = { records: OnlineClassRecord[]; hasMore: boolean; total: number; batches: string[]; faculties: { id: string; fullName: string; facultyId: string }[] };
type DirectoryEditor = { name: string };
const blankFilters = { search: "", date: "", batch: "", facultyId: "", status: "" };
const blankClass = { batchIds: [] as string[], batchName: "", topic: "", message: "", date: "", startTime: "", meetUrl: "" };
const istParts = (value: string) => new Date(+new Date(value) + 330 * 60000).toISOString();

export default function AdminOnlineClassesPage() {
  const [token, setToken] = useState<string | null>(null);
  const [directory, setDirectory] = useState<DirectoryBatch[]>([]);
  const [directoryError, setDirectoryError] = useState("");
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [editor, setEditor] = useState<DirectoryEditor | null>(null);
  const [batchSearch, setBatchSearch] = useState("");
  const [batchResults, setBatchResults] = useState<DirectoryBatch[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [batchRevision, setBatchRevision] = useState(0);
  const [deletingBatch, setDeletingBatch] = useState<DirectoryBatch | null>(null);
  const [filters, setFilters] = useState(blankFilters);
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{ record: OnlineClassRecord; action: "edit" | "cancel" | "delete" } | null>(null);
  const [classForm, setClassForm] = useState(blankClass);
  const [preview, setPreview] = useState<OnlineClassRecord | null>(null);
  const pending = useRef(false);
  const sequence = useRef(0);
  const reading = useRef(false);
  useEffect(() => {
    if (getAuthRole() !== "admin" || !getAuthToken()) { window.location.href = "/login"; return; }
    setToken(getAuthToken());
  }, []);
  const loadDirectory = useCallback(async () => {
    if (!token) return;
    try { const data = await call<{ batches: DirectoryBatch[] }>(`${base}/online-class-directory`, "GET", null, token); setDirectory(data.batches); setDirectoryError(""); }
    catch (err) { setDirectoryError(err instanceof Error ? err.message : "Unable to load directory."); }
    finally { setDirectoryLoading(false); }
  }, [token]);
  useEffect(() => {
    let active = true;
    if (!token || !batchSearch.trim()) { setBatchResults([]); setBatchLoading(false); setBatchError(""); return; }
    setBatchLoading(true); setBatchResults([]); setBatchError("");
    const timer = setTimeout(() => {
      void call<{ batches: DirectoryBatch[] }>(`${base}/online-class-directory?${new URLSearchParams({ search: batchSearch.trim() })}`, "GET", null, token)
        .then(data => { if (active) setBatchResults(data.batches); })
        .catch(err => { if (active) setBatchError(err instanceof Error ? err.message : "Unable to search batches."); })
        .finally(() => { if (active) setBatchLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [token, batchSearch, batchRevision]);
  const load = useCallback(async (next = 1, background = false) => {
    if (!token || (background && reading.current)) return;
    const request = ++sequence.current; reading.current = true; setLoading(true);
    try {
      const params = new URLSearchParams({ ...filters, page: String(next) });
      const data = await call<History>(`${base}/admin/online-classes?${params}`, "GET", null, token);
      if (request !== sequence.current) return;
      setHistory(current => next === 1 ? data : { ...data, records: [...(current?.records || []), ...data.records] }); setPage(next); setError("");
    } catch (err) { if (request === sequence.current) setError(err instanceof Error ? err.message : "Unable to load classes."); }
    finally { if (request === sequence.current) { reading.current = false; setLoading(false); } }
  }, [token, filters]);
  useEffect(() => { void loadDirectory(); }, [loadDirectory]);
  const invalidateLoad = useCallback(() => { sequence.current++; reading.current = false; }, []);
  useEffect(() => { void load(); return invalidateLoad; }, [load, invalidateLoad]);
  useEffect(() => {
    const timer = setTimeout(() => setFilters(current => current.search === search ? current : { ...current, search }), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const refresh = () => { if (!pending.current && document.visibilityState === "visible") void load(1, true); };
    const timer = setInterval(refresh, 30000); window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load]);
  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (err) { setError(err instanceof Error ? err.message : "Unable to save changes."); }
    finally { pending.current = false; setBusy(false); }
  };
  const saveDirectory = (event: FormEvent) => {
    event.preventDefault(); if (!editor) return;
    void run(async () => {
      await call(`${base}/admin/online-class-directory/batch`, "POST", { name: editor.name }, token);
      setEditor(null); setMessage("Batch added."); setBatchRevision(current => current + 1); await loadDirectory();
    });
  };
  const removeBatch = () => {
    if (!deletingBatch) return;
    void run(async () => {
      await call(`${base}/admin/online-class-directory/batch/${deletingBatch.id}`, "DELETE", {}, token);
      const id = deletingBatch.id;
      setDirectory(current => current.filter(batch => batch.id !== id));
      setBatchResults(current => current.filter(batch => batch.id !== id));
      setDeletingBatch(null); setMessage("Batch removed. Existing classes and their history are preserved.");
      setBatchRevision(current => current + 1); await loadDirectory();
    });
  };
  const openEdit = (record: OnlineClassRecord) => {
    setError(""); setSelection({ record, action: "edit" });
    setClassForm({ batchIds: record.batchIds || [], batchName: record.batchName, topic: record.topic, message: record.message || "", date: istParts(record.startsAt).slice(0, 10), startTime: istParts(record.startsAt).slice(11, 16), meetUrl: record.meetUrl });
  };
  const action = (record: OnlineClassRecord, kind: "cancel" | "check") => {
    setError("");
    if (kind === "cancel") { setSelection({ record, action: "cancel" }); return; }
    void run(async () => {
      const data = await call<{ record: OnlineClassRecord }>(`${base}/admin/online-classes/${record.id}/check`, "POST", {}, token);
      setMessage(data.record.verificationMessage || data.record.verificationError || "Meeting status checked."); await load();
    });
  };
  const saveClass = (event?: FormEvent) => {
    event?.preventDefault(); if (!selection) return;
    const { record, action: kind } = selection;
    if (kind === "edit" && !classForm.batchIds.length) { setError("Select at least one active batch."); return; }
    void run(async () => {
      const method = kind === "edit" ? "PATCH" : kind === "delete" ? "DELETE" : "POST";
      await call(`${base}/admin/online-classes/${record.id}${kind === "cancel" ? "/cancel" : ""}`, method, kind === "edit" ? { ...classForm, expectedUpdatedAt: record.updatedAt } : {}, token);
      setSelection(null); setMessage(kind === "delete" ? "Class deleted; any linked unpaid incentive was reversed." : kind === "cancel" ? "Class cancelled." : "Class updated."); await load();
    });
  };
  const field = (name: keyof typeof blankClass, value: string) => setClassForm(current => ({ ...current, [name]: value }));
  const close = () => { if (!pending.current) { setEditor(null); setDeletingBatch(null); setSelection(null); setPreview(null); } };
  return <main className={`faculty-page ${styles.root}`}><div className="faculty-shell">
    <header className="faculty-header"><BackToDashboard /><div className="faculty-title-block"><h1>Online Class</h1><p>Manage batches and verified faculty meetings.</p></div><button type="button" className="faculty-button faculty-button--ghost" disabled={busy || loading} onClick={() => { void load(); void loadDirectory(); setBatchRevision(current => current + 1); }}><RotateCcw size={16} />Refresh</button></header>
    {error ? <p role="alert" className="faculty-toast--error">{error}</p> : null}{message ? <p role="status" className={styles.feedback}>{message}</p> : null}
    <section className={styles.section}><header className={styles.heading}><h2>Batch Directory</h2><button className="faculty-button faculty-button--primary" disabled={busy} onClick={() => { setError(""); setEditor({ name: "" }); }}><Plus size={16} />Add Batch</button></header>
      <label className={`faculty-field ${styles.directorySearch}`}><span>Search batches by name</span><div className={styles.search}><Search size={16} /><input type="search" maxLength={120} placeholder="Search batches by name" value={batchSearch} onChange={event => setBatchSearch(event.target.value)} /></div></label>
      {directoryError ? <p role="alert" className="faculty-toast--error">{directoryError}</p> : null}
      {batchError ? <p role="alert" className="faculty-toast--error">{batchError}</p> : null}
      {!batchSearch.trim() ? <p>Search to find a batch</p> : batchLoading ? <p role="status">Searching batches...</p> : !batchError && !batchResults.length ? <p>No batches found.</p> : null}
      <div className={styles.directory}>{(batchSearch.trim() && !batchLoading && !batchError ? batchResults : []).map(batch => <article key={batch.id}><h3>{batch.name}</h3><button type="button" className={`faculty-button faculty-button--ghost ${styles.deleteBatch}`} disabled={busy} onClick={() => { setError(""); setDeletingBatch(batch); }} aria-label={`Delete batch ${batch.name}`}><Trash2 size={16} />Delete</button></article>)}</div>
    </section>
    <section className={styles.history}><h2>Faculty Online Classes</h2><div className={styles.filters}>
      <label className="faculty-field"><span>Search</span><div className={styles.search}><Search size={16} /><input type="search" maxLength={200} placeholder="Topic, batch or date" value={search} onChange={event => setSearch(event.target.value)} /></div></label>
      <label className="faculty-field"><span>Date (IST)</span><input type="date" value={filters.date} onChange={event => setFilters(current => ({ ...current, date: event.target.value }))} /></label>
      <label className="faculty-field"><span>Batch</span><select aria-label="Batch" value={filters.batch} onChange={event => setFilters(current => ({ ...current, batch: event.target.value }))}><option value="">All Batches</option>{history?.batches.map(batch => <option key={batch}>{batch}</option>)}{!history?.batches.length ? <option disabled>{loading ? "Loading batches..." : error ? "Unable to load batches" : "No batches available"}</option> : null}</select></label>
      <label className="faculty-field"><span>Faculty</span><select aria-label="Faculty" value={filters.facultyId} onChange={event => setFilters(current => ({ ...current, facultyId: event.target.value }))}><option value="">All Faculty</option>{history?.faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.fullName} ({faculty.facultyId})</option>)}</select></label>
      <label className="faculty-field"><span>Status</span><select aria-label="Status" value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))}><option value="">All Statuses</option>{["SCHEDULED", "LIVE", "COMPLETED", "CANCELLED"].map(status => <option key={status} value={status}>{status[0] + status.slice(1).toLowerCase()}</option>)}</select></label>
      <button className="faculty-button faculty-button--ghost" onClick={() => { setSearch(""); setFilters(blankFilters); }}><X size={16} />Clear Filters</button>
    </div>{history && !error ? <p>{history.total} matching {history.total === 1 ? "class" : "classes"}</p> : null}
      <OnlineClassRecords records={history?.records || []} token={token} busy={busy || loading} enhanced onEdit={openEdit} onAction={action} onPreview={record => { setError(""); setPreview(record); }} onDelete={record => { setError(""); setSelection({ record, action: "delete" }); }} />
      {loading ? <p role="status">Loading classes...</p> : history && !history.records.length && !error ? <p>No classes match these filters.</p> : null}
      {history?.hasMore ? <button className="faculty-button faculty-button--ghost" disabled={loading || busy} onClick={() => void load(page + 1)}>Load More</button> : null}
    </section>
    {editor ? <Modal onClose={close}><section className={styles.modal}><header><h2>Add Batch</h2><button className="faculty-icon-button" aria-label="Close" disabled={busy} onClick={close}><X size={18} /></button></header><form onSubmit={saveDirectory}>
      <label className="faculty-field"><span>Batch Name</span><input required maxLength={120} value={editor.name} disabled={busy} onChange={event => setEditor({ name: event.target.value })} /></label>
      {error ? <p role="alert" className="faculty-toast--error">{error}</p> : null}<div className={styles.actions}><button type="button" className="faculty-button faculty-button--ghost" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="faculty-button faculty-button--primary" disabled={busy}>{busy ? "Saving..." : "Save"}</button></div>
    </form></section></Modal> : null}
    {deletingBatch ? <Modal onClose={close}><section className={styles.modal}><header><h2>Delete Batch?</h2><button className="faculty-icon-button" aria-label="Close" disabled={busy} onClick={close}><X size={18} /></button></header><p>Remove <strong>{deletingBatch.name}</strong> from the directory? Existing online classes, saved batch names and attendance history will be preserved.</p>{error ? <p role="alert" className="faculty-toast--error">{error}</p> : null}<div className={styles.actions}><button className="faculty-button faculty-button--ghost" disabled={busy} onClick={close}>Cancel</button><button className={`faculty-button faculty-button--ghost ${styles.deleteBatch}`} disabled={busy} onClick={removeBatch}>{busy ? "Deleting..." : "Confirm Delete"}</button></div></section></Modal> : null}
    {selection ? <Modal onClose={close}><section className={`${styles.modal} ${styles.classModal}`}><header><h2>{selection.action === "edit" ? "Edit Scheduled Class" : selection.action === "delete" ? "Delete Class?" : "Cancel Class?"}</h2><button className="faculty-icon-button" aria-label="Close" disabled={busy} onClick={close}><X size={18} /></button></header><p><strong>{selection.record.topic}</strong> · {selection.record.teacherName}</p>
      {selection.action === "edit" ? <form className={styles.form} onSubmit={saveClass}>
        <ClassDirectoryFields batches={directory} value={classForm} onChange={value => setClassForm(current => ({ ...current, ...value }))} existing loading={directoryLoading} error={directoryError} disabled={busy || directoryLoading || Boolean(directoryError)} />
        <label className="faculty-field"><span>Topic</span><input required maxLength={200} value={classForm.topic} onChange={event => field("topic", event.target.value)} disabled={busy} /></label>
        <label className="faculty-field"><span>Google Meet Link</span><input required type="url" value={classForm.meetUrl} onChange={event => field("meetUrl", event.target.value)} disabled={busy} /></label>
        <ClassDateTimeFields date={classForm.date} startTime={classForm.startTime} disabled={busy} onChange={field} />
        <label className={`faculty-field ${styles.wide}`}><span>Announcement (optional)</span><textarea maxLength={2000} value={classForm.message} onChange={event => field("message", event.target.value)} disabled={busy} /></label>
        {error ? <p role="alert" className={`faculty-toast--error ${styles.wide}`}>{error}</p> : null}<div className={`${styles.actions} ${styles.wide}`}><button type="button" className="faculty-button faculty-button--ghost" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="faculty-button faculty-button--primary" disabled={busy}>{busy ? "Saving..." : "Save Changes"}</button></div>
      </form> : <><p>{selection.action === "delete" ? "Remove this scheduled or cancelled class and reverse its linked unpaid incentive, if any. Live, completed, paid or processing records cannot be deleted here." : "Cancelled classes cannot receive an incentive. Existing evidence is retained."}</p>{error ? <p role="alert" className="faculty-toast--error">{error}</p> : null}<div className={styles.actions}><button className="faculty-button faculty-button--ghost" disabled={busy} onClick={close}>Back</button><button className="faculty-button faculty-button--primary" disabled={busy} onClick={() => saveClass()}>{busy ? "Processing..." : selection.action === "delete" ? "Confirm Delete" : "Confirm Cancellation"}</button></div></>}
    </section></Modal> : null}
    {preview ? <Modal onClose={close}><section className={styles.modal}><h2>Announcement</h2><pre className={styles.preview}>{preview.announcement}</pre><button className="faculty-button faculty-button--ghost" onClick={close}>Close</button></section></Modal> : null}
  </div></main>;
}
