"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { useModalDialog } from "../components/ui/Modal";
import { apiFetch, readApiResponse } from "../../lib/api.js";
import { getAuthToken } from "../../lib/authStorage.js";

type Info = { student: { id: number; name: string; class: string; phone: string }; amount: number; month: string; academicYear: number; paymentStatus: string; onlineVerificationAvailable: boolean; onlineMessage: string };
export default function StaffPaymentPanel({ studentId, month, academicYear, onClose, onPaid }: { studentId: number; month: string; academicYear: number; onClose: () => void; onPaid: (message: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useModalDialog(dialog);
  const submitting = useRef(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("cash");
  const [received, setReceived] = useState(false);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await apiFetch(`/api/staff/students/${studentId}/payment?${new URLSearchParams({ month, academicYear: String(academicYear) })}`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
        const result = await readApiResponse(response);
        if (!result.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setInfo(result.data);
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load payment details."); }
    })();
    return () => { controller.abort(); };
  }, [studentId, month, academicYear]);
  const payCash = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || !received || !info || info.paymentStatus === "Paid") return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/staff/students/${studentId}/pay-cash`, { method: "POST", headers: { Authorization: `Bearer ${getAuthToken()}` }, body: JSON.stringify({ month, academicYear, cashReceived: true }) });
      const result = await readApiResponse(response);
      if (!result.ok) throw new Error(result.error);
      onPaid(result.data.message);
    } catch (error) { setError(error instanceof Error ? error.message : "Payment could not be recorded. Please refresh its status before retrying."); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="staff-note-dialog staff-payment-dialog" aria-labelledby="staff-payment-title" onCancel={(event) => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <header><h2 id="staff-payment-title">Fee Payment</h2><button aria-label="Close payment" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    {error && <p role="alert">{error}</p>}
    {!info && !error && <p role="status">Loading payment details...</p>}
    {info && <><dl className="staff-payment-details">{[["Student", `${info.student.name} · ${info.student.id}`], ["Class / Batch", `${info.student.class} / Not available`], ["Contact", info.student.phone], ["Fee period", `${info.month} · ${info.academicYear}–${info.academicYear + 1}`], ["Status", info.paymentStatus], ["Applicable fee", `₹${info.amount}`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="staff-tabs" role="tablist" aria-label="Payment method">{["cash", "online"].map((value) => <button key={value} role="tab" aria-selected={mode === value} disabled={busy} onClick={() => setMode(value)}>{value === "cash" ? "Cash" : "Online"}</button>)}</div>
      {mode === "cash" ? <form onSubmit={payCash}><p>Record ₹{info.amount} as received cash for this fee period.</p><label className="staff-cash-confirm"><input type="checkbox" checked={received} disabled={busy || info.paymentStatus === "Paid"} onChange={(event) => setReceived(event.target.checked)} />I confirm that the full cash amount has been received.</label><div className="staff-modal-actions"><button type="submit" disabled={busy || !received || info.paymentStatus === "Paid"}>{busy ? "Recording..." : "Pay"}</button></div></form> : <div className="staff-online-payment"><Image unoptimized src={process.env.NEXT_PUBLIC_MANUAL_UPI_QR_PATH || "/fees-payment.jpg"} alt="Institute payment QR" width={260} height={260} /><label className="staff-field">UTR / Transaction ID<input value={utr} onChange={(event) => setUtr(event.target.value)} maxLength={35} /></label><p role="status">{info.onlineMessage}</p><button disabled>Pay</button></div>}
    </>}
  </dialog>;
}
