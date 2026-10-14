"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import BackToDashboard from "../../components/admin/BackToDashboard";
import { useRouter } from "next/navigation";
import { Users, Phone, ClipboardList, WalletCards, RefreshCw } from "lucide-react";
import { getAuthToken, getAuthRole } from "../../../lib/authStorage.js";
import { apiFetch, readApiResponse } from "../../../lib/api.js";
import StaffMembers, { Staff } from "./StaffMembers";
import OverviewDetails from "./OverviewDetails";
import StudentTimeline from "../../students/[id]/StaffFollowUps";
import styles from "./staffOverview.module.css";

const tabs = [{ name: "Staff Members", path: "members", Icon: Users }, { name: "Follow-Ups", path: "follow-ups", Icon: Phone }, { name: "Admission Enquiries", path: "enquiries", Icon: ClipboardList }, { name: "Cash Collections", path: "cash-collections", Icon: WalletCards }];
type Student = { id: number; name: string; class?: string; phone?: string };
type FollowUp = { id: string; note: string; createdAt: string; staff: { id: string; name: string }; student: Student };
type Event = { id: string; staffId: string | null; staffName: string | null; studentId: number | null; studentName: string | null; recordedStudentId?: string; contact?: string; month?: string; academicYear?: string; amount?: string; reference?: string; paidAt?: string; createdAt: string; status?: string; action?: string; entityType?: string; entityId?: string; paymentId?: string; note?: string };
type Data = { rows: (Staff | FollowUp | Event)[]; pagination?: { page: number; pages: number; total: number }; available?: boolean; message?: string };
type Filters = { search: string; staffId: string; from: string; to: string; status: string; action: string; page: number };
const defaults: Filters = { search: "", staffId: "", from: "", to: "", status: "all", action: "", page: 1 };
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not available";
const cashStatuses: Record<string, string> = { paid: "Paid", reversed: "Reversed", removed: "Record removed", changed: "Payment method changed", "not-paid": "Not paid", superseded: "Payment recorded again" };
const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};
const hasAdminSession = () => Boolean(getAuthToken() && getAuthRole() === "admin");
export default function AdminStaffPage() {
  const [tab, setTab] = useState("members");
  const [filters, setFilters] = useState<Filters>(defaults);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<{ id: string; name: string }[]>([]);
  const [optionsError, setOptionsError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [detail, setDetail] = useState<FollowUp | Event | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const allowed = useSyncExternalStore(subscribe, hasAdminSession, () => false);
  const router = useRouter();
  useEffect(() => {
    if (!hasAdminSession()) router.replace("/login");
  }, [router, allowed]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setOptionsError("");
    void (async () => {
      try {
        const response = await apiFetch("/api/staff/admin/options", { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
        const result = await readApiResponse(response);
        if (!result.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setOptions(result.data.staff);
      } catch (error) { if (!controller.signal.aborted) setOptionsError(error instanceof Error ? error.message : "Staff filters could not load."); }
    })();
    return () => controller.abort();
  }, [allowed, refresh]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    const timer = setTimeout(() => void (async () => {
      try {
        const query = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]));
        const response = await apiFetch(`/api/staff/admin/${tab}?${query}`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
        const result = await readApiResponse(response);
        if (!result.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setData(result.data);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Staff overview could not load."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })(), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [allowed, tab, filters, refresh]);
  const switchTab = (next: string, staffId = filters.staffId) => { setTab(next); setFilters({ ...defaults, staffId }); setData(null); setError(""); setLoading(true); };
  const update = (key: keyof Filters, value: string) => {
    if (key === "staffId" && value !== selectedStaff?.id) setSelectedStaff(null);
    setFilters(current => ({ ...current, [key]: value, page: 1 }));
  };
  const openStudent = (id: number | null, name: string | null) => { if (id) setStudent({ id, name: name || `Student ${id}` }); };
  const active = tabs.find(item => item.path === tab)!;
  const statuses = tab === "members" ? { active: "Active", inactive: "Inactive" } : tab === "cash-collections" ? cashStatuses : {};
  if (!allowed) return null;
  return <main className={styles.page}><div className={styles.root}>
    <header className={styles.header}><div><BackToDashboard /><h1>Staff</h1><p>Staff members and recorded activity</p></div><button disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={17} />Refresh</button></header>
    <div className={styles.tabs} role="tablist" aria-label="Staff sections">{tabs.map(({ name, path, Icon }) => <button role="tab" id={`staff-tab-${path}`} aria-controls="staff-overview-panel" aria-selected={tab === path} key={path} onClick={() => switchTab(path)}><Icon size={17} />{name}</button>)}</div>
    {selectedStaff && <OverviewDetails title="Staff Details" onClose={() => setSelectedStaff(null)}><section className={`${styles.profile} ${styles.modalProfile}`} aria-label="Selected staff details"><header><span className={styles.avatar} aria-hidden="true">{selectedStaff.name.split(/\s+/).filter(Boolean).map(word => word[0]).slice(0, 2).join("").toUpperCase()}</span><div><h3>{selectedStaff.name}</h3><span className={`${styles.badge} ${selectedStaff.isActive ? styles.paid : ""}`}>{selectedStaff.isActive ? "Active" : "Inactive"}</span>{selectedStaff.verifiedAt && <span className={styles.badge}>Verified</span>}</div></header><dl className={styles.details}>{[["Staff ID", selectedStaff.id], ["Email", selectedStaff.email], ["Role", selectedStaff.role || "STAFF"], ["Created", date(selectedStaff.createdAt)], ["Verified", date(selectedStaff.verifiedAt)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className={styles.toolbar}><button onClick={() => { switchTab("follow-ups", selectedStaff.id); setSelectedStaff(null); }}>View Follow-Ups</button><button onClick={() => { switchTab("cash-collections", selectedStaff.id); setSelectedStaff(null); }}>View Cash Collections</button></div></section></OverviewDetails>}
    <section id="staff-overview-panel" className={styles.panel} role="tabpanel" aria-labelledby={`staff-tab-${tab}`}><h2>{active.name}</h2>
      <div className={styles.filters}><label>Search<input value={filters.search} onChange={event => update("search", event.target.value)} placeholder={tab === "members" ? "Name, email or Staff ID" : "Student, staff or recorded details"} disabled={tab === "enquiries"} /></label><label>Staff<select value={filters.staffId} onChange={event => update("staffId", event.target.value)} disabled={tab === "enquiries"}><option value="">All staff</option>{options.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label>From date<input type="date" value={filters.from} onChange={event => update("from", event.target.value)} disabled={tab === "enquiries"} /></label><label>To date<input type="date" value={filters.to} onChange={event => update("to", event.target.value)} disabled={tab === "enquiries"} /></label><label>Status<select value={filters.status} onChange={event => update("status", event.target.value)} disabled={!Object.keys(statuses).length}><option value="all">{Object.keys(statuses).length ? "All statuses" : "Not recorded"}</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {optionsError && <p className={styles.error} role="alert">Staff filter: {optionsError}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
      {tab === "members" ? <StaffMembers overview={{ members: (data?.rows || []) as Staff[], loading, error }} onSelect={member => setSelectedStaff(member)} onCreated={() => { setSelectedStaff(null); setFilters(defaults); setRefresh(value => value + 1); }} /> : loading ? <p role="status">Loading {active.name.toLowerCase()}...</p> : data?.available === false ? <p className={styles.notice} role="status">{data.message}</p> : data && <>
        {tab === "follow-ups" && <p className={styles.notice}>Call status, expected payment date and next follow-up date are not stored as separate fields. Recorded remarks are shown unchanged.</p>}
        <div className={styles.tableScroll}><table><thead><tr>{(tab === "follow-ups" ? ["Student", "Authoring Staff", "Remarks", "Call Status", "Expected Payment", "Next Follow-Up", "Recorded"] : tab === "cash-collections" ? ["Student", "Staff Collector", "Fee Period", "Amount", "Reference", "Payment Date", "Current Status", "Recorded"] : ["Staff", "Action", "Related Record", "Details", "Recorded"]).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
          {data.rows.map(item => tab === "follow-ups" ? (() => { const row = item as FollowUp; return <tr key={row.id}><td><button className={styles.link} onClick={() => setStudent(row.student)}>{row.student.name}</button><small>ID {row.student.id} · Class {row.student.class}<br />{row.student.phone}</small></td><td>{row.staff.name}<small>{row.staff.id}</small></td><td><p className={styles.remarks}>{row.note}</p><button className={styles.link} onClick={() => setDetail(row)}>View full details</button></td><td>Not recorded</td><td>Not recorded</td><td>Not recorded</td><td>{date(row.createdAt)}</td></tr>; })() : (() => { const row = item as Event; return tab === "cash-collections" ? <tr key={row.id}><td>{row.studentId ? <button className={styles.link} onClick={() => openStudent(row.studentId, row.studentName)}>{row.studentName}</button> : "Student unavailable"}<small>ID {row.studentId || row.recordedStudentId || "Not available"}<br />{row.contact}</small></td><td>{row.staffName || "Name unavailable"}<small>{row.staffId || "Staff ID not recorded"}</small></td><td>{row.month || "Not available"}<small>{row.academicYear ? `${row.academicYear}-${Number(row.academicYear) + 1}` : "Session unavailable"}</small></td><td>{row.amount !== null && row.amount !== undefined ? `₹${row.amount}` : "Not available"}</td><td>{row.reference || "Not available"}<small>Payment ID {row.paymentId}</small></td><td>{date(row.paidAt)}</td><td><span className={`${styles.badge} ${row.status === "paid" ? styles.paid : ""}`}>{cashStatuses[row.status || ""] || "Not available"}</span></td><td>{date(row.createdAt)}</td></tr> : <tr key={row.id}><td>{row.staffName || "Name unavailable"}<small>{row.staffId || "Staff ID not recorded"}</small></td><td>{row.action?.replaceAll("_", " ")}</td><td>{row.studentId ? <button className={styles.link} onClick={() => openStudent(row.studentId, row.studentName)}>{row.studentName} · {row.studentId}</button> : `${row.entityType || "Record"} ${row.entityId || ""}`}</td><td><p className={styles.remarks}>{row.note || [row.month, row.academicYear && `${row.academicYear}-${Number(row.academicYear) + 1}`, row.amount != null && `₹${row.amount}`, row.reference].filter(Boolean).join(" · ") || "No additional details recorded"}</p><button className={styles.link} onClick={() => setDetail(row)}>View full details</button></td><td>{date(row.createdAt)}</td></tr>; })())}
          {!data.rows.length && <tr><td colSpan={tab === "activity" ? 5 : tab === "follow-ups" ? 7 : 8} className={styles.empty}>No {active.name.toLowerCase()} found.</td></tr>}
        </tbody></table></div>
      </>}
      {data?.pagination && !loading && <div className={styles.pagination}><span>{data.pagination.total} records · Page {data.pagination.page} of {Math.max(1, data.pagination.pages)}</span><button disabled={filters.page <= 1} onClick={() => setFilters(current => ({ ...current, page: current.page - 1 }))}>Previous</button><button disabled={filters.page >= data.pagination.pages} onClick={() => setFilters(current => ({ ...current, page: current.page + 1 }))}>Next</button></div>}
    </section>
    {student && <OverviewDetails title={`${student.name} · Student ${student.id}`} onClose={() => setStudent(null)}><StudentTimeline studentId={student.id} /></OverviewDetails>}
    {detail && <OverviewDetails title="Recorded Staff Activity" onClose={() => setDetail(null)}><dl className={styles.details}><div><dt>Staff</dt><dd>{"staff" in detail ? detail.staff.name : detail.staffName || "Name unavailable"}</dd></div><div><dt>Recorded</dt><dd>{date(detail.createdAt)}</dd></div><div><dt>Student / Related Record</dt><dd>{"student" in detail ? `${detail.student.name} · ${detail.student.id}` : `${detail.studentName || detail.entityType || "Record"} · ${detail.studentId || detail.entityId || "Not recorded"}`}</dd></div>{"staff" in detail && <><div><dt>Call status</dt><dd>Not recorded</dd></div><div><dt>Expected payment date</dt><dd>Not recorded</dd></div><div><dt>Next follow-up</dt><dd>Not recorded</dd></div></>}</dl><p className={styles.fullNote}>{detail.note || ("staff" in detail ? "" : [detail.month, detail.academicYear, detail.amount != null && `₹${detail.amount}`, detail.reference].filter(Boolean).join(" · "))}</p></OverviewDetails>}
  </div></main>;
}
