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
          initial={{ opacity: 0 }}
animate={{ opacity: 1 }}
exit={{ opacity: 0 }}
transition={{
  duration: reducedMotion ? 0 : 0.2,
  ease: "easeOut",
}}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}
