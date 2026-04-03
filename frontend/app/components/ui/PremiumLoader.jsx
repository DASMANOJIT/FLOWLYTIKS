"use client";

import { motion, useReducedMotion } from "framer-motion";

export default function PremiumLoader({
  label = "Loading",
  inline = false,
  compact = false,
  fullScreen = false,
}) {
  const reducedMotion = useReducedMotion();

  return (
    <div
      className={[
        "premium-loader",
        inline ? "premium-loader--inline" : "",
        compact ? "premium-loader--compact" : "",
        fullScreen ? "premium-loader--fullscreen" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-live="polite"
    >
      <div className="premium-loader__stage">
        <motion.div
          className="premium-loader__shadow"
          animate={
            reducedMotion
              ? { opacity: [0.24, 0.42, 0.24] }
              : { scaleX: [1, 1.18, 1], opacity: [0.24, 0.42, 0.24] }
          }
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="premium-loader__ring premium-loader__ring--outer"
          animate={{
            rotate: 360,
            scale: reducedMotion ? 1 : [1, 1.03, 1],
          }}
          transition={{
            rotate: { duration: 2.2, repeat: Infinity, ease: "linear" },
            scale: { duration: 1.8, repeat: Infinity, ease: "easeInOut" },
          }}
        />
        <motion.div
          className="premium-loader__ring premium-loader__ring--inner"
          animate={{
            rotate: -360,
            y: reducedMotion ? 0 : [-1.5, 1.5, -1.5],
          }}
          transition={{
            rotate: { duration: 1.8, repeat: Infinity, ease: "linear" },
            y: { duration: 1.3, repeat: Infinity, ease: "easeInOut" },
          }}
        />
        <motion.div
          className="premium-loader__core"
          animate={
            reducedMotion
              ? { opacity: [0.86, 1, 0.86] }
              : {
                  y: [-4, 4, -4],
                  rotateX: [0, 12, 0],
                  opacity: [0.86, 1, 0.86],
                }
          }
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {label ? (
        <motion.span
          className="premium-loader__label"
          animate={{ opacity: [0.66, 1, 0.66] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          {label}
        </motion.span>
      ) : null}
    </div>
  );
}
