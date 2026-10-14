"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiFetch, readApiResponse } from "../../../lib/api.js";
import { getAuthToken } from "../../../lib/authStorage.js";
import styles from "./OnlineClassSummary.module.css";

type Summary = { live: number; scheduled: number; taken: number; weekStart: string; weekEnd: string };
const date = (value: string) => new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" });
export default function OnlineClassSummary() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true; setLoading(true);
      try {
        const response = await apiFetch("/api/faculty-extra-incentives/admin/online-class-summary", { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
        const result = await readApiResponse(response, "Online class summary could not load.");
        if (!result.ok) throw new Error(result.error);
        if (!controller.signal.aborted) { setData(result.data as Summary); setError(""); }
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Online class summary could not load."); }
      finally { busy = false; if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    const focus = () => void load(); window.addEventListener("focus", focus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [refresh]);
  return <section className={styles.root} aria-busy={loading}>
    <header><h2>Online Live Classes</h2><button type="button" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={16} />Refresh</button></header>
    {data ? <p>{date(data.weekStart)} – {date(data.weekEnd)} · Friday–Thursday, IST</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <div className={styles.grid}>{[["Live Classes", data?.live], ["Scheduled Classes", data?.scheduled], ["Classes Taken This Week", data?.taken]].map(([label, value]) => <div key={label} className={styles.card}><h3>{label}</h3><strong>{error ? "—" : value ?? "—"}</strong></div>)}</div>
    {loading && !data ? <p role="status">Loading online classes...</p> : null}
  </section>;
}
