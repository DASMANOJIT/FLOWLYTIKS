"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import jsPDF from "jspdf";
import { apiCall } from "../../../lib/api.js";
import { getAuthToken } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import "../../admin/faculty/faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type Payroll = {
  id: string;
  weekStart: string;
  weekEnd: string;
  batchNumber: string;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  calculatedAmount: number;
  bonus: number;
  deduction: number;
  netAmount: number;
  paymentStatus: "PENDING" | "PAID";
};
type Profile = { facultyId: string; fullName: string };

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);

export default function FacultyPayrollHistoryPage() {
  const router = useRouter();
  const token = useMemo(() => getAuthToken(), []);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      router.push("/faculty/login");
      return;
    }
    Promise.all([
      callApi<{ payrolls?: Payroll[] }>("/faculty/payroll", "GET", null, token),
      callApi<{ faculty?: Profile }>("/faculty/me", "GET", null, token),
    ])
      .then(([payrollData, profileData]) => {
        setPayrolls(payrollData.payrolls || []);
        setProfile(profileData.faculty || null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load payroll."));
  }, [router, token]);

  const downloadPayslip = (payroll: Payroll) => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Flowlytiks School", 20, 20);
    doc.setFontSize(12);
    doc.text("Faculty Payslip", 20, 30);
    doc.text(`Faculty Name: ${profile?.fullName || "-"}`, 20, 45);
    doc.text(`Faculty ID: ${profile?.facultyId || "-"}`, 20, 55);
    doc.text(`Week Period: ${payroll.weekStart} to ${payroll.weekEnd}`, 20, 65);
    doc.text(`Present Days: ${payroll.presentDays}`, 20, 80);
    doc.text(`Half Days: ${payroll.halfDays}`, 20, 90);
    doc.text(`Absent Days: ${payroll.absentDays}`, 20, 100);
    doc.text(`Calculated Salary: ${money(payroll.calculatedAmount)}`, 20, 115);
    doc.text(`Bonus: ${money(payroll.bonus)}`, 20, 125);
    doc.text(`Deduction: ${money(payroll.deduction)}`, 20, 135);
    doc.text(`Net Pay: ${money(payroll.netAmount)}`, 20, 150);
    doc.text(`Payment Status: ${payroll.paymentStatus}`, 20, 160);
    doc.save(`payslip-${payroll.batchNumber}.pdf`);
  };

  return (
    <FacultyPortalLayout title="Payroll" subtitle="Weekly salary records and payslip downloads.">
      {error ? <div className="faculty-toast--error">{error}</div> : null}
      <section className="faculty-table-card">
        <table className="faculty-table">
          <thead>
            <tr><th>Week</th><th>Present Days</th><th>Calculated Salary</th><th>Bonus</th><th>Deduction</th><th>Net Salary</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {payrolls.length ? payrolls.map((payroll) => (
              <tr key={payroll.id}>
                <td>{payroll.weekStart} to {payroll.weekEnd}</td>
                <td>{payroll.presentDays}</td>
                <td>{money(payroll.calculatedAmount)}</td>
                <td>{money(payroll.bonus)}</td>
                <td>{money(payroll.deduction)}</td>
                <td>{money(payroll.netAmount)}</td>
                <td><span className={`faculty-status faculty-status--${payroll.paymentStatus.toLowerCase()}`}>{payroll.paymentStatus}</span></td>
                <td><button className="faculty-button faculty-button--ghost" onClick={() => downloadPayslip(payroll)}>Download Payslip</button></td>
              </tr>
            )) : <tr><td colSpan={8}>No payroll records found.</td></tr>}
          </tbody>
        </table>
      </section>
    </FacultyPortalLayout>
  );
}
