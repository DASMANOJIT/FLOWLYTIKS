"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { MotionButton, MotionCard, premiumEase } from "../components/motion/primitives.jsx";
import { readApiResponse } from "../../lib/api.js";
import { getAuthToken } from "../../lib/authStorage.js";

const statusVisualConfig = {
  checking: {
    accent: "#4f7cff",
    glow: "rgba(79, 124, 255, 0.28)",
    badge: "Verifying",
    title: "Verifying Payment",
    description:
      "We’re securely confirming the latest gateway status with the server before updating your dashboard.",
    cta: "Go to Dashboard",
  },
  success: {
    accent: "#22c55e",
    glow: "rgba(34, 197, 94, 0.26)",
    badge: "Success",
    title: "Payment Confirmed",
    description:
      "Your payment has been securely verified. We’ll take you back to the dashboard in a moment.",
    cta: "Go to Dashboard",
  },
  failed: {
    accent: "#ef4444",
    glow: "rgba(239, 68, 68, 0.22)",
    badge: "Failed",
    title: "Payment Failed",
    description:
      "This payment was not completed successfully. You can return to the dashboard and try again when ready.",
    cta: "Back to Dashboard",
  },
  pending: {
    accent: "#f59e0b",
    glow: "rgba(245, 158, 11, 0.24)",
    badge: "Pending",
    title: "Verification Pending",
    description:
      "The payment is still processing. Your dashboard will reflect the latest status once gateway confirmation finishes.",
    cta: "Back to Dashboard",
  },
  unknown: {
    accent: "#8b5cf6",
    glow: "rgba(139, 92, 246, 0.24)",
    badge: "Attention",
    title: "Payment Status Unavailable",
    description:
      "We couldn’t determine the latest payment state right now. You can safely return to the dashboard and recheck shortly.",
    cta: "Go to Dashboard",
  },
};

function FloatingBackdrop() {
  const reducedMotion = useReducedMotion();

  return (
    <>
      <motion.div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "-12%",
          left: "-8%",
          width: "26rem",
          height: "26rem",
          borderRadius: "999px",
          background:
            "radial-gradient(circle at 30% 30%, rgba(99, 102, 241, 0.55), rgba(59, 130, 246, 0.08) 60%, transparent 72%)",
          filter: "blur(10px)",
        }}
        animate={
          reducedMotion
            ? { opacity: 0.9 }
            : { x: [0, 22, 0], y: [0, -18, 0], scale: [1, 1.04, 1] }
        }
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden="true"
        style={{
          position: "absolute",
          right: "-10%",
          bottom: "-16%",
          width: "22rem",
          height: "22rem",
          borderRadius: "999px",
          background:
            "radial-gradient(circle at 60% 40%, rgba(34, 211, 238, 0.38), rgba(59, 130, 246, 0.1) 55%, transparent 72%)",
          filter: "blur(12px)",
        }}
        animate={
          reducedMotion
            ? { opacity: 0.8 }
            : { x: [0, -18, 0], y: [0, 18, 0], scale: [1, 0.96, 1] }
        }
        transition={{ duration: 11, repeat: Infinity, ease: "easeInOut" }}
      />
    </>
  );
}

