"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getFacultyAuthToken } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import WeeklyAttendanceGrid from "../WeeklyAttendanceGrid";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import "../../admin/faculty/faculty.css";

export default function FacultyAttendancePage() {
  const router = useRouter();
  const token = useMemo(() => getFacultyAuthToken(), []);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) {
      router.push("/login");
      return;
    }
    setReady(true);
  }, [router, token]);

  return (
    <FacultyPortalLayout
      title="Attendance"
      subtitle="Mark your weekly shift attendance from Friday to Thursday."
    >
      {ready ? (
        <WeeklyAttendanceGrid token={token} />
      ) : (
        <section className="faculty-panel faculty-loading"><PremiumLoader label="Loading attendance" /></section>
      )}
    </FacultyPortalLayout>
  );
}
