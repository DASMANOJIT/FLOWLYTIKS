"use client";

import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../../../lib/api.js";
import { getFacultyAuthToken } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import "../../admin/faculty/faculty.css";

type ApiCall = <T = unknown>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
const callApi = apiCall as ApiCall;

type FacultyProfile = {
  facultyId: string;
  username: string;
  fullName: string;
  phone: string;
  email: string | null;
  gender: string | null;
  dob: string | null;
  address: string | null;
  designation: string | null;
  qualification: string | null;
  experienceYears: number | null;
  joiningDate: string;
  employmentType: string | null;
  salaryType?: string | null;
  status: string;
  profilePictureUrl: string | null;
};

type BankAccount = {
  payoutMode?: string | null;
  upiId?: string | null;
  accountHolderName?: string | null;
  accountNumber?: string | null;
  maskedBankAccountNumber?: string | null;
  bankName?: string | null;
  ifscCode?: string | null;
  branchName?: string | null;
  payoutContactPhone?: string | null;
  payoutContactEmail?: string | null;
  verificationStatus?: string | null;
  payoutEligible?: boolean;
};

export default function FacultyOwnProfilePage() {
  const router = useRouter();
  const token = useMemo(() => getFacultyAuthToken(), []);
  const [profile, setProfile] = useState<FacultyProfile | null>(null);
  const [payoutForm, setPayoutForm] = useState({
    payoutMode: "NONE",
    upiId: "",
    accountHolderName: "",
    accountNumber: "",
    bankName: "",
    ifscCode: "",
    branchName: "",
    payoutContactPhone: "",
    payoutContactEmail: "",
  });
  const [bankAccount, setBankAccount] = useState<BankAccount | null>(null);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [savingPayout, setSavingPayout] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
  const [resetForm, setResetForm] = useState({ email: "", otp: "", newPassword: "", confirmPassword: "" });
  const [resetOtpSent, setResetOtpSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      router.push("/login");
      return;
    }
    callApi<{ faculty?: FacultyProfile }>("/faculty/me", "GET", null, token)
      .then((data) => {
        const faculty = data.faculty || null;
        setProfile(faculty);
        setResetForm((current) => ({ ...current, email: faculty?.email || "" }));
      })
      .catch(() => router.push("/login"));
    callApi<{ bankAccount?: BankAccount }>("/faculty/bank-accounts/me", "GET", null, token)
      .then((data) => {
        const account = data.bankAccount || null;
        setBankAccount(account);
        setPayoutForm({
          payoutMode: account?.payoutMode || "NONE",
          upiId: account?.upiId || "",
          accountHolderName: account?.accountHolderName || "",
          accountNumber: account?.accountNumber || "",
          bankName: account?.bankName || "",
          ifscCode: account?.ifscCode || "",
          branchName: account?.branchName || "",
          payoutContactPhone: account?.payoutContactPhone || "",
          payoutContactEmail: account?.payoutContactEmail || "",
        });
      })
      .catch(() => setBankAccount(null));
  }, [router, token]);

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    try {
      const data = await callApi<{ message?: string }>("/faculty/me/password", "PATCH", passwordForm, token);
      setMessage(data.message || "Password changed successfully.");
      setPasswordForm({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to change password.");
    }
  };

  const sendResetOtp = async () => {
    setMessage("");
    setResetLoading(true);
    try {
      const data = await callApi<{ message?: string }>("/faculty/auth/forgot-password/send-otp", "POST", { email: resetForm.email }, null);
      setResetOtpSent(true);
      setMessage(data.message || "OTP sent successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to send OTP.");
    } finally {
      setResetLoading(false);
    }
  };

  const resetPasswordWithOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setResetLoading(true);
    try {
      const data = await callApi<{ message?: string }>("/faculty/auth/forgot-password/verify-reset", "POST", resetForm, null);
      setMessage(data.message || "Password reset successful. Please login again.");
      setResetForm((current) => ({ ...current, otp: "", newPassword: "", confirmPassword: "" }));
      setResetOtpSent(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Password reset failed.");
    } finally {
      setResetLoading(false);
    }
  };

  const updatePayoutDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setSavingPayout(true);
    try {
      const data = await callApi<{ bankAccount?: BankAccount; message?: string }>("/faculty/bank-accounts/me", "PATCH", payoutForm, token);
      setBankAccount(data.bankAccount || bankAccount);
      setMessage(data.message || "Your payout details were updated and are pending admin verification.");
      setShowPayoutModal(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update payout details.");
    } finally {
      setSavingPayout(false);
    }
  };

  if (!profile) {
    return <FacultyPortalLayout title="My Profile"><section className="faculty-panel faculty-loading"><PremiumLoader label="Loading profile" /></section></FacultyPortalLayout>;
  }

  return (
    <FacultyPortalLayout title="My Profile" subtitle={`${profile.facultyId} · ${profile.status}`}>
      {message ? <div className="faculty-toast--success">{message}</div> : null}
      <div className="faculty-profile-grid">
        <ProfileSection title="Personal Information">
          <Detail label="Name" value={profile.fullName} />
          <Detail label="Mobile" value={profile.phone} />
          <Detail label="Email" value={profile.email || "-"} />
          <Detail label="Gender" value={profile.gender || "-"} />
          <Detail label="DOB" value={profile.dob ? profile.dob.slice(0, 10) : "-"} />
          <Detail label="Address" value={profile.address || "-"} />
        </ProfileSection>
        <ProfileSection title="Professional Information">
          <Detail label="Faculty ID" value={profile.facultyId} />
          <Detail label="Designation" value={profile.designation || "-"} />
          <Detail label="Qualification" value={profile.qualification || "-"} />
          <Detail label="Experience" value={profile.experienceYears === null ? "-" : `${profile.experienceYears} years`} />
          <Detail label="Joining Date" value={profile.joiningDate?.slice(0, 10) || "-"} />
          <Detail label="Employment Type" value={profile.employmentType || "-"} />
          <Detail label="Salary Type" value={profile.salaryType || "-"} />
          <Detail label="Payout Details Status" value={bankAccount?.verificationStatus || "Missing"} />
          <Detail label="Payout Eligible" value={bankAccount?.payoutEligible ? "Yes" : "No"} />
          <Detail label="Status" value={profile.status} />
        </ProfileSection>
        <SecuritySection
          passwordForm={passwordForm}
          setPasswordForm={setPasswordForm}
          changePassword={changePassword}
          resetForm={resetForm}
          setResetForm={setResetForm}
          resetOtpSent={resetOtpSent}
          resetLoading={resetLoading}
          sendResetOtp={sendResetOtp}
          resetPasswordWithOtp={resetPasswordWithOtp}
        />
        <section className="faculty-profile-section">
          <h2>Payout Details</h2>
          <div className="faculty-detail-list">
            <Detail label="Payout Mode" value={bankAccount?.payoutMode || "Not Set"} />
            <Detail label="Status" value={bankAccount?.verificationStatus || "Missing"} />
            <Detail label="Eligible" value={bankAccount?.payoutEligible ? "Yes" : "No"} />
            <Detail label="UPI ID" value={bankAccount?.upiId || "-"} />
            <Detail label="Account Holder" value={bankAccount?.accountHolderName || "-"} />
            <Detail label="Bank Name" value={bankAccount?.bankName || "-"} />
            <Detail label="Bank Account" value={bankAccount?.maskedBankAccountNumber || "-"} />
            <Detail label="IFSC Code" value={bankAccount?.ifscCode || "-"} />
            <Detail label="Branch Name" value={bankAccount?.branchName || "-"} />
            <Detail label="Contact Phone" value={bankAccount?.payoutContactPhone || "-"} />
            <Detail label="Contact Email" value={bankAccount?.payoutContactEmail || "-"} />
          </div>
          <div className="ledger-nav">
            <button className="faculty-button faculty-button--primary" onClick={() => setShowPayoutModal(true)}>Update Payout Details</button>
          </div>
        </section>
      </div>
      {showPayoutModal ? (
        <div className="faculty-modal-backdrop">
          <section className="faculty-modal">
            <div className="faculty-modal-header">
              <h2>Update Payout Details</h2>
              <button className="faculty-icon-button" onClick={() => setShowPayoutModal(false)} aria-label="Close payout details form">×</button>
            </div>
            <form className="faculty-form" onSubmit={updatePayoutDetails}>
              <div className="faculty-form-grid">
                <div className="faculty-field"><label>Payout Mode</label><select value={payoutForm.payoutMode} onChange={(event) => setPayoutForm((current) => ({ ...current, payoutMode: event.target.value }))}><option value="NONE">Not Set</option><option value="UPI">UPI</option><option value="BANK">Bank Transfer</option><option value="BOTH">Both</option></select></div>
                <div className="faculty-field"><label>UPI ID</label><input value={payoutForm.upiId} onChange={(event) => setPayoutForm((current) => ({ ...current, upiId: event.target.value }))} /></div>
                <div className="faculty-field"><label>Account Holder Name</label><input value={payoutForm.accountHolderName} onChange={(event) => setPayoutForm((current) => ({ ...current, accountHolderName: event.target.value }))} /></div>
                <div className="faculty-field"><label>Bank Name</label><input value={payoutForm.bankName} onChange={(event) => setPayoutForm((current) => ({ ...current, bankName: event.target.value }))} /></div>
                <div className="faculty-field"><label>Bank Account Number</label><input value={payoutForm.accountNumber} onChange={(event) => setPayoutForm((current) => ({ ...current, accountNumber: event.target.value.replace(/\D/g, "") }))} /></div>
                <div className="faculty-field"><label>IFSC Code</label><input value={payoutForm.ifscCode} onChange={(event) => setPayoutForm((current) => ({ ...current, ifscCode: event.target.value.toUpperCase() }))} /></div>
                <div className="faculty-field"><label>Branch Name</label><input value={payoutForm.branchName} onChange={(event) => setPayoutForm((current) => ({ ...current, branchName: event.target.value }))} /></div>
                <div className="faculty-field"><label>Contact Phone</label><input value={payoutForm.payoutContactPhone} onChange={(event) => setPayoutForm((current) => ({ ...current, payoutContactPhone: event.target.value.replace(/\D/g, "") }))} /></div>
                <div className="faculty-field"><label>Contact Email</label><input value={payoutForm.payoutContactEmail} onChange={(event) => setPayoutForm((current) => ({ ...current, payoutContactEmail: event.target.value }))} /></div>
              </div>
              <div className="faculty-modal-footer">
                <button type="button" className="faculty-button faculty-button--ghost" onClick={() => setShowPayoutModal(false)} disabled={savingPayout}>Cancel</button>
                <button className="faculty-button faculty-button--primary" disabled={savingPayout}>{savingPayout ? "Saving..." : "Save Payout Details"}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </FacultyPortalLayout>
  );
}

function SecuritySection({
  passwordForm,
  setPasswordForm,
  changePassword,
  resetForm,
  setResetForm,
  resetOtpSent,
  resetLoading,
  sendResetOtp,
  resetPasswordWithOtp,
}: {
  passwordForm: { currentPassword: string; newPassword: string; confirmNewPassword: string };
  setPasswordForm: React.Dispatch<React.SetStateAction<{ currentPassword: string; newPassword: string; confirmNewPassword: string }>>;
  changePassword: (event: React.FormEvent<HTMLFormElement>) => void;
  resetForm: { email: string; otp: string; newPassword: string; confirmPassword: string };
  setResetForm: React.Dispatch<React.SetStateAction<{ email: string; otp: string; newPassword: string; confirmPassword: string }>>;
  resetOtpSent: boolean;
  resetLoading: boolean;
  sendResetOtp: () => void;
  resetPasswordWithOtp: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const [mode, setMode] = useState<"change" | "reset">("change");

  return (
    <section className="faculty-profile-section">
      <div className="faculty-header faculty-header--compact">
        <h2>Security Settings</h2>
        <div className="ledger-nav">
          <button type="button" className={`faculty-button ${mode === "change" ? "faculty-button--primary" : "faculty-button--ghost"}`} onClick={() => setMode("change")}>Change Password</button>
          <button type="button" className={`faculty-button ${mode === "reset" ? "faculty-button--primary" : "faculty-button--ghost"}`} onClick={() => setMode("reset")}>Reset with OTP</button>
        </div>
      </div>
      {mode === "change" ? (
        <form className="faculty-form" onSubmit={changePassword}>
          <div className="faculty-field"><label>Current Password</label><input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} /></div>
          <div className="faculty-field"><label>New Password</label><input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} /></div>
          <div className="faculty-field"><label>Confirm New Password</label><input type="password" value={passwordForm.confirmNewPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmNewPassword: event.target.value }))} /></div>
          <button className="faculty-button faculty-button--primary">Change Password</button>
        </form>
      ) : (
        <form className="faculty-form" onSubmit={resetPasswordWithOtp}>
          <div className="faculty-field"><label>Email</label><input type="email" value={resetForm.email} onChange={(event) => setResetForm((current) => ({ ...current, email: event.target.value }))} /></div>
          <button type="button" className="faculty-button faculty-button--ghost" onClick={sendResetOtp} disabled={resetLoading}>Send OTP</button>
          {resetOtpSent ? (
            <>
              <div className="faculty-field"><label>OTP</label><input value={resetForm.otp} onChange={(event) => setResetForm((current) => ({ ...current, otp: event.target.value }))} maxLength={6} /></div>
              <div className="faculty-field"><label>New Password</label><input type="password" value={resetForm.newPassword} onChange={(event) => setResetForm((current) => ({ ...current, newPassword: event.target.value }))} /></div>
              <div className="faculty-field"><label>Confirm New Password</label><input type="password" value={resetForm.confirmPassword} onChange={(event) => setResetForm((current) => ({ ...current, confirmPassword: event.target.value }))} /></div>
              <button className="faculty-button faculty-button--primary" disabled={resetLoading}>Reset Password</button>
            </>
          ) : null}
        </form>
      )}
    </section>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="faculty-profile-section"><h2>{title}</h2><div className="faculty-detail-list">{children}</div></section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="faculty-detail-item"><span>{label}</span><strong>{value}</strong></div>;
}
