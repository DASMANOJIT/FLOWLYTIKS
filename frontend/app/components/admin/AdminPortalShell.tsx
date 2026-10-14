"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, ChevronLeft, ChevronRight, Gauge, GraduationCap, LogOut, Menu, Users, Video, WalletCards, X } from "lucide-react";
import { clearAuthSession, getAuthToken } from "../../../lib/authStorage.js";
import { getApiBaseUrl } from "../../../lib/api.js";
import styles from "./AdminPortalShell.module.css";

const items = [
  { href: "/admin", label: "Dashboard", Icon: Gauge },
  { href: "/students", label: "Students", Icon: GraduationCap },
  { href: "/admin/faculty", label: "Faculty", Icon: Users },
  { href: "/admin/staff", label: "Staff", Icon: Users },
  { href: "/admin/online-classes", label: "Online Class", Icon: Video },
  { href: "/admin/notifications", label: "Notifications", Icon: Bell },
  { href: "/payments", label: "Payments", Icon: WalletCards },
];

export default function AdminPortalShell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  const pathname = usePathname();
  const enabled = ["/admin", "/students", "/payments", "/profile"].some(root => pathname === root || pathname.startsWith(`${root}/`));
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !enabled) return;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    const pageContent = content.current;
    const menuButton = menu.current;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    pageContent?.setAttribute("inert", "");
    drawer.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const targets = drawer.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (!targets?.length) return;
      const first = targets[0]; const last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const resize = () => { if (window.innerWidth > 768) setOpen(false); };
    window.addEventListener("keydown", keydown);
    window.addEventListener("resize", resize);
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      pageContent?.removeAttribute("inert");
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", resize);
      menuButton?.focus({ preventScroll: true });
    };
  }, [open, enabled]);

  const logout = () => {
    const token = getAuthToken();
    if (token) fetch(`${getApiBaseUrl()}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    clearAuthSession();
    alert("You are logged out from this device. Please login again.");
    window.location.href = "/login";
  };
  const brand = <div className={styles.brand}><Image src="/flow.png" alt="Flowlytiks logo" width={40} height={40} /><div><strong>Flowlytiks</strong><span>Admin Portal</span></div></div>;
  const links = <nav aria-label="Admin navigation" className={styles.nav}>{items.map(({ href, label, Icon }) => {
    const active = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
    return <Link key={href} href={href} title={label} aria-current={active ? "page" : undefined} className={active ? styles.active : ""} onClick={() => setOpen(false)}><Icon size={18} /><span>{label}</span></Link>;
  })}</nav>;
  const logoutButton = <button className={styles.logout} onClick={logout} title="Logout"><LogOut size={18} /><span>Logout</span></button>;
  if (!enabled) return <>{children}{footer}</>;
  return <div className={`${styles.shell} ${collapsed ? styles.collapsed : ""}`}>
    <aside className={styles.sidebar}><div className={styles.top}>{brand}<button className={styles.toggle} onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? "Expand admin sidebar" : "Collapse admin sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button></div>{links}{logoutButton}</aside>
    <header className={styles.mobileHeader}>{brand}<button ref={menu} onClick={() => setOpen(true)} aria-label="Open admin menu" aria-expanded={open} aria-controls="admin-mobile-drawer"><Menu size={22} /></button></header>
    {open && <><button className={styles.overlay} onClick={() => setOpen(false)} aria-label="Close admin menu" tabIndex={-1} /><aside ref={drawer} id="admin-mobile-drawer" className={styles.drawer} role="dialog" aria-modal="true" aria-label="Admin menu"><div className={styles.top}>{brand}<button onClick={() => setOpen(false)} aria-label="Close admin menu"><X size={22} /></button></div>{links}{logoutButton}</aside></>}
    <div ref={content} className={styles.content}>{children}</div>
    <div className={styles.footer}>{footer}</div>
  </div>;
}
