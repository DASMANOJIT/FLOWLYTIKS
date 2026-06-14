"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PremiumLoader from "../../components/ui/PremiumLoader.jsx";
import "../../admin/faculty/faculty.css";

export default function FacultyLoginRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return (
    <main className="faculty-page">
      <div className="faculty-shell">
        <section className="faculty-panel faculty-loading">
          <PremiumLoader label="Opening unified login" />
        </section>
      </div>
    </main>
  );
}
