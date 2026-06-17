"use client";

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAuthToken, getAuthRole } from "../../../../lib/authStorage.js";
import { apiCall } from "../../../../lib/api.js";
import PremiumLoader from "../../../components/ui/PremiumLoader";
import "../faculty.css";

type SalaryType = "MONTHLY_FIXED" | "PER_CLASS" | "ATTENDANCE_BASED";
type FacultyStatus = "ACTIVE" | "INACTIVE";
type ApiCall = <T = unknown>(
  endpoint: string,
  method?: string,
  body?: unknown,
  token?: string | null
) => Promise<T>;

const callApi = apiCall as ApiCall;

type Faculty = {
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

type FacultyDetailResponse = {
  faculty?: Faculty;
};

const salaryTypeLabels: Record<SalaryType, string> = {
  MONTHLY_FIXED: "Monthly Fixed",
  PER_CLASS: "Per Class",
  ATTENDANCE_BASED: "Attendance Based",
};

const formatDate = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const formatMoney = (value: number | null) => {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
};

export default function FacultyProfilePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [hasMounted, setHasMounted] = useState(false);
  const [token, setToken] = useState<string | null>("");
  const [role, setRole] = useState("");
  const [faculty, setFaculty] = useState<Faculty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadFaculty = useCallback(async (authToken?: string) => {
    const effectiveToken = authToken || token || getAuthToken();
    if (!effectiveToken) {
      return;
    }

    setLoading(true);
    setError("");
    try {
      const data = await callApi<FacultyDetailResponse>(
        `/faculty/${params.id}`,
        "GET",
        null,
        effectiveToken
      );
      setFaculty(data.faculty || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load faculty profile.");
    } finally {
      setLoading(false);
    }
  }, [params.id, token]);

  useEffect(() => {
    // Move auth reads to client-only to avoid hydration mismatch.
    setHasMounted(true);
    const storedToken = getAuthToken() || "";
    const storedRole = getAuthRole() || "";
    setToken(storedToken);
    setRole(storedRole);

    if (!storedToken || storedRole !== "admin") {
      router.push("/login");
      return;
    }

    void loadFaculty(storedToken);
  }, [loadFaculty, router]);

  const deleteFacultyConfirm = useCallback(async () => {
    if (!hasMounted || role !== "admin") return;

    // Confirm permanent deletion
    const ok = window.confirm(
      "Are you sure you want to delete this faculty member? This action cannot be undone."
    );
    if (!ok) return;

    const effectiveToken = token || getAuthToken();
    if (!effectiveToken) {
      setError("Your admin session is missing. Please log in again.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      // Call DELETE to perform a hard delete on the backend
      await callApi(`/faculty/${params.id}`, "DELETE", null, effectiveToken);
      // Redirect back to faculty list on success
      router.push("/admin/faculty");
    } catch (err) {
      // Do not clear auth or redirect to login for regular failures.
      setError(err instanceof Error ? err.message : "Failed to delete faculty member.");
    } finally {
      setLoading(false);
    }
  }, [hasMounted, role, params.id, router, token]);

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <header className="faculty-header">
          <button className="faculty-button faculty-button--ghost" onClick={() => router.back()}>
            <ArrowLeft size={18} />
            Back
          </button>
          {hasMounted && role === "admin" && (
            <button
              className="faculty-button faculty-button--danger"
              onClick={deleteFacultyConfirm}
              disabled={loading}
            >
              Delete Faculty
            </button>
          )}
          <div className="faculty-title-block">
            <h1>{faculty?.fullName || "Faculty Profile"}</h1>
            <p>{faculty ? `${faculty.facultyId} · ${faculty.status === "ACTIVE" ? "Active" : "Inactive"}` : "Faculty record details"}</p>
          </div>
        </header>

        {loading ? (
          <section className="faculty-panel faculty-loading"><PremiumLoader label="Loading faculty profile" /></section>
        ) : error ? (
          <section className="faculty-panel faculty-error">{error}</section>
        ) : !faculty ? (
          <section className="faculty-panel faculty-empty">Faculty member not found.</section>
        ) : (
          <div className="faculty-profile-grid">
            <ProfileSection title="Personal Information">
              <Detail label="Name" value={faculty.fullName} />
              <Detail label="Phone" value={faculty.phone} />
              <Detail label="Email" value={faculty.email || "-"} />
              <Detail label="DOB" value={formatDate(faculty.dob)} />
              <Detail label="Address" value={faculty.address || "-"} />
            </ProfileSection>

            <ProfileSection title="Professional Information">
              <Detail label="Faculty ID" value={faculty.facultyId} />
              <Detail label="Designation" value={faculty.designation || "-"} />
              <Detail label="Qualification" value={faculty.qualification || "-"} />
              <Detail
                label="Experience"
                value={
                  faculty.experienceYears === null || faculty.experienceYears === undefined
                    ? "-"
                    : `${faculty.experienceYears} years`
                }
              />
              <Detail label="Joining Date" value={formatDate(faculty.joiningDate)} />
              <Detail label="Employment Type" value={faculty.employmentType || "-"} />
            </ProfileSection>

            <ProfileSection title="Account Information">
              <Detail label="Username" value={faculty.username || faculty.facultyId} />
              <Detail label="Account Status" value={faculty.status === "ACTIVE" ? "Active" : "Inactive"} />
            </ProfileSection>

            <ProfileSection title="Security">
              <Detail label="Change Password" value="Available from faculty profile login." />
            </ProfileSection>

            <ProfileSection title="Payment Configuration">
              <Detail label="Salary Type" value={salaryTypeLabels[faculty.salaryType]} />
              <Detail label="Salary Amount" value={formatMoney(faculty.salaryAmount)} />
              <Detail label="Notes" value={faculty.paymentNotes || "-"} />
            </ProfileSection>

            <div className="faculty-placeholder-grid">
              <section className="faculty-placeholder-card">
                <h2>Attendance Records</h2>
                <p>Attendance module will be available in Phase 2.</p>
              </section>
              <section className="faculty-placeholder-card">
                <h2>Payout History</h2>
                <p>Payroll and payout module will be available in Phase 3.</p>
              </section>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function ProfileSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="faculty-profile-section">
      <h2>{title}</h2>
      <div className="faculty-detail-list">{children}</div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="faculty-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
