"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { getAuthRole, getAuthToken, clearAuthSession } from "../../lib/authStorage.js";
import { apiCall, apiFetch } from "../../lib/api.js";
import { Gauge, Users, WalletCards, Phone, ClipboardList, UserRound, Menu, X, LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import { staffPages, titles } from "./StaffScreens";
import "./staff.css";

const icons = [Gauge, Users, WalletCards, Phone, ClipboardList, UserRound];
const callApi = apiCall as (endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<unknown>;

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [verified, setVerified] = useState(false);
  const [authError, setAuthError] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const shell = useRef<HTMLElement>(null);
  const drawer = useRef<HTMLElement>(null);
  useEffect(() => {
    const size = () => {
      shell.current?.style.setProperty("--staff-viewport-height", `${window.visualViewport?.height || window.innerHeight}px`);
      shell.current?.style.setProperty("--staff-viewport-offset", `${window.visualViewport?.offsetTop || 0}px`);
      if (window.innerWidth > 768) setOpen(false);
    };
    size(); window.addEventListener("resize", size); window.visualViewport?.addEventListener("resize", size); window.visualViewport?.addEventListener("scroll", size);
    return () => { window.removeEventListener("resize", size); window.visualViewport?.removeEventListener("resize", size); window.visualViewport?.removeEventListener("scroll", size); };
  }, [verified]);
  useEffect(() => {
    if (getAuthRole() !== "staff" || !getAuthToken()) { router.replace("/login"); return; }
    let cancelled = false;
    const check = async () => {
      try {
        const response = await apiFetch("/api/staff/me", { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store" });
        if (response.status === 401 || response.status === 403) {
          if (!cancelled) { clearAuthSession(); router.replace("/login"); }
          return;
        }
        if (!response.ok) throw new Error("Staff service temporarily unavailable. Retrying shortly.");
        if (!cancelled) { setVerified(true); setAuthError(""); }
      } catch { if (!cancelled) setAuthError("Staff service temporarily unavailable. Retrying shortly."); }
    };
    void check();
    const timer = setInterval(check, 60000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [router]);
  const logout = async () => {
    setLogoutBusy(true);
    try {
      await callApi("/auth/logout", "POST", null, getAuthToken());
      clearAuthSession(); router.replace("/login");
    } catch { setAuthError("Logout could not complete. Please try again."); }
    finally { setLogoutBusy(false); }
  };
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    const previousHtml = document.documentElement.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    drawer.current?.querySelector<HTMLButtonElement>(".staff-close")?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const controls = drawer.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)');
      const visible = Array.from(controls || []).filter(control => control.getClientRects().length);
      const first = visible[0], last = visible.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previous; document.documentElement.style.overflow = previousHtml; window.removeEventListener("keydown", escape); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [open]);
  const section = pathname.split("/").pop() || "dashboard";
  const title = section === "dashboard" ? "Staff Dashboard" : titles[section] || "Staff Portal";
  if (!verified) return <main className="staff-ui staff-content"><p role="status">{authError || "Checking staff session..."}</p></main>;
  return <main ref={shell} className={`staff-ui staff-shell${open ? " staff-open" : ""}${collapsed ? " staff-collapsed" : ""}`}>
    <header className="staff-mobile"><strong>Flowlytiks · Staff Portal</strong><button onClick={() => setOpen(!open)} aria-label="Open staff menu" aria-expanded={open} aria-controls="staff-navigation"><Menu size={22} /></button></header>
    {open && <button className="staff-backdrop" tabIndex={-1} aria-label="Close staff menu" onClick={() => setOpen(false)} />}
    <aside ref={drawer} id="staff-navigation" role={open ? "dialog" : undefined} aria-modal={open ? true : undefined} aria-label="Staff navigation" className="staff-sidebar"><div className="staff-sidebar-top"><div className="staff-brand"><Image src="/flow.png" alt="Flowlytiks" width={40} height={40} /><span><strong>Flowlytiks</strong><small>Staff Portal</small></span><button className="staff-close" onClick={() => setOpen(false)} aria-label="Close staff menu"><X size={20} /></button></div><button className="staff-collapse" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button></div><nav>{staffPages.map((page, index) => { const Icon = icons[index]; return <Link href={`/staff/${page}`} key={page} onClick={() => setOpen(false)} title={titles[page]} className={pathname === `/staff/${page}` ? "active" : ""}><Icon size={18} /><span>{titles[page]}</span></Link>; })}</nav><button onClick={logout} disabled={logoutBusy} className="staff-logout"><LogOut size={18} /><span>{logoutBusy ? "Logging out..." : "Logout"}</span></button></aside>
    <div className="staff-content" inert={open || undefined}><div className="staff-inner"><header><h1>{title}</h1><p>Staff / Receptionist</p></header>{authError && <p role="alert">{authError}</p>}{children}</div></div>
  </main>;
}
