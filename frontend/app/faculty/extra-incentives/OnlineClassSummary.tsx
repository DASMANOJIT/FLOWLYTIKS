"use client";

import { useEffect, useState } from "react";
import { apiCall } from "../../../lib/api.js";
import type { OnlineClassRecord } from "./OnlineClassRecords";
import styles from "./online-classes.module.css";

const call = apiCall as <T>(endpoint: string, method: string, body: unknown, token: string | null) => Promise<T>;
const date = (value: string) => new Date(value).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" });
const time = (value: string) => new Date(value).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" });

export default function OnlineClassSummary({ token, incentiveTypeId }: { token: string | null; incentiveTypeId: string }) {
  const [records, setRecords] = useState<OnlineClassRecord[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void call<{ records: OnlineClassRecord[]; hasMore: boolean }>(`/faculty-extra-incentives/my/online-classes?incentiveTypeId=${encodeURIComponent(incentiveTypeId)}&page=${page}`, "GET", null, token)
      .then(data => { if (active) { setRecords(current => page === 1 ? data.records : [...current, ...data.records]); setHasMore(data.hasMore); } })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : "Unable to load class records."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, incentiveTypeId, page, retry]);
  return <div className={styles.records}>
    {records.map(record => <article key={record.id} className={styles.record}><dl className={styles.details}>
      <div><dt>Batch Name</dt><dd>{record.batchName}</dd></div>
      <div><dt>Topic</dt><dd>{record.topic}</dd></div>
      <div><dt>Class Date (IST)</dt><dd>{date(record.startsAt)}</dd></div>
      <div><dt>Start Time (IST)</dt><dd>{time(record.startsAt)}</dd></div>
      <div><dt>End Time (IST)</dt><dd>{time(record.endsAt)}</dd></div>
    </dl></article>)}
    {loading ? <p role="status">Loading class records...</p> : null}
    {error ? <p role="alert" className="faculty-toast--error">{error}</p> : null}
    {!loading && !error && !records.length ? <p>No online class records found.</p> : null}
    {hasMore && !error ? <button className="faculty-button faculty-button--ghost" disabled={loading} onClick={() => { setLoading(true); setPage(current => current + 1); }}>Load More</button> : null}
    {error ? <button className="faculty-button faculty-button--ghost" onClick={() => { setLoading(true); setError(""); setRetry(current => current + 1); }}>Retry</button> : null}
  </div>;
}
