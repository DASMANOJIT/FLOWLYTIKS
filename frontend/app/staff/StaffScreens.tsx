"use client";

import { useEffect, useState } from "react";
import { Download, Plus } from "lucide-react";
import { apiFetch, readApiResponse } from "../../lib/api.js";
import { getAuthToken } from "../../lib/authStorage.js";
import StudentFollowUpPanel from "./StudentFollowUpPanel";
import StaffFollowUpsPage from "./StaffFollowUpsPage";
import StaffPaymentPanel from "./StaffPaymentPanel";

export const staffPages = ["dashboard", "students", "cash-payments", "follow-ups", "admission-enquiries", "profile"];
export const titles: Record<string, string> = { dashboard: "Dashboard", students: "Students", "cash-payments": "Cash Payments", "follow-ups": "Follow-Ups", "admission-enquiries": "Admission Enquiries", profile: "My Profile" };
const callStatuses = ["Call Pending", "Contacted", "No Answer", "Promised to Pay", "Follow-Up Completed"];

function Field({ label, type = "text", options }: { label: string; type?: string; options?: string[] }) {
  return <label className="staff-field"><span>{label}</span>{options ? <select defaultValue=""><option value="">Select {label.toLowerCase()}</option>{options.map((option) => <option key={option}>{option}</option>)}</select> : <input type={type} />}</label>;
}

export function EmptyTable({ columns, message }: { columns: string[]; message: string }) {
  return <div className="staff-table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody><tr><td colSpan={columns.length} className="staff-empty">{message}</td></tr></tbody></table></div>;
}

