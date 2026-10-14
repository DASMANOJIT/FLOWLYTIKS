"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useModalDialog } from "../../components/ui/Modal";
import { apiCall } from "../../../lib/api.js";
import { getAuthToken } from "../../../lib/authStorage.js";

export type Staff = { id: string; name: string; email: string; role?: string; isActive: boolean; verifiedAt?: string; createdAt: string };
const callApi = apiCall as <T>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
export default function StaffMembers({ overview, onSelect, onCreated }: { overview?: { members: Staff[]; loading: boolean; error: string }; onSelect?: (staff: Staff) => void; onCreated?: () => void } = {}) {
  const [members, setMembers] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [requestId, setRequestId] = useState("");
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const load = useCallback(async () => {
    try { const data = await callApi<{ staff: Staff[] }>("/staff/members", "GET", null, getAuthToken()); setMembers(data.staff || []); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to load staff members."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (!overview) void load(); }, [load, overview]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  useModalDialog(dialog, open);
  const close = () => { if (!busy) { setOpen(false); setForm({ name: "", email: "", password: "", confirmPassword: "" }); setRequestId(""); setCode(""); setError(""); } };
  const send = async (resend = false) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      const data = await callApi<{ requestId: string; cooldown: number }>(resend ? "/staff/creation/resend-code" : "/staff/creation/send-code", "POST", resend ? { requestId } : form, getAuthToken());
      setRequestId(data.requestId); setCooldown(data.cooldown || 15); setCode("");
      setForm((current) => ({ ...current, password: "", confirmPassword: "" }));
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to send verification code."); }
    finally { submitting.current = false; setBusy(false); }
  };
  const verify = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError("");
    try {
      const data = await callApi<{ staff: Staff; message: string }>("/staff/creation/verify", "POST", { requestId, code }, getAuthToken());
      setMembers((current) => [data.staff, ...current.filter((member) => member.id !== data.staff.id)]);
      onCreated?.();
      setSuccess(data.message); setOpen(false); setRequestId(""); setCode(""); setForm({ name: "", email: "", password: "", confirmPassword: "" });
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to verify code."); }
    finally { submitting.current = false; setBusy(false); }
  };
  const displayed = overview?.members ?? members;
  const listLoading = overview?.loading ?? loading;
  const listError = overview?.error || error;
  return <>
    <button onClick={() => { setError(""); setSuccess(""); setOpen(true); }}><Plus size={17} /> Create Staff Account</button>
    {success && <p role="status">{success}</p>}{error && !open && <p role="alert">{error}</p>}
    <div className="staff-table-scroll"><table><thead><tr>{["Staff", "Staff ID", "Email", "Role", "Status", "Created At"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{displayed.map((member) => <tr key={member.id}><td>{onSelect ? <button className="staff-name-link" onClick={() => onSelect(member)}>{member.name}</button> : member.name}</td><td>{member.id}</td><td>{member.email}</td><td>{member.role || "STAFF"}</td><td><span className={`staff-overview-badge ${member.isActive ? "staff-overview-badge--active" : ""}`}>{member.isActive ? "Active" : "Inactive"}</span>{member.verifiedAt && <span className="staff-overview-badge staff-overview-badge--verified">Verified</span>}</td><td>{new Date(member.createdAt).toLocaleString()}</td></tr>)}{!displayed.length && <tr><td colSpan={6} className="staff-empty">{listLoading ? "Loading staff members..." : listError ? "Staff members could not be loaded." : "No staff members found."}</td></tr>}</tbody></table></div>
    {open && <dialog ref={dialog} className="staff-create-modal" aria-labelledby="staff-create-title" onCancel={(event) => { event.preventDefault(); close(); }}><header><h2 id="staff-create-title">{requestId ? "Verify Staff Email" : "Create Staff Account"}</h2><button onClick={close} disabled={busy} aria-label="Close"><X size={20} /></button></header><form onSubmit={(event) => { event.preventDefault(); if (!busy) void (requestId ? verify() : send()); }}>
      {requestId ? <><p>Enter the verification code sent to {form.email}. It expires in 5 minutes.</p><label className="staff-field">Verification Code<input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} /></label></> : <><div className="staff-fields">{(["name", "email", "password", "confirmPassword"] as const).map((key) => <label className="staff-field" key={key}>{({ name: "Staff Name", email: "Email", password: "Password", confirmPassword: "Confirm Password" })[key]}<input required type={key === "email" ? "email" : key.includes("assword") ? "password" : "text"} maxLength={key.includes("assword") ? 72 : key === "name" ? 120 : 254} autoComplete={key.includes("assword") ? "new-password" : "off"} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}</div><p>Password: 8–72 characters with uppercase, lowercase, number and special character.</p></>}
      {error && <p role="alert">{error}</p>}<div className="staff-modal-actions"><button type="submit" disabled={busy}>{busy ? "Please wait..." : requestId ? "Verify & Create Account" : "Send Verification Code"}</button>{requestId && <><button type="button" disabled={busy || cooldown > 0} onClick={() => void send(true)}>{cooldown ? `Resend Code (${cooldown}s)` : "Resend Code"}</button><button type="button" disabled={busy} onClick={() => { setRequestId(""); setCode(""); setError(""); }}>Back</button></>}<button type="button" onClick={close} disabled={busy}>Cancel</button></div>
    </form></dialog>}
  </>;
}
