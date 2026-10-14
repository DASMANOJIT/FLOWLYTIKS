"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { getFacultyAuthToken } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import WeeklyAttendanceGrid from "../WeeklyAttendanceGrid";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import "../../admin/faculty/faculty.css";

const subscribe = () => () => {};
const serverToken = () => "";

export default function FacultyAttendancePage() {
  const router = useRouter();
  const token = useSyncExternalStore(subscribe, getFacultyAuthToken, serverToken);

  useEffect(() => {
    if (!getFacultyAuthToken()) {
      router.push("/login");
      return;
    }
  }, [router, token]);

  return (
    <FacultyPortalLayout
      title="Attendance"
      subtitle="Mark your daily attendance from Friday to Thursday."
    >
      {token ? (
        <WeeklyAttendanceGrid token={token} />
      ) : (
        <section className="faculty-panel faculty-loading"><PremiumLoader label="Loading attendance" /></section>
      )}
    </FacultyPortalLayout>
  );
}
