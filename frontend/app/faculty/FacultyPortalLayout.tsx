"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Bot, CalendarDays, ChevronLeft, ChevronRight, Gauge, Gift, LogOut, Menu, UserRound, WalletCards, X } from "lucide-react";
import { clearFacultyAuthSession, getFacultyAuthToken } from "../../lib/authStorage.js";
import useSessionControl from "../../lib/useSessionControl.js";

const navItems = [
  { href: "/faculty/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/faculty/profile", label: "My Profile", icon: UserRound },
  { href: "/faculty/attendance", label: "Attendance", icon: CalendarDays },
  { href: "/faculty/payroll", label: "Payroll", icon: WalletCards },
  { href: "/faculty/extra-incentives", label: "Extra Incentives", icon: Gift },
  { href: "/faculty/notifications", label: "Notifications", icon: Bell },
  { href: "/faculty/assistant", label: "Assistant", icon: Bot },
];

const MAIN_LOGIN_ROUTE = "/login";

export default function FacultyPortalLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  useSessionControl("faculty");
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("facultySidebarCollapsed");
      if (stored === "1") setCollapsed(true);
    } catch {
      // Keep expanded when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const toggleSidebar = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("facultySidebarCollapsed", next ? "1" : "0");
      } catch {
        // Ignore storage failures; the visual toggle still works.
      }
      return next;
    });
  };

  const logout = () => {
    const token = getFacultyAuthToken();
    if (token) {
      fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setMobileMenuOpen(false);
    clearFacultyAuthSession();
    router.push(MAIN_LOGIN_ROUTE);
  };

  const renderNavLinks = (mobile = false) =>
    navItems.map((item) => {
      const Icon = item.icon;
      const active = pathname === item.href;
      return (
        <Link key={item.href} href={item.href} className={active ? "active" : ""} title={item.label}>
          <Icon size={mobile ? 18 : 17} />
          <span className="sidebar-label">{item.label}</span>
        </Link>
      );
    });

  return (
    <main className={`faculty-app-shell faculty-page faculty-portal-page${collapsed ? " is-collapsed faculty-portal-page--collapsed" : ""}${mobileMenuOpen ? " mobile-menu-open" : ""}`}>
      <header className="faculty-mobile-header">
        <div className="faculty-mobile-brand">
          <span className="faculty-mobile-logo">
            <Image src="/flow.png" alt="Flowlytiks logo" width={38} height={38} priority />
          </span>
          <div>
            <strong>Flowlytiks</strong>
            <span>Faculty Portal</span>
          </div>
        </div>
        <button
          type="button"
          className="faculty-mobile-menu-toggle"
          onClick={() => setMobileMenuOpen((current) => !current)}
          aria-label={mobileMenuOpen ? "Close faculty menu" : "Open faculty menu"}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>
      <button
        type="button"
        className="faculty-mobile-drawer-overlay"
        aria-label="Close faculty menu"
        onClick={() => setMobileMenuOpen(false)}
      />
      <aside className="faculty-mobile-drawer" aria-hidden={!mobileMenuOpen}>
        <div className="faculty-mobile-drawer-header">
          <div className="faculty-mobile-brand">
            <span className="faculty-mobile-logo">
              <Image src="/flow.png" alt="Flowlytiks logo" width={38} height={38} />
            </span>
            <div>
              <strong>Flowlytiks</strong>
              <span>Faculty Portal</span>
            </div>
          </div>
          <button
            type="button"
            className="faculty-mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close faculty menu"
          >
            <X size={22} />
          </button>
        </div>
        <nav className="faculty-mobile-nav">{renderNavLinks(true)}</nav>
        <button className="faculty-button faculty-button--ghost faculty-mobile-logout" onClick={logout} title="Logout">
          <LogOut size={17} />
          <span>Logout</span>
        </button>
      </aside>
      <aside className="faculty-sidebar faculty-portal-sidebar">
        <div className="faculty-portal-sidebar-top">
          <div className="faculty-portal-brand" title="Flowlytiks Faculty Portal">
            <span className="faculty-portal-logo-mark">
              <Image src="/flow.png" alt="Flowlytiks logo" width={40} height={40} priority />
            </span>
            <strong>Flowlytiks</strong>
            <span className="faculty-portal-subtitle">Faculty Portal</span>
          </div>
          <button
            type="button"
            className="faculty-sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand faculty sidebar" : "Collapse faculty sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
          </button>
        </div>
        <nav className="faculty-portal-nav">{renderNavLinks()}</nav>
        <button className="faculty-button faculty-button--ghost faculty-portal-logout" onClick={logout} title="Logout">
          <LogOut size={16} />
          <span className="sidebar-label">Logout</span>
        </button>
      </aside>
      <section className="faculty-page-shell faculty-content faculty-portal-main">
        <main className="faculty-page-scroll">
          <div className="faculty-page-inner">
            <header className="faculty-header">
              <div className="faculty-title-block">
                <h1>{title}</h1>
                {subtitle ? <p>{subtitle}</p> : null}
              </div>
            </header>
            {children}
          </div>
        </main>
      </section>
    </main>
  );
}
