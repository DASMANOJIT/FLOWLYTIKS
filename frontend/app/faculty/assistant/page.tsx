"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { getFacultyAuthToken } from "../../../lib/authStorage.js";
import FacultyChatbot from "../FacultyChatbot";
import FacultyPortalLayout from "../FacultyPortalLayout";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import "../../admin/faculty/faculty.css";

const subscribe = () => () => {};
const serverToken = () => "";

export default function FacultyAssistantPage() {
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
      title="Faculty Assistant"
      subtitle="Update attendance, check payout status, and get account help."
    >
      {token ? (
        <FacultyChatbot />
      ) : (
        <section className="faculty-panel faculty-loading">
          <PremiumLoader label="Loading assistant" />
        </section>
      )}
    </FacultyPortalLayout>
  );
}
