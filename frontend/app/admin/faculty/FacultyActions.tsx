"use client";

import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { Eye, EyeOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { getAuthToken } from "../../../lib/authStorage.js";
import { apiCall } from "../../../lib/api.js";
import Modal from "../../components/ui/Modal";

type SalaryType = "MONTHLY_FIXED" | "PER_CLASS" | "ATTENDANCE_BASED";
type FacultyStatus = "ACTIVE" | "INACTIVE";
type ApiCall = <T = unknown>(
  endpoint: string,
  method?: string,
  body?: unknown,
  token?: string | null
) => Promise<T>;

const callApi = apiCall as ApiCall;

export type Faculty = {
  id: string;
  facultyId: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string;
  gender: string | null;
  dob: string | null;
  address: string | null;
  designation: string | null;
  qualification: string | null;
  experienceYears: number | null;
  joiningDate: string;
  employmentType: string | null;
  salaryType: SalaryType;
  salaryAmount: number | null;
  paymentNotes: string | null;
  status: FacultyStatus;
};

type FacultyForm = {
  fullName: string;
  email: string;
  phone: string;
  gender: string;
  dob: string;
  address: string;
  designation: string;
  qualification: string;
  experienceYears: string;
  joiningDate: string;
  employmentType: string;
  salaryType: SalaryType | "";
  salaryAmount: string;
  paymentNotes: string;
  status: FacultyStatus;
  password: string;
  confirmPassword: string;
  payoutMode: string;
  upiId: string;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  branchName: string;
  payoutContactPhone: string;
  payoutContactEmail: string;
  verificationStatus: string;
  payoutEligible: string;
  payoutBlockedReason: string;
  payoutRemarks: string;
};

type Toast = { type: "success" | "error"; message: string } | null;

const EMPTY_FORM: FacultyForm = {
  fullName: "",
  email: "",
  phone: "",
  gender: "",
  dob: "",
  address: "",
  designation: "",
  qualification: "",
  experienceYears: "",
  joiningDate: "",
  employmentType: "",
  salaryType: "",
  salaryAmount: "",
  paymentNotes: "",
  status: "ACTIVE",
  password: "",
  confirmPassword: "",
  payoutMode: "NONE",
  upiId: "",
  accountHolderName: "",
  bankName: "",
  accountNumber: "",
  ifscCode: "",
  branchName: "",
  payoutContactPhone: "",
  payoutContactEmail: "",
  verificationStatus: "PENDING",
  payoutEligible: "false",
  payoutBlockedReason: "",
  payoutRemarks: "",
};

const formatDateInput = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const toForm = (faculty: Faculty): FacultyForm => ({
  ...EMPTY_FORM,
  fullName: faculty.fullName || "",
  email: faculty.email || "",
  phone: faculty.phone || "",
  gender: faculty.gender || "",
  dob: formatDateInput(faculty.dob),
  address: faculty.address || "",
  designation: faculty.designation || "",
  qualification: faculty.qualification || "",
  experienceYears:
    faculty.experienceYears === null || faculty.experienceYears === undefined
      ? ""
      : String(faculty.experienceYears),
  joiningDate: formatDateInput(faculty.joiningDate),
  employmentType: faculty.employmentType || "",
  salaryType: faculty.salaryType,
  salaryAmount:
    faculty.salaryAmount === null || faculty.salaryAmount === undefined
      ? ""
      : String(faculty.salaryAmount),
  paymentNotes: faculty.paymentNotes || "",
  status: faculty.status,
  password: "",
  confirmPassword: "",
});

const buildPayload = (form: FacultyForm) => ({
  fullName: form.fullName,
  email: form.email,
  phone: form.phone,
  gender: form.gender,
  dob: form.dob,
  address: form.address,
  designation: form.designation,
  qualification: form.qualification,
  joiningDate: form.joiningDate,
  employmentType: form.employmentType,
  salaryType: form.salaryType,
  salaryAmount: form.salaryAmount === "" ? null : Number(form.salaryAmount),
  paymentNotes: form.paymentNotes,
  status: form.status,
  password: form.password || undefined,
  confirmPassword: form.confirmPassword || undefined,
  experienceYears: form.experienceYears === "" ? null : Number(form.experienceYears),
});

const buildPayoutPayload = (facultyId: string, form: FacultyForm) => ({
  facultyId,
  payoutMode: form.payoutMode || "NONE",
  upiId: form.upiId || null,
  accountHolderName: form.accountHolderName || null,
  bankName: form.bankName || null,
  accountNumber: form.accountNumber || null,
  ifscCode: form.ifscCode ? form.ifscCode.toUpperCase() : null,
  branchName: form.branchName || null,
  payoutContactPhone: form.payoutContactPhone || null,
  payoutContactEmail: form.payoutContactEmail || null,
  verificationStatus: form.verificationStatus || "PENDING",
  payoutEligible: form.verificationStatus === "VERIFIED" && form.payoutEligible === "true",
  payoutBlockedReason: form.payoutBlockedReason || null,
  payoutRemarks: form.payoutRemarks || null,
});


export default function FacultyActions({ selectedFaculty, onSaved, onDeleted }: { selectedFaculty?: Faculty; onSaved: () => Promise<void>; onDeleted?: () => void | Promise<void> }) {
  const [toast, setToast] = useState<Toast>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingFaculty, setEditingFaculty] = useState<Faculty | null>(null);
  const [form, setForm] = useState<FacultyForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [confirmFaculty, setConfirmFaculty] = useState<Faculty | null>(null);
  const [deleteFaculty, setDeleteFaculty] = useState<Faculty | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const token = useMemo(() => getAuthToken(), []);
  const loadFaculty = onSaved;

  const showToast = useCallback((nextToast: Toast) => {
    setToast(nextToast);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const openCreateModal = () => {
    setEditingFaculty(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setModalOpen(true);
  };

  const openEditModal = (row: Faculty) => {
    setEditingFaculty(row);
    setForm(toForm(row));
    setFormErrors({});
    setModalOpen(true);
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.fullName.trim()) nextErrors.fullName = "Full name is required.";
    if (!form.phone.trim()) nextErrors.phone = "Phone number is required.";
    if (!form.joiningDate) nextErrors.joiningDate = "Joining date is required.";
    if (!form.salaryType) nextErrors.salaryType = "Salary type is required.";
    if (!editingFaculty && !form.password) nextErrors.password = "Password is required.";
    if (!editingFaculty && !form.confirmPassword) nextErrors.confirmPassword = "Confirm password is required.";
    if (!editingFaculty && form.password && form.password.length < 8) {
      nextErrors.password = "Password must be at least 8 characters.";
    }
    if (!editingFaculty && form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = "Passwords must match.";
    }
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) {
      nextErrors.email = "Enter a valid email.";
    }
    if (form.experienceYears && Number(form.experienceYears) < 0) {
      nextErrors.experienceYears = "Experience cannot be negative.";
    }
    if (form.salaryAmount && Number(form.salaryAmount) < 0) {
      nextErrors.salaryAmount = "Salary amount cannot be negative.";
    }
    if (["UPI", "BOTH"].includes(form.payoutMode) && !form.upiId.includes("@")) {
      nextErrors.upiId = "Enter a valid UPI ID.";
    }
    if (["BANK", "BOTH"].includes(form.payoutMode)) {
      if (!form.accountHolderName.trim()) nextErrors.accountHolderName = "Account holder name is required.";
      if (!form.bankName.trim()) nextErrors.bankName = "Bank name is required.";
      if (!/^\d{6,24}$/.test(form.accountNumber)) nextErrors.accountNumber = "Enter a valid bank account number.";
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifscCode.toUpperCase())) nextErrors.ifscCode = "Enter a valid IFSC code.";
    }
    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateForm() || !token) return;

    setSubmitting(true);
    try {
      const endpoint = editingFaculty ? `/faculty/${editingFaculty.id}` : "/faculty";
      const method = editingFaculty ? "PUT" : "POST";
      const saved = await callApi<{ faculty?: Faculty }>(endpoint, method, buildPayload(form), token);
      const savedFacultyId = saved.faculty?.id || editingFaculty?.id;
      if (savedFacultyId && form.payoutMode !== "NONE") {
        await callApi("/admin/faculty/bank-accounts", "POST", buildPayoutPayload(savedFacultyId, form), token);
      }
      setModalOpen(false);
      showToast({
        type: "success",
        message: editingFaculty
          ? "Faculty member updated successfully."
          : "Faculty member created successfully.",
      });
      await loadFaculty();
    } catch (submitError) {
      showToast({
        type: "error",
        message:
          submitError instanceof Error
            ? submitError.message
            : "Failed to save faculty member.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async () => {
    if (!confirmFaculty || !token) return;
    const nextStatus: FacultyStatus =
      confirmFaculty.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await callApi(`/faculty/${confirmFaculty.id}/status`, "PATCH", { status: nextStatus }, token);
      setConfirmFaculty(null);
      showToast({
        type: "success",
        message:
          nextStatus === "ACTIVE"
            ? "Faculty member activated successfully."
            : "Faculty member deactivated successfully.",
      });
      await loadFaculty();
    } catch (statusError) {
      showToast({
        type: "error",
        message:
          statusError instanceof Error
            ? statusError.message
            : "Failed to update faculty status.",
      });
    }
  };

  const permanentlyDeleteFaculty = async () => {
    if (!deleteFaculty || !token) return;
    try {
      await callApi(`/faculty/${deleteFaculty.id}/permanent`, "DELETE", null, token);
      setDeleteFaculty(null);
      showToast({
        type: "success",
        message: "Faculty member permanently deleted successfully.",
      });
      await onDeleted?.();
    } catch (deleteError) {
      showToast({
        type: "error",
        message:
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to permanently delete faculty member.",
      });
    }
  };

  const updateForm = (field: keyof FacultyForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: "" }));
  };


  const row = selectedFaculty;
  return <>
    {row ? <section className="faculty-profile-actions faculty-panel" aria-label="Faculty actions"><h2>Actions</h2>                        <div className="faculty-actions">
                          <button
                            type="button"
                            className="faculty-button faculty-button--ghost"
                            onClick={() => openEditModal(row)}
                          >
                            <Pencil size={16} />
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`faculty-button ${row.status === "ACTIVE" ? "faculty-button--danger" : "faculty-button--soft"}`}
                            onClick={() => setConfirmFaculty(row)}
                          >
                            {row.status === "ACTIVE" ? "Make Inactive" : "Make Active"}
                          </button>
                          <button
                            type="button"
                            className="faculty-button faculty-button--danger"
                            onClick={() => setDeleteFaculty(row)}
                          >
                            <Trash2 size={16} />
                            Delete
                          </button>
                        </div>
 </section> : <>          <button className="faculty-button faculty-button--primary" onClick={openCreateModal}>
            <Plus size={18} />
            Create New Faculty Member
          </button>
