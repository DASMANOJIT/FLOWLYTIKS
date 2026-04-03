"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import PremiumLoader from "../components/ui/PremiumLoader.jsx";
import { MotionButton, MotionCard } from "../components/motion/primitives.jsx";

export default function PaymentSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const transactionId = searchParams.get("txnid");
  // Use same-origin `/api/*` (Next.js rewrites proxy to backend).
  const apiBase = "";

  const [status, setStatus] = useState(
    transactionId ? "Checking payment status..." : "Invalid payment reference."
  );
  const [checking, setChecking] = useState(Boolean(transactionId));

  useEffect(() => {
    if (!transactionId) {
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }

    let retries = 0;
    const maxRetries = 8;

    const checkStatus = async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/payments/phonepe/status/${transactionId}`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const data = await res.json();
        if (!res.ok) {
          setStatus(data.message || "Unable to verify payment.");
          setChecking(false);
          return;
        }

        if (data.status === "paid") {
          setStatus("Payment successful. Redirecting to dashboard...");
          setChecking(false);
          setTimeout(() => router.push("/student"), 1200);
          return;
        }

        if (data.status === "failed") {
          setStatus("Payment failed. Please try again.");
          setChecking(false);
          return;
        }

        retries += 1;
        if (retries >= maxRetries) {
          setStatus("Payment is processing. Please check dashboard in a few minutes.");
          setChecking(false);
          return;
        }

        setTimeout(checkStatus, 2000);
      } catch (err) {
        console.error("Status check failed", err);
        setStatus("Unable to verify payment status right now.");
        setChecking(false);
      }
    };

    checkStatus();
  }, [apiBase, router, transactionId]);

  return (
    <motion.div
      style={{ maxWidth: 700, margin: "80px auto", padding: 20 }}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <MotionCard
        hover={false}
        style={{
          textAlign: "center",
          padding: 28,
          borderRadius: 24,
          background: "rgba(255,255,255,0.88)",
          boxShadow: "0 20px 50px rgba(15, 23, 42, 0.08)",
        }}
      >
        <h1>Payment Status</h1>
        {checking ? <PremiumLoader label={status} /> : <p>{status}</p>}
        <MotionButton onClick={() => router.push("/student")}>Go to Dashboard</MotionButton>
      </MotionCard>
    </motion.div>
  );
}