function StatusVisual({ tone }) {
  const reducedMotion = useReducedMotion();
  const config = statusVisualConfig[tone] || statusVisualConfig.unknown;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "relative",
        width: "clamp(164px, 32vw, 220px)",
        aspectRatio: "1 / 1",
        display: "grid",
        placeItems: "center",
        margin: "0 auto",
        perspective: "1200px",
      }}
    >
      <motion.div
        style={{
          position: "absolute",
          inset: "18%",
          borderRadius: "999px",
          background: config.glow,
          filter: "blur(28px)",
        }}
        animate={
          reducedMotion
            ? { opacity: 0.72 }
            : { scale: [0.94, 1.08, 0.94], opacity: [0.55, 0.9, 0.55] }
        }
        transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        style={{
          position: "absolute",
          inset: "7%",
          borderRadius: "999px",
          border: `1px solid ${config.glow}`,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.68), rgba(255,255,255,0.12))",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.7), 0 18px 40px rgba(15, 23, 42, 0.12)",
          backdropFilter: "blur(14px)",
          transformStyle: "preserve-3d",
        }}
        animate={
          reducedMotion
            ? { rotateX: 8, rotateY: -8 }
            : { rotateX: [8, 16, 8], rotateY: [-12, 8, -12] }
        }
        transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          borderRadius: "999px",
          border: `1px solid ${config.accent}40`,
        }}
        animate={
          reducedMotion
            ? { rotate: 0 }
            : {
                rotate: tone === "failed" ? [0, -6, 6, 0] : 360,
                scale: [0.96, 1, 0.96],
              }
        }
        transition={{
          rotate:
            tone === "failed"
              ? { duration: 0.6, repeat: Infinity, repeatDelay: 1.8, ease: "easeInOut" }
              : { duration: 8, repeat: Infinity, ease: "linear" },
          scale: { duration: 2.8, repeat: Infinity, ease: "easeInOut" },
        }}
      />

      <motion.div
        style={{
          position: "absolute",
          inset: "16%",
          borderRadius: "999px",
          border: `1px dashed ${config.accent}55`,
        }}
        animate={reducedMotion ? { rotate: 0 } : { rotate: -360 }}
        transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
      />

      <motion.div
        style={{
          position: "relative",
          zIndex: 2,
          width: "44%",
          height: "44%",
          borderRadius: "999px",
          display: "grid",
          placeItems: "center",
          color: "#fff",
          background: `linear-gradient(145deg, ${config.accent}, rgba(15, 23, 42, 0.88))`,
          boxShadow: `0 18px 42px ${config.glow}, inset 0 1px 0 rgba(255,255,255,0.28)`,
        }}
        animate={
          reducedMotion
            ? { y: 0 }
            : tone === "checking"
              ? { y: [-5, 5, -5], scale: [0.98, 1.03, 0.98] }
              : { y: [-3, 3, -3], scale: [0.99, 1.01, 0.99] }
        }
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        {tone === "success" ? (
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : tone === "failed" ? (
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        ) : tone === "pending" ? (
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v5l3 2" />
          </svg>
        ) : (
          <motion.div
            style={{ display: "flex", gap: 4 }}
            animate={reducedMotion ? undefined : { opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          >
            {[0, 1, 2].map((index) => (
              <motion.span
                key={index}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "999px",
                  background: "currentColor",
                  display: "block",
                }}
                animate={reducedMotion ? undefined : { y: [0, -5, 0] }}
                transition={{
                  duration: 0.8,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: index * 0.12,
                }}
              />
            ))}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

export default function PaymentSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const transactionId = searchParams.get("txnid");
  const gateway = searchParams.get("gateway");
  const paymentId = searchParams.get("paymentId");
  const gatewayOrderId = searchParams.get("gatewayOrderId");
  const cashfreeOrderId =
    searchParams.get("cashfreeOrderId") || searchParams.get("order_id");
  const apiBase = "";

  const [status, setStatus] = useState(
    transactionId || gatewayOrderId || cashfreeOrderId
      ? "Checking payment status..."
      : "Invalid payment reference."
  );
  const [checking, setChecking] = useState(
    Boolean(transactionId || gatewayOrderId || cashfreeOrderId)
  );

  useEffect(() => {
    if (!transactionId && !gatewayOrderId && !cashfreeOrderId) {
      return;
    }

    const token = getAuthToken();
    if (!token) {
      router.push("/login");
      return;
    }

    let retries = 0;
    const maxRetries = 8;

    const checkStatus = async () => {
      try {
        const endpoint =
          gateway === "cashfree" || gatewayOrderId || cashfreeOrderId
            ? `${apiBase}/api/payments/cashfree/verify?paymentId=${encodeURIComponent(
                paymentId || ""
              )}&gatewayOrderId=${encodeURIComponent(
                gatewayOrderId || ""
              )}&cashfreeOrderId=${encodeURIComponent(cashfreeOrderId || "")}`
            : `${apiBase}/api/payments/phonepe/status/${transactionId}`;

        const res = await fetch(endpoint, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        const { ok, data, error } = await readApiResponse(
          res,
          "Unable to verify payment."
        );
        if (!ok) {
          setStatus(error || data.message || "Unable to verify payment.");
          setChecking(false);
          return;
        }

        if (data.status === "paid" || data.status === "PAID") {
          setStatus("Payment successful. Redirecting to dashboard...");
          setChecking(false);
          setTimeout(() => router.push("/student"), 1200);
          return;
        }

        if (
          data.status === "failed" ||
          data.status === "FAILED" ||
          data.status === "CANCELLED"
        ) {
          setStatus("Payment failed. Please try again.");
          setChecking(false);
          return;
        }

        if (data.status === "EXPIRED") {
          setStatus("This payment session expired. Please start the payment again.");
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
  }, [apiBase, cashfreeOrderId, gateway, gatewayOrderId, paymentId, router, transactionId]);

  const statusTone = useMemo(() => {
    if (checking) return "checking";

    const normalized = String(status || "").toLowerCase();
    if (normalized.includes("successful")) return "success";
    if (normalized.includes("failed") || normalized.includes("expired")) return "failed";
    if (normalized.includes("processing") || normalized.includes("pending")) return "pending";
    return "unknown";
  }, [checking, status]);

  const statusMeta = statusVisualConfig[statusTone] || statusVisualConfig.unknown;

  return (
    <motion.div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        position: "relative",
        overflow: "hidden",
        padding: "32px 20px",
        background:
          "radial-gradient(circle at top, rgba(99, 102, 241, 0.14), transparent 32%), linear-gradient(180deg, #eef4ff 0%, #f8fbff 40%, #eef5ff 100%)",
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: premiumEase }}
    >
      <FloatingBackdrop />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: premiumEase }}
        style={{ width: "100%", maxWidth: 760, position: "relative", zIndex: 1 }}
      >
        <MotionCard
          hover={false}
          style={{
            position: "relative",
            overflow: "hidden",
            padding: "clamp(24px, 4vw, 36px)",
            borderRadius: 30,
            border: "1px solid rgba(255,255,255,0.58)",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.84), rgba(255,255,255,0.72))",
            boxShadow:
              "0 34px 100px rgba(30, 41, 59, 0.14), inset 0 1px 0 rgba(255,255,255,0.8)",
            backdropFilter: "blur(18px)",
          }}
        >
          <motion.div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.28), transparent 36%, rgba(99,102,241,0.08) 100%)",
            }}
          />

          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "grid",
              gap: 24,
              justifyItems: "center",
              textAlign: "center",
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.4, ease: premiumEase }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 14px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.65)",
                border: `1px solid ${statusMeta.glow}`,
                boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
                color: statusMeta.accent,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "999px",
                  background: statusMeta.accent,
                  boxShadow: `0 0 14px ${statusMeta.glow}`,
                }}
              />
              {statusMeta.badge}
            </motion.div>

            <AnimatePresence mode="wait">
              <motion.div
                key={statusTone}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.36, ease: premiumEase }}
                style={{ width: "100%", display: "grid", gap: 20 }}
              >
                <StatusVisual tone={statusTone} />

                <div style={{ display: "grid", gap: 10 }}>
                  <motion.h1
                    style={{
                      margin: 0,
                      fontSize: "clamp(2rem, 5vw, 3rem)",
                      lineHeight: 1,
                      letterSpacing: "-0.04em",
                      color: "#0f172a",
                    }}
                  >
                    Payment Status
                  </motion.h1>
                  <motion.h2
                    style={{
                      margin: 0,
                      fontSize: "clamp(1.1rem, 2vw, 1.45rem)",
                      fontWeight: 700,
                      color: "#1e3a8a",
                    }}
                  >
                    {statusMeta.title}
                  </motion.h2>
                  <p
                    style={{
                      margin: "0 auto",
                      maxWidth: 560,
                      fontSize: "0.98rem",
                      lineHeight: 1.7,
                      color: "#475569",
                    }}
                  >
                    {statusMeta.description}
                  </p>
                </div>

                <motion.div
                  style={{
                    width: "100%",
                    maxWidth: 560,
                    padding: "18px 20px",
                    borderRadius: 22,
                    textAlign: "left",
                    background: "rgba(248, 250, 252, 0.8)",
                    border: `1px solid ${statusMeta.glow}`,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.66)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: statusMeta.accent,
                      marginBottom: 8,
                    }}
                  >
                    Live Status
                  </div>
                  <div
                    style={{
                      color: "#0f172a",
                      fontSize: "1rem",
                      lineHeight: 1.65,
                      fontWeight: 500,
                    }}
                  >
                    {status}
                  </div>
                </motion.div>
              </motion.div>
            </AnimatePresence>

            <MotionButton
              onClick={() => router.push("/student")}
              style={{
                border: "none",
                cursor: "pointer",
                minWidth: 220,
                padding: "15px 22px",
                borderRadius: 18,
                color: "#fff",
                fontSize: "0.98rem",
                fontWeight: 700,
                background:
                  "linear-gradient(135deg, #2563eb 0%, #4f46e5 48%, #7c3aed 100%)",
                boxShadow: "0 20px 40px rgba(37, 99, 235, 0.25)",
              }}
              hoverShadow="0 22px 44px rgba(79, 70, 229, 0.28)"
            >
              {statusMeta.cta}
            </MotionButton>
          </div>
        </MotionCard>
      </motion.div>
    </motion.div>
  );
}
