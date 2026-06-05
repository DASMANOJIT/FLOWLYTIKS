"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, CalendarDays, Gauge, LogOut, NotebookTabs, UserRound, WalletCards } from "lucide-react";
import { clearAuthSession } from "../../lib/authStorage.js";

const navItems = [
  { href: "/faculty/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/faculty/profile", label: "My Profile", icon: UserRound },
  { href: "/faculty/attendance", label: "Attendance", icon: CalendarDays },
  { href: "/faculty/work-ledger", label: "Work Ledger", icon: NotebookTabs },
  { href: "/faculty/payroll", label: "Payroll", icon: WalletCards },
  { href: "/faculty/notifications", label: "Notifications", icon: Bell },
];

export default function FacultyPortalLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = () => {
    clearAuthSession();
    router.push("/faculty/login");
  };

  return (
    <main className="faculty-page faculty-portal-page">
      <aside className="faculty-portal-sidebar">
        <div className="faculty-portal-brand">
          <strong>Flowlytiks</strong>
          <span>Faculty Portal</span>
        </div>
        <nav className="faculty-portal-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={active ? "active" : ""}>
                <Icon size={17} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button className="faculty-button faculty-button--ghost faculty-portal-logout" onClick={logout}>
          <LogOut size={16} />
          Logout
        </button>
      </aside>
      <section className="faculty-portal-main">
        <header className="faculty-header">
          <div className="faculty-title-block">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}
