"use client";

import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";

const pageTransition = {
  duration: 0.34,
  ease: [0.22, 1, 0.36, 1],
};

export default function AppMotionShell({ children }) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pathname}
          className="app-motion-shell"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18, filter: "blur(10px)" }}
          animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -10, filter: "blur(8px)" }}
          transition={pageTransition}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}
