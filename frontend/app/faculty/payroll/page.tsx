"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../../../lib/api.js";
import { getFacultyAuthToken } from "../../../lib/authStorage.js";
import { downloadFacultyPayslipPdf } from "../../../lib/facultyPayslipPdf.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
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
type Profile = { facultyId: string; fullName: string; email?: string | null; phone?: string | null };

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);

export default function FacultyPayrollHistoryPage() {
  const router = useRouter();
  const token = useMemo(() => getFacultyAuthToken(), []);
  const [payrolls, setPayrolls] = useState<Payroll[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      router.push("/login");
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
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load payroll."))
      .finally(() => setLoading(false));
  }, [router, token]);

  const downloadPayslip = (payroll: Payroll) => {
    void downloadFacultyPayslipPdf({ profile, payroll }).catch(() => {
      alert("Failed to generate the payslip PDF.");
    });
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
            {loading ? (
              <tr><td colSpan={8}><PremiumLoader label="Loading payroll" compact /></td></tr>
            ) : payrolls.length ? payrolls.map((payroll) => (
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
