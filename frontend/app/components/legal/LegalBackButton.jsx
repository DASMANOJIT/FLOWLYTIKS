"use client";

import { useRouter } from "next/navigation";
import styles from "../../legal-page.module.css";

export default function LegalBackButton() {
  const router = useRouter();

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/");
  };

  return (
    <button
      type="button"
      className={styles.backButton}
      onClick={handleBack}
      aria-label="Go back to the previous page"
    >
      ← Back
    </button>
  );
}