export function StaffFilters({ admin = false }: { admin?: boolean }) {
  return <div className="staff-fields">{admin ? <><Field label="Staff" options={[]} /><Field label="From date" type="date" /><Field label="To date" type="date" /><Field label="Status" options={callStatuses} /></> : <><Field label="Search students" /><Field label="Class" options={[]} /><Field label="Batch" options={[]} /><Field label="Session" options={[]} /><Field label="Fee month" options={["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]} /><Field label="Payment status" options={["Paid", "Unpaid"]} /></>}</div>;
}

type Student = { id: number; name: string; class: string; phone: string; school: string; monthlyFee: number; paymentStatus: string };
type StudentData = { month: string; academicYear: number; summary: { totalStudents: number; paidStudents: number; unpaidStudents: number }; students: Student[]; classes: string[]; pagination: { page: number; pages: number; total: number } };
type Profile = { id: string; name: string; email: string; role: string; isActive: boolean; verifiedAt?: string; createdAt: string };
type Activity = { id: string; action: string; createdAt: string };
const months = ["March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February"];

export default function StaffScreens({ section }: { section: string }) {
  const [data, setData] = useState<StudentData | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [activityError, setActivityError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [filters, setFilters] = useState({ search: "", class: "", month: "", academicYear: "", status: "all", page: 1 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [noteStudent, setNoteStudent] = useState<Student | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const downloadStudents = async () => {
    if (exportBusy || !data) return;
    setExportBusy(true); setExportError("");
    try {
      const query = new URLSearchParams({ search: filters.search, class: filters.class, month: filters.month || data.month, academicYear: filters.academicYear || String(data.academicYear), status: filters.status });
      const response = await apiFetch(`/api/staff/students/export?${query}`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store" });
      const result = await readApiResponse(response);
      if (!result.ok) throw new Error(result.error);
      const { buildStaffStudentsPdf } = await import("../../lib/staffStudentsPdf.js");
      (await buildStaffStudentsPdf(result.data)).save("staff-students.pdf");
    } catch (error) { setExportError(error instanceof Error ? error.message : "Unable to generate PDF."); }
    finally { setExportBusy(false); }
  };
  const usesStudents = ["dashboard", "students", "cash-payments"].includes(section);
  useEffect(() => {
    if (!usesStudents && section !== "profile") return;
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null); setProfile(null);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== "") query.set(key, String(value));
    const load = async () => {
      try {
        const response = await apiFetch(section === "profile" ? "/api/staff/me" : `/api/staff/students?${query}`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
        const result = await readApiResponse(response);
        if (!result.ok) throw new Error(result.error);
        if (!controller.signal.aborted) { if (section === "profile") setProfile(result.data.staff); else setData(result.data); }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load records."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    const timer = setTimeout(() => void load(), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [section, filters, refresh, usesStudents]);
  useEffect(() => {
    if (section !== "dashboard") return;
    const controller = new AbortController();
    setActivityError(""); setActivity(null);
    void (async () => {
      try {
        const response = await apiFetch("/api/staff/activity", { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
        const result = await readApiResponse(response);
        if (!result.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setActivity(result.data.activity);
      } catch (error) { if (!controller.signal.aborted) setActivityError(error instanceof Error ? error.message : "Unable to load activity."); }
    })();
    return () => controller.abort();
  }, [section, refresh]);
  const update = (key: string, value: string) => { setSelectedId(null); setFilters((current) => ({ ...current, [key]: value, page: 1 })); };
  const selected = data?.students.find((student) => student.id === selectedId);
  const studentTable = <div className="staff-table-scroll"><table><thead><tr>{["Student ID", "Name", "Class", "Batch", "Contact", "Payment Status", ...(section === "cash-payments" ? ["Action"] : [])].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{data?.students.map((student) => <tr key={student.id}><td>{student.id}</td><td>{section === "students" ? <button className="staff-student-name" onClick={() => setNoteStudent(student)}>{student.name}</button> : student.name}</td><td>{student.class}</td><td>—</td><td>{student.phone}</td><td><span className={`staff-status staff-status--${student.paymentStatus.toLowerCase()}`}>{student.paymentStatus}</span></td>{section === "cash-payments" && <td>{student.paymentStatus === "Unpaid" ? <button onClick={() => { setPaymentSuccess(""); setSelectedId(student.id); }}>Pay</button> : "—"}</td>}</tr>)}{data && !data.students.length && <tr><td colSpan={section === "cash-payments" ? 7 : 6} className="staff-empty">No students found.</td></tr>}</tbody></table></div>;
  if (usesStudents || section === "profile") return <>
    {noteStudent && <StudentFollowUpPanel student={noteStudent} onClose={() => setNoteStudent(null)} />}
    {section === "cash-payments" && selected && data && <StaffPaymentPanel studentId={selected.id} month={data.month} academicYear={data.academicYear} onClose={() => setSelectedId(null)} onPaid={(message) => { setPaymentSuccess(message); setSelectedId(null); setRefresh((current) => current + 1); }} />}
    {section === "cash-payments" && paymentSuccess && <p role="status">{paymentSuccess}</p>}
    <button onClick={() => setRefresh((current) => current + 1)} disabled={loading}>Refresh</button>
    {section === "students" && <><button disabled={exportBusy || loading || !data} onClick={() => void downloadStudents()}><Download size={17} />{exportBusy ? "Generating..." : "Download PDF"}</button>{exportError && <p role="alert">{exportError}</p>}</>}
    {usesStudents && <div className="staff-fields">
      <label className="staff-field">Search students<input value={filters.search} onChange={(event) => update("search", event.target.value)} placeholder="Name, ID or contact" /></label>
      <label className="staff-field">Class<select value={filters.class} onChange={(event) => update("class", event.target.value)}><option value="">All classes</option>{data?.classes.map((value) => <option key={value}>{value}</option>)}{filters.class && !data && <option>{filters.class}</option>}</select></label>
      <label className="staff-field">Fee month<select value={filters.month || data?.month || ""} onChange={(event) => update("month", event.target.value)}><option value="">Current month</option>{months.map((month) => <option key={month}>{month}</option>)}</select></label>
      <label className="staff-field">Academic session<input type="number" min="2000" max="3000" value={filters.academicYear || data?.academicYear || ""} onChange={(event) => update("academicYear", event.target.value)} placeholder="Starting year" /></label>
      <label className="staff-field">Payment status<select value={filters.status} onChange={(event) => update("status", event.target.value)}>{["all", "paid", "unpaid"].map((status) => <option key={status} value={status}>{status === "all" ? "All statuses" : status === "paid" ? "Paid" : "Unpaid"}</option>)}</select></label>
      <label className="staff-field">Batch<select disabled><option>Not available</option></select></label>
    </div>}
    {loading && <p role="status">Loading records...</p>}{error && <p role="alert">{error}</p>}
    {data && <p className="staff-period">{data.month} · {data.academicYear}–{data.academicYear + 1}</p>}
    {data && section === "dashboard" && <><div className="staff-stats">{[["Total Students", data.summary.totalStudents], ["Paid Students", data.summary.paidStudents], ["Unpaid Students", data.summary.unpaidStudents], ["Pending Follow-Ups", "—"]].map(([label, value]) => <article key={label}><h2>{label}</h2><strong>{value}</strong></article>)}</div><section><h2>Upcoming Follow-Ups</h2><p>Follow-up records are unavailable: no saved Staff follow-up data source exists.</p></section><section><h2>Recent Activity</h2>{activityError ? <p role="alert">{activityError}</p> : activity === null ? <p role="status">Loading activity...</p> : activity.length ? <ul>{activity.map((item) => <li key={item.id}>{item.action.replaceAll("_", " ")} · {new Date(item.createdAt).toLocaleString()}</li>)}</ul> : <p>No activity found for your Staff account.</p>}</section></>}
    {data && section !== "dashboard" && <>{studentTable}<div className="staff-pagination"><button disabled={filters.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Previous</button><span>Page {data.pagination.page} of {Math.max(1, data.pagination.pages)} · {data.pagination.total} students</span><button disabled={filters.page >= data.pagination.pages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Next</button></div></>}
    {profile && <section className="staff-profile-card"><header className="staff-profile-header"><span className="staff-profile-avatar" aria-hidden="true">{profile.name.trim().split(/\s+/).filter(Boolean).map(word => word[0]).filter((_, index, words) => index === 0 || index === words.length - 1).join("").toUpperCase() || "S"}</span><div><h2>{profile.name}</h2><p>{profile.role} · Staff Portal</p><div className="staff-profile-badges"><span className={`staff-status ${profile.isActive ? "staff-status--paid" : "staff-status--unpaid"}`}>{profile.isActive ? "Active" : "Inactive"}</span>{profile.verifiedAt && <span className="staff-profile-verified">Verified</span>}</div></div></header><dl className="staff-profile-details">{[["Staff ID", profile.id], ["Name", profile.name], ["Email", profile.email], ["Role", profile.role], ["Status", `${profile.isActive ? "Active" : "Inactive"} · ${profile.verifiedAt ? "Verified" : "Not verified"}`], ["Created Date", new Date(profile.createdAt).toLocaleString()]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>}
  </>;
  if (section === "follow-ups") return <StaffFollowUpsPage />;
  return <UnavailableScreens section={section} />;
}

function UnavailableScreens({ section }: { section: string }) {
  const [formOpen, setFormOpen] = useState(false);
  const enquiry = section === "admission-enquiries";
  return <>
    <p className="staff-notice" role="status">Saved records are unavailable: this module has no implemented database data source.</p>
    {enquiry && <><button disabled><Download size={17} /> Download PDF</button><p>Enquiry PDF export is unavailable until enquiry persistence is connected.</p></>}
    {section === "dashboard" && <><div className="staff-stats">{["Total Students", "Paid Students", "Unpaid Students", "Pending Follow-Ups"].map((title) => <article key={title}><h2>{title}</h2><strong>—</strong></article>)}</div><section><h2>Upcoming Follow-Ups</h2><p className="staff-empty">No follow-ups available.</p></section><section><h2>Recent Activity</h2><p className="staff-empty">No activity available.</p></section></>}
    {section === "students" && <><StaffFilters /><EmptyTable columns={["Student ID", "Name", "Class", "Batch", "Guardian Contact", "Payment Status"]} message="No student records available." /></>}
    {(section === "follow-ups" || enquiry) && <><button onClick={() => setFormOpen(!formOpen)} aria-expanded={formOpen}><Plus size={17} />{formOpen ? "Close Form" : enquiry ? "New Enquiry" : "New Follow-Up"}</button>{formOpen && <form className={enquiry ? "staff-enquiry-card" : undefined} onSubmit={(event) => event.preventDefault()}><div className="staff-fields"><Field label={enquiry ? "Student name" : "Student / contact"} />{enquiry && <><Field label="Guardian name" /><Field label="Desired class / batch" /></>}<Field label="Phone" type="tel" /><Field label={enquiry ? "Status" : "Call status"} options={enquiry ? ["New", "Contacted", "Interested", "Admitted", "Closed"] : callStatuses} /><Field label="Remarks" />{!enquiry && <Field label="Expected payment date" type="date" />}<Field label="Next follow-up date" type="date" /></div><button disabled>Save</button><p>Saving is not connected yet.</p></form>}<EmptyTable columns={enquiry ? ["Student", "Guardian", "Phone", "Desired Class / Batch", "Remarks", "Status", "Next Follow-Up"] : ["Student / Contact", "Call Status", "Remarks", "Expected Payment", "Next Follow-Up"]} message={enquiry ? "No admission enquiries available." : "No follow-ups available."} /></>}
    {section === "profile" && <section><h2>Staff Information</h2><dl>{["Staff ID", "Name", "Email", "Phone", "Role", "Status"].map((label) => <div key={label}><dt>{label}</dt><dd>—</dd></div>)}</dl></section>}
  </>;
}
