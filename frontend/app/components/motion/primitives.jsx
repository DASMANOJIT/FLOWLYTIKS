"use client";

import { motion, useReducedMotion } from "framer-motion";

export const premiumEase = [0.22, 1, 0.36, 1];

export const staggerContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.04,
    },
  },
};

export const fadeUpItem = {
  hidden: {
    opacity: 0,
    y: 18,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.42,
      ease: premiumEase,
    },
  },
};

export function MotionSection({ children, className = "", delay = 0, ...props }) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18 }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay, ease: premiumEase }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function MotionCard({ children, className = "", delay = 0, hover = true, ...props }) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.98 }}
      animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.38, delay, ease: premiumEase }}
      whileHover={hover && !reducedMotion ? { y: -6, scale: 1.01 } : undefined}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function MotionButton({
  children,
  className = "",
  disabled = false,
  hoverShadow,
  ...props
}) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.button
      className={className}
      disabled={disabled}
      whileHover={
        !disabled && !reducedMotion
          ? {
              y: -2,
              scale: 1.01,
              boxShadow: hoverShadow || "0 16px 28px rgba(37, 99, 235, 0.22)",
            }
          : undefined
      }
      whileTap={!disabled && !reducedMotion ? { scale: 0.985 } : undefined}
      transition={{ duration: 0.2, ease: premiumEase }}
      {...props}
    >
      {children}
    </motion.button>
  );
}
