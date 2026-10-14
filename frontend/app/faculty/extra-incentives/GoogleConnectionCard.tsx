"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Unplug, RotateCcw } from "lucide-react";
import { apiCall, apiFetch, readApiResponse } from "../../../lib/api.js";
import styles from "./online-classes.module.css";

const call = apiCall as <T>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
type Connection = { status: "CONNECTED" | "RECONNECT_REQUIRED" | "NOT_CONNECTED"; connectedAt?: string | null };
export default function GoogleConnectionCard({ token, onBusy = () => {}, compact = false, connectLabel }: { token: string | null; onBusy?: (busy: boolean) => void; compact?: boolean; connectLabel?: string }) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError("");
    try { setConnection(await call<Connection>("/faculty/google/status", "GET", null, token)); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load Google connection."); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => {
    void load();
    const result = new URLSearchParams(window.location.hash.slice(1)).get("google_connection");
    if (result) {
      setMessage(result === "connected" ? "Google account connected." : result === "denied" ? "Google connection was cancelled." : "Google connection could not be completed. Please try again.");
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, [load]);
  const act = async (action: "connect" | "disconnect" | "check") => {
    if (pending.current) return;
    if (action === "disconnect" && !window.confirm("Disconnect Google? Stored Google credentials will be removed. Your Flowlytiks login and class records will remain unchanged.")) return;
    pending.current = true; setBusy(true); onBusy(true); setError(""); setMessage("");
    try {
      if (action === "connect") {
        const data = await call<{ startUrl: string }>("/faculty/google/connect", "POST", {}, token);
        const start = new URL(data.startUrl);
        const response = await apiFetch(`${start.origin}/api/faculty/google/prepare`, { method: "POST", credentials: "include", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ ticket: start.searchParams.get("ticket") }) });
        const prepared = await readApiResponse(response, "Unable to prepare Google connection.");
        if (!prepared.ok) throw new Error(prepared.error);
        window.location.assign(data.startUrl);
        return;
      }
      if (action === "check") setConnection(await call<Connection>("/faculty/google/status?verify=1", "GET", null, token));
      else {
        const data = await call<Connection & { revocationConfirmed: boolean }>("/faculty/google/disconnect", "POST", {}, token);
        setConnection(data); setMessage(data.revocationConfirmed ? "Google disconnected. Your Flowlytiks login is unchanged." : "Stored credentials removed. Google revocation could not be confirmed; you can also remove access in your Google account settings.");
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Google connection failed."); }
    finally { pending.current = false; setBusy(false); onBusy(false); }
  };
  return <section className={compact ? styles.googleHeader : styles.record} aria-label="Google account connection">
    <div className={styles.recordHeading}><strong>Google Account</strong><span className="faculty-status">{loading ? "Loading..." : connection?.status === "CONNECTED" ? "Connected" : connection?.status === "RECONNECT_REQUIRED" ? "Reconnect required" : connection ? "Not connected" : "Unavailable"}</span></div>
    {error ? <p className="faculty-toast--error" role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <div className={styles.actions}>
      <button type="button" className="faculty-button faculty-button--soft" disabled={busy || loading || !token} onClick={() => void act("connect")}><Link2 size={16} />{connection?.status === "CONNECTED" || connection?.status === "RECONNECT_REQUIRED" ? "Reconnect Google" : connectLabel || (compact ? "Connect Google Account" : "Connect Google")}</button>
      {!loading && connection && connection.status !== "NOT_CONNECTED" ? <button type="button" className="faculty-button faculty-button--ghost" disabled={busy} onClick={() => void act("disconnect")}><Unplug size={16} />Disconnect</button> : null}
      <button type="button" className="faculty-button faculty-button--ghost" disabled={busy || loading} onClick={() => void act("check")}><RotateCcw size={16} />Check Connection</button>
    </div>
  </section>;
}
