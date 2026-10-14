"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch, readApiResponse } from "../../../lib/api.js";
import { getAuthRole, getAuthToken } from "../../../lib/authStorage.js";
import styles from "./StaffFollowUps.module.css";

export default function StaffFollowUps({ studentId }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(false);
  const moreRequest = useRef(null);
  useEffect(() => {
    if (getAuthRole() !== "admin") return;
    const controller = new AbortController();
    setEntries(null); setError(""); setCursor(null); setBusy(false);
    void (async () => {
      try {
        const response = await apiFetch(`/api/staff/students/${studentId}/timeline?limit=30`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
        const result = await readApiResponse(response);
        if (!result.ok) throw new Error(result.error);
        if (!controller.signal.aborted) { setEntries(result.data.events); setCursor(result.data.nextCursor); }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load Staff follow-ups."); }
    })();
    return () => { controller.abort(); moreRequest.current?.abort(); moreRequest.current = null; };
  }, [studentId, refresh]);
  const loadMore = async () => {
    if (!cursor || busy || moreRequest.current) return;
    const controller = new AbortController(); moreRequest.current = controller;
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/staff/students/${studentId}/timeline?limit=30&cursor=${encodeURIComponent(cursor)}`, { headers: { Authorization: `Bearer ${getAuthToken()}` }, cache: "no-store", signal: controller.signal });
      const result = await readApiResponse(response);
      if (!result.ok) throw new Error(result.error);
      if (controller.signal.aborted) return;
      setEntries(current => [...current, ...result.data.events.filter(entry => !current.some(saved => saved.id === entry.id))]); setCursor(result.data.nextCursor);
    } catch (error) { if (!controller.signal.aborted) setError(error.message || "Unable to load activity."); }
    finally { if (moreRequest.current === controller) { moreRequest.current = null; setBusy(false); } }
  };
  return <section className={styles.section}><header><h3>Staff Follow-Ups & Student Activity</h3><button disabled={busy} onClick={() => setRefresh((value) => value + 1)}>Refresh</button></header>
    {error && <p role="alert">{error}</p>}{entries === null ? !error && <p role="status">Loading activity...</p> : !entries.length ? <p>No student activity found.</p> : <ol className={styles.thread}>{entries.map((entry) => <li key={entry.id}><div><strong>{entry.staff.name}</strong><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></div><p>{entry.note}</p></li>)}</ol>}
    {cursor && <button disabled={busy} onClick={loadMore}>{busy ? "Loading..." : "Load More"}</button>}
  </section>;
}
