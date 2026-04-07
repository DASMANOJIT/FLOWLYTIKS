"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { premiumEase } from "../motion/primitives.jsx";

const getGreeting = (date) => {
  const hours = date.getHours();
  if (hours >= 5 && hours < 12) return "Good Morning";
  if (hours >= 12 && hours < 17) return "Good Afternoon";
  if (hours >= 17 && hours < 22) return "Good Evening";
  return "Good Night";
};

export default function GreetingPanel({
  subtitle = "A calm overview of your day, right when you need it.",
  accent = "blue",
}) {
  const reducedMotion = useReducedMotion();
  const [now, setNow] = useState(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const theme = useMemo(() => {
    if (accent === "violet") {
      return {
        gradient:
          "linear-gradient(135deg, rgba(79, 70, 229, 0.96), rgba(37, 99, 235, 0.9) 52%, rgba(14, 165, 233, 0.88))",
        glow: "rgba(129, 140, 248, 0.28)",
        border: "rgba(191, 219, 254, 0.28)",
        badge: "rgba(255,255,255,0.18)",
      };
    }

    return {
      gradient:
        "linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(30, 64, 175, 0.94) 55%, rgba(14, 165, 233, 0.86))",
      glow: "rgba(56, 189, 248, 0.22)",
      border: "rgba(191, 219, 254, 0.22)",
      badge: "rgba(255,255,255,0.16)",
    };
  }, [accent]);

  const greeting = now ? getGreeting(now) : "Welcome Back";
  const timeLabel = now
    ? new Intl.DateTimeFormat("en-IN", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(now)
    : "--:--:--";
  const dateLabel = now
    ? new Intl.DateTimeFormat("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(now)
    : "Loading current date";

  return (
    <motion.div
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.985 }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, ease: premiumEase }}
      whileHover={reducedMotion ? undefined : { y: -4, scale: 1.005 }}
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight: 184,
        height: "100%",
        padding: "22px 22px 24px",
        borderRadius: 24,
        color: "#eff6ff",
        background: theme.gradient,
        border: `1px solid ${theme.border}`,
        boxShadow: `0 22px 56px rgba(15, 23, 42, 0.18), 0 0 0 1px ${theme.border} inset`,
        backdropFilter: "blur(16px)",
      }}
    >
      <motion.div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -58,
          right: -32,
          width: 170,
          height: 170,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${theme.glow} 0%, transparent 70%)`,
          filter: "blur(10px)",
        }}
        animate={
          reducedMotion
            ? { opacity: 0.9 }
            : { x: [0, 10, 0], y: [0, -8, 0], scale: [1, 1.06, 1] }
        }
        transition={{ duration: 7.2, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: -44,
          left: -14,
          width: 124,
          height: 124,
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(255,255,255,0.05)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
        }}
        animate={reducedMotion ? { rotate: 0 } : { rotate: 360 }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gap: 16,
          height: "100%",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            width: "fit-content",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 999,
            background: theme.badge,
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#7dd3fc",
              boxShadow: "0 0 14px rgba(125, 211, 252, 0.8)",
            }}
          />
          Live Overview
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <motion.h2
            style={{
              margin: 0,
              fontSize: "clamp(1.6rem, 3vw, 2.15rem)",
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              fontWeight: 800,
            }}
            animate={reducedMotion ? undefined : { opacity: [0.96, 1, 0.96] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          >
            {greeting}
          </motion.h2>
          <p
            style={{
              margin: 0,
              maxWidth: 480,
              color: "rgba(239, 246, 255, 0.82)",
              fontSize: 14.5,
              lineHeight: 1.65,
            }}
          >
            {subtitle}
          </p>
        </div>

        <div
          style={{
            marginTop: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              borderRadius: 18,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15)",
            }}
          >
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(224,231,255,0.78)" }}>
              Current Time
            </div>
            <div style={{ marginTop: 6, fontSize: "1.15rem", fontWeight: 700 }}>
              {timeLabel}
            </div>
          </div>

          <div
            style={{
              padding: "14px 16px",
              borderRadius: 18,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14)",
            }}
          >
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(224,231,255,0.78)" }}>
              Today
            </div>
            <div style={{ marginTop: 6, fontSize: "0.98rem", fontWeight: 600, lineHeight: 1.5 }}>
              {dateLabel}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
