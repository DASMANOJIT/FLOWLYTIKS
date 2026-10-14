"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { apiFetch, readApiResponse } from "../../lib/api.js";
import { getAuthToken } from "../../lib/authStorage.js";
import StudentFollowUpPanel from "./StudentFollowUpPanel";

type Student = { id: number; name: string; class: string; phone: string };
export default function StaffFollowUpsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setStudents([]);
    const timer = setTimeout(() => void (async () => {
      try {
        const query = new URLSearchParams({ search, page: String(page) });
        const path = creating ? "/api/staff/students" : "/api/staff/follow-ups/students";
        const response = await apiFetch(`${path}?${query}`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
        const result = await readApiResponse(response);
        if (!result.ok) throw new Error(result.error);
        if (!controller.signal.aborted) { setStudents(result.data.students); setPages(creating ? result.data.pagination.pages : result.data.pages); }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load follow-ups."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })(), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [creating, search, page, refresh]);
  return <>
    <div className="staff-modal-actions"><button onClick={() => { setCreating(true); setPage(1); setSearch(""); }}><Plus size={17} />New Follow-Up</button><button disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Refresh</button>{creating && <button onClick={() => { setCreating(false); setPage(1); setSearch(""); }}>Back to Follow-Ups</button>}</div>
    {creating && <p>Select a student to add a follow-up.</p>}
    <label className="staff-field">Search students<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Name, ID or contact" /></label>
    {loading && <p role="status">Loading students...</p>}{error && <p role="alert">{error}</p>}
    {!loading && !error && <><div className="staff-table-scroll"><table><thead><tr>{["Student ID", "Name", "Class", "Contact"].map((title) => <th key={title}>{title}</th>)}</tr></thead><tbody>{students.map((student) => <tr key={student.id}><td>{student.id}</td><td><button className="staff-student-name" onClick={() => setSelected(student)}>{student.name}</button></td><td>{student.class}</td><td>{student.phone}</td></tr>)}{!students.length && <tr><td colSpan={4} className="staff-empty">{creating ? "No students found." : "No student follow-ups found."}</td></tr>}</tbody></table></div><div className="staff-pagination"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} of {Math.max(1, pages)}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</button></div></>}
    {selected && <StudentFollowUpPanel key={selected.id} student={selected} onClose={() => setSelected(null)} onSaved={() => { setCreating(false); setPage(1); setRefresh((value) => value + 1); }} />}
  </>;
}
