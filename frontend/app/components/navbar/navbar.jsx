"use client";
import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./navbar.css";
import { MotionButton } from "../motion/primitives.jsx";
import { clearAuthSession, getAuthToken } from "../../../lib/authStorage.js";

// Use same-origin `/api/*` (Next.js rewrites proxy to backend).
const API = "";

export default function StudentNavbar() {
  const [studentName, setStudentName] = useState(""); // dynamic
  const [open, setOpen] = useState(false);

  // ========================
  // FETCH STUDENT NAME
  // ========================
  useEffect(() => {
    const token = getAuthToken();
    if (!token) return;

    fetch(`${API}/api/students/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (data.name) setStudentName(data.name);
      })
      .catch(err => console.error("Failed to fetch student name:", err));
  }, []);

  // ========================
  // Logout function
  // ========================
  const handleLogout = () => {
    const token = getAuthToken();
    if (token) {
      fetch(`${API}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    clearAuthSession();
    alert("You are logged out from this device. Please login again.");
    window.location.href = "/login";
  };

  return (
    <motion.nav
      className="student-navbar"
      initial={{ opacity: 0, y: -18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="nav-inner">

        {/* LEFT → Logo */}
        <div className="nav-left">
          <Image
            src="/logo.png"
            width={120}
            height={40}
            alt="Logo"
            className="nav-logo"
            loading="eager"
          />
        </div>

        {/* RIGHT → Desktop navigation */}
        <div className="nav-right desktop-only">
          <Link href="/profile" className="student-profile-link">
            <Image
              src="/user.png" // replace with your icon path
              width={40}
              height={35}
              alt="User Icon"
              className="user-icon"
            />
            <span className="student-name">HELLO {studentName.toUpperCase()}</span>
          </Link>
          <MotionButton className="logout-btn" onClick={handleLogout}>Logout</MotionButton>
        </div>

        {/* RIGHT → Hamburger on mobile */}
        <div className="hamburger mobile-only" onClick={() => setOpen(!open)}>
          <div className={open ? "bar bar1 active" : "bar bar1"}></div>
          <div className={open ? "bar bar2 active" : "bar bar2"}></div>
          <div className={open ? "bar bar3 active" : "bar bar3"}></div>
        </div>
      </div>

      {/* MOBILE MENU */}
      <AnimatePresence>
      {open && (
        <motion.div
          className="mobile-menu"
          initial={{ opacity: 0, y: -10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.22 }}
        >
          <Link href="/profile" className="student-profile-link">
            <Image
              src="/user.png" // replace with your icon path
              width={25}
              height={25}
              alt="User Icon"
              className="user-icon-mobile"
            />
            <span className="student-name-mobile">HELLO {studentName.toUpperCase()}</span>
          </Link>
          <MotionButton className="logout-btn-mobile" onClick={handleLogout}>Logout</MotionButton>
        </motion.div>
      )}
      </AnimatePresence>
    </motion.nav>
  );
}
