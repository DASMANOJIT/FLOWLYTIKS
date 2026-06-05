"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall } from "../../../lib/api.js";
import { getAuthToken } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
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
  const token = useMemo(() => getAuthToken(), []);
  const [profile, setProfile] = useState<FacultyProfile | null>(null);
  const [form, setForm] = useState({ phone: "", email: "", address: "", profilePictureUrl: "" });
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
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      router.push("/faculty/login");
      return;
    }
    callApi<{ faculty?: FacultyProfile }>("/faculty/me", "GET", null, token)
      .then((data) => {
        const faculty = data.faculty || null;
        setProfile(faculty);
        setForm({
          phone: faculty?.phone || "",
          email: faculty?.email || "",
          address: faculty?.address || "",
          profilePictureUrl: faculty?.profilePictureUrl || "",
        });
      })
      .catch(() => router.push("/faculty/login"));
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

  const updateProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    try {
      const data = await callApi<{ faculty?: FacultyProfile }>("/faculty/profile", "PUT", form, token);
      setProfile(data.faculty || profile);
      setMessage("Profile updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update profile.");
    }
  };

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

  const updatePayoutDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    try {
      const data = await callApi<{ bankAccount?: BankAccount; message?: string }>("/faculty/bank-accounts/me", "PATCH", payoutForm, token);
      setBankAccount(data.bankAccount || bankAccount);
      setMessage(data.message || "Your payout details were updated and are pending admin verification.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to update payout details.");
    }
  };

  if (!profile) {
    return <FacultyPortalLayout title="My Profile"><section className="faculty-panel faculty-loading">Loading profile...</section></FacultyPortalLayout>;
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
        </ProfileSection>
        <ProfileSection title="Account Information">
          <Detail label="Username" value={profile.username} />
          <Detail label="Account Status" value={profile.status} />
        </ProfileSection>
        <section className="faculty-profile-section">
          <h2>Payout Details</h2>
          <div className="faculty-detail-list">
            <Detail label="Payout Mode" value={bankAccount?.payoutMode || "Not Set"} />
            <Detail label="Status" value={bankAccount?.verificationStatus || "Missing"} />
            <Detail label="Eligible" value={bankAccount?.payoutEligible ? "Yes" : "No"} />
            <Detail label="Bank Account" value={bankAccount?.maskedBankAccountNumber || "-"} />
          </div>
          <form className="faculty-form" onSubmit={updatePayoutDetails}>
            <div className="faculty-field"><label>Payout Mode</label><select value={payoutForm.payoutMode} onChange={(event) => setPayoutForm((current) => ({ ...current, payoutMode: event.target.value }))}><option value="NONE">Not Set</option><option value="UPI">UPI</option><option value="BANK">Bank Transfer</option><option value="BOTH">Both</option></select></div>
            <div className="faculty-field"><label>UPI ID</label><input value={payoutForm.upiId} onChange={(event) => setPayoutForm((current) => ({ ...current, upiId: event.target.value }))} /></div>
            <div className="faculty-field"><label>Account Holder Name</label><input value={payoutForm.accountHolderName} onChange={(event) => setPayoutForm((current) => ({ ...current, accountHolderName: event.target.value }))} /></div>
            <div className="faculty-field"><label>Bank Name</label><input value={payoutForm.bankName} onChange={(event) => setPayoutForm((current) => ({ ...current, bankName: event.target.value }))} /></div>
            <div className="faculty-field"><label>Bank Account Number</label><input value={payoutForm.accountNumber} onChange={(event) => setPayoutForm((current) => ({ ...current, accountNumber: event.target.value.replace(/\D/g, "") }))} /></div>
            <div className="faculty-field"><label>IFSC Code</label><input value={payoutForm.ifscCode} onChange={(event) => setPayoutForm((current) => ({ ...current, ifscCode: event.target.value.toUpperCase() }))} /></div>
            <div className="faculty-field"><label>Branch Name</label><input value={payoutForm.branchName} onChange={(event) => setPayoutForm((current) => ({ ...current, branchName: event.target.value }))} /></div>
            <div className="faculty-field"><label>Contact Phone</label><input value={payoutForm.payoutContactPhone} onChange={(event) => setPayoutForm((current) => ({ ...current, payoutContactPhone: event.target.value.replace(/\D/g, "") }))} /></div>
            <div className="faculty-field"><label>Contact Email</label><input value={payoutForm.payoutContactEmail} onChange={(event) => setPayoutForm((current) => ({ ...current, payoutContactEmail: event.target.value }))} /></div>
            <button className="faculty-button faculty-button--primary">Save Payout Details</button>
          </form>
        </section>
        <section className="faculty-profile-section">
          <h2>Editable Profile Fields</h2>
          <form className="faculty-form" onSubmit={updateProfile}>
            <div className="faculty-field"><label>Mobile</label><input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></div>
            <div className="faculty-field"><label>Email</label><input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></div>
            <div className="faculty-field"><label>Address</label><textarea value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} /></div>
            <div className="faculty-field"><label>Profile Picture URL</label><input value={form.profilePictureUrl} onChange={(event) => setForm((current) => ({ ...current, profilePictureUrl: event.target.value }))} /></div>
            <button className="faculty-button faculty-button--primary">Save Profile</button>
          </form>
        </section>
        <section className="faculty-profile-section">
          <h2>Security Settings</h2>
          <form className="faculty-form" onSubmit={changePassword}>
            <div className="faculty-field"><label>Current Password</label><input type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} /></div>
            <div className="faculty-field"><label>New Password</label><input type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} /></div>
            <div className="faculty-field"><label>Confirm New Password</label><input type="password" value={passwordForm.confirmNewPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmNewPassword: event.target.value }))} /></div>
            <button className="faculty-button faculty-button--primary">Change Password</button>
          </form>
        </section>
      </div>
    </FacultyPortalLayout>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="faculty-profile-section"><h2>{title}</h2><div className="faculty-detail-list">{children}</div></section>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="faculty-detail-item"><span>{label}</span><strong>{value}</strong></div>;
}
