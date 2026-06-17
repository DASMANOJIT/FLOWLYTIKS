"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getFacultyAuthToken } from "../../../lib/authStorage.js";
import FacultyChatbot from "../FacultyChatbot";
import FacultyPortalLayout from "../FacultyPortalLayout";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import "../../admin/faculty/faculty.css";

export default function FacultyAssistantPage() {
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
      title="Faculty Assistant"
      subtitle="Update attendance, check payout status, and get account help."
    >
      {ready ? (
        <FacultyChatbot />
      ) : (
        <section className="faculty-panel faculty-loading">
          <PremiumLoader label="Loading assistant" />
        </section>
      )}
    </FacultyPortalLayout>
  );
}