</>}
      {modalOpen ? (
        <Modal className="faculty-modal-backdrop" role="dialog" aria-modal="true">
          <div className="faculty-modal">
            <div className="faculty-modal-header">
              <h2>{editingFaculty ? "Edit Faculty Member" : "Create Faculty Member"}</h2>
              <button className="faculty-icon-button" onClick={() => setModalOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={submitForm}>
              <div className="faculty-form">
                <FormSection title="Personal Information">
                  <div className="faculty-form-grid">
                    <Field label="Full Name" error={formErrors.fullName} required>
                      <input value={form.fullName} onChange={(e) => updateForm("fullName", e.target.value)} />
                    </Field>
                    <Field label="Email" error={formErrors.email}>
                      <input type="email" value={form.email} onChange={(e) => updateForm("email", e.target.value)} />
                    </Field>
                    <Field label="Phone Number" error={formErrors.phone} required>
                      <input value={form.phone} onChange={(e) => updateForm("phone", e.target.value)} />
                    </Field>
                    <Field label="Gender">
                      <select value={form.gender} onChange={(e) => updateForm("gender", e.target.value)}>
                        <option value="">Select gender</option>
                        <option value="Female">Female</option>
                        <option value="Male">Male</option>
                        <option value="Non-binary">Non-binary</option>
                        <option value="Prefer not to say">Prefer not to say</option>
                      </select>
                    </Field>
                    <Field label="Date of Birth">
                      <input type="date" value={form.dob} onChange={(e) => updateForm("dob", e.target.value)} />
                    </Field>
                    <Field label="Date of Joining" error={formErrors.joiningDate} required>
                      <input type="date" value={form.joiningDate} onChange={(e) => updateForm("joiningDate", e.target.value)} />
                    </Field>
                    <Field label="Address" wide>
                      <textarea value={form.address} onChange={(e) => updateForm("address", e.target.value)} />
                    </Field>
                  </div>
                </FormSection>

                <FormSection title="Professional Information">
                  <div className="faculty-form-grid">
                    <Field label="Faculty ID">
                      <div className="faculty-readonly-id">
                        {editingFaculty?.facultyId || "Auto-generated after save"}
                      </div>
                    </Field>
                    <Field label="Designation">
                      <input value={form.designation} onChange={(e) => updateForm("designation", e.target.value)} />
                    </Field>
                    <Field label="Employment Type">
                      <select value={form.employmentType} onChange={(e) => updateForm("employmentType", e.target.value)}>
                        <option value="">Select employment type</option>
                        <option value="Full Time">Full Time</option>
                        <option value="Part Time">Part Time</option>
                        <option value="Contract">Contract</option>
                        <option value="Visiting">Visiting</option>
                      </select>
                    </Field>
                    <Field label="Qualification">
                      <input value={form.qualification} onChange={(e) => updateForm("qualification", e.target.value)} />
                    </Field>
                    <Field label="Experience (Years)" error={formErrors.experienceYears}>
                      <input type="number" min="0" value={form.experienceYears} onChange={(e) => updateForm("experienceYears", e.target.value)} />
                    </Field>
                    <Field label="Status">
                      <select value={form.status} onChange={(e) => updateForm("status", e.target.value)}>
                        <option value="ACTIVE">Active</option>
                        <option value="INACTIVE">Inactive</option>
                      </select>
                    </Field>
                  </div>
                </FormSection>

                {!editingFaculty ? (
                  <FormSection title="Account Credentials">
                    <div className="faculty-form-grid">
                      <Field label="Username">
                        <div className="faculty-readonly-id">Auto-generated as Faculty ID</div>
                      </Field>
                      <Field label="Password" error={formErrors.password} required>
                        <div className="faculty-password-field">
                          <input
                            type={showPassword ? "text" : "password"}
                            value={form.password}
                            onChange={(e) => updateForm("password", e.target.value)}
                          />
                          <button type="button" className="faculty-icon-button" onClick={() => setShowPassword((value) => !value)}>
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </Field>
                      <Field label="Confirm Password" error={formErrors.confirmPassword} required>
                        <input
                          type={showPassword ? "text" : "password"}
                          value={form.confirmPassword}
                          onChange={(e) => updateForm("confirmPassword", e.target.value)}
                        />
                      </Field>
                    </div>
                  </FormSection>
                ) : null}

                <FormSection title="Payment Configuration">
                  <div className="faculty-form-grid">
                    <Field label="Salary Type" error={formErrors.salaryType} required>
                      <select value={form.salaryType} onChange={(e) => updateForm("salaryType", e.target.value)}>
                        <option value="">Select salary type</option>
                        <option value="MONTHLY_FIXED">Monthly Fixed</option>
                        <option value="PER_CLASS">Per Class</option>
                        <option value="ATTENDANCE_BASED">Attendance Based</option>
                      </select>
                    </Field>
                    <Field label="Salary Amount / Rate" error={formErrors.salaryAmount}>
                      <input type="number" min="0" step="0.01" value={form.salaryAmount} onChange={(e) => updateForm("salaryAmount", e.target.value)} />
                    </Field>
                    <Field label="Payment Notes" wide>
                      <textarea value={form.paymentNotes} onChange={(e) => updateForm("paymentNotes", e.target.value)} />
                    </Field>
                  </div>
                </FormSection>

                <FormSection title="Payout Details">
                  <div className="faculty-form-grid">
                    <Field label="Payout Mode">
                      <select value={form.payoutMode} onChange={(e) => updateForm("payoutMode", e.target.value)}>
                        <option value="NONE">Not Set</option>
                        <option value="UPI">UPI</option>
                        <option value="BANK">Bank Transfer</option>
                        <option value="BOTH">Both</option>
                      </select>
                    </Field>
                    <Field label="UPI ID" error={formErrors.upiId}>
                      <input value={form.upiId} onChange={(e) => updateForm("upiId", e.target.value)} />
                    </Field>
                    <Field label="Account Holder Name" error={formErrors.accountHolderName}>
                      <input value={form.accountHolderName} onChange={(e) => updateForm("accountHolderName", e.target.value)} />
                    </Field>
                    <Field label="Bank Name" error={formErrors.bankName}>
                      <input value={form.bankName} onChange={(e) => updateForm("bankName", e.target.value)} />
                    </Field>
                    <Field label="Bank Account Number" error={formErrors.accountNumber}>
                      <input value={form.accountNumber} onChange={(e) => updateForm("accountNumber", e.target.value.replace(/\D/g, ""))} />
                    </Field>
                    <Field label="IFSC Code" error={formErrors.ifscCode}>
                      <input value={form.ifscCode} onChange={(e) => updateForm("ifscCode", e.target.value.toUpperCase())} />
                    </Field>
                    <Field label="Branch Name">
                      <input value={form.branchName} onChange={(e) => updateForm("branchName", e.target.value)} />
                    </Field>
                    <Field label="Payout Contact Phone">
                      <input value={form.payoutContactPhone} onChange={(e) => updateForm("payoutContactPhone", e.target.value.replace(/\D/g, ""))} />
                    </Field>
                    <Field label="Payout Contact Email">
                      <input type="email" value={form.payoutContactEmail} onChange={(e) => updateForm("payoutContactEmail", e.target.value)} />
                    </Field>
                    <Field label="Payout Details Status">
                      <select value={form.verificationStatus} onChange={(e) => updateForm("verificationStatus", e.target.value)}>
                        <option value="PENDING">Pending Review</option>
                        <option value="VERIFIED">Verified</option>
                        <option value="REJECTED">Rejected</option>
                      </select>
                    </Field>
                    <Field label="Payout Eligibility">
                      <select value={form.payoutEligible} onChange={(e) => updateForm("payoutEligible", e.target.value)}>
                        <option value="false">Not Eligible</option>
                        <option value="true">Eligible</option>
                      </select>
                    </Field>
                    <Field label="Blocked Reason / Admin Remarks" wide>
                      <textarea value={form.payoutBlockedReason || form.payoutRemarks} onChange={(e) => { updateForm("payoutBlockedReason", e.target.value); updateForm("payoutRemarks", e.target.value); }} />
                    </Field>
                  </div>
                </FormSection>
              </div>
              <div className="faculty-modal-footer">
                <button type="button" className="faculty-button faculty-button--ghost" onClick={() => setModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="faculty-button faculty-button--primary" disabled={submitting}>
                  {submitting ? "Saving..." : editingFaculty ? "Update Faculty" : "Create Faculty"}
                </button>
              </div>
            </form>
          </div>
        </Modal>
      ) : null}

      {confirmFaculty ? (
        <Modal className="faculty-modal-backdrop" role="dialog" aria-modal="true">
          <div className="faculty-modal faculty-modal--confirm">
            <div className="faculty-modal-header">
              <h2>{confirmFaculty.status === "ACTIVE" ? "Deactivate Faculty?" : "Activate Faculty?"}</h2>
            </div>
            <div className="faculty-form">
              {confirmFaculty.status === "ACTIVE"
                ? `This will mark ${confirmFaculty.fullName} as inactive.`
                : `This will mark ${confirmFaculty.fullName} as active.`}
            </div>
            <div className="faculty-modal-footer">
              <button className="faculty-button faculty-button--ghost" onClick={() => setConfirmFaculty(null)}>
                Cancel
              </button>
              <button
                className={`faculty-button ${
                  confirmFaculty.status === "ACTIVE" ? "faculty-button--danger" : "faculty-button--soft"
                }`}
                onClick={toggleStatus}
              >
                {confirmFaculty.status === "ACTIVE" ? "Deactivate" : "Activate"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {deleteFaculty ? (
        <Modal className="faculty-modal-backdrop" role="dialog" aria-modal="true">
          <div className="faculty-modal faculty-modal--confirm">
            <div className="faculty-modal-header">
              <h2>Permanently Delete Faculty?</h2>
            </div>
            <div className="faculty-form">
              This will permanently delete this faculty member from the database. Continue?
              <br />
              <strong>{deleteFaculty.fullName}</strong> ({deleteFaculty.facultyId})
            </div>
            <div className="faculty-modal-footer">
              <button className="faculty-button faculty-button--ghost" onClick={() => setDeleteFaculty(null)}>
                Cancel
              </button>
              <button className="faculty-button faculty-button--danger" onClick={permanentlyDeleteFaculty}>
                Permanently Delete
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {toast ? <div className={`faculty-toast faculty-toast--${toast.type}`}>{toast.message}</div> : null}
  </>;
}

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="faculty-form-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  error,
  required = false,
  wide = false,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`faculty-field ${wide ? "faculty-field--wide" : ""}`}>
      <label>
        {label}
        {required ? " *" : ""}
      </label>
      {children}
      {error ? <span className="faculty-error-text">{error}</span> : null}
    </div>
  );
}
