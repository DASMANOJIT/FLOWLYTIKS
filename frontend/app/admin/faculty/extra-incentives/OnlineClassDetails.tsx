"use client";

import { useCallback, useEffect, useState } from "react";
import { apiCall } from "../../../../lib/api.js";
import OnlineClassRecords, { type OnlineClassRecord } from "../../../faculty/extra-incentives/OnlineClassRecords";

const call = apiCall as <T>(endpoint: string, method?: string, body?: unknown, token?: string | null) => Promise<T>;
export default function OnlineClassDetails({ token, facultyId, paymentId }: { token: string; facultyId?: string; paymentId?: string }) {
  const [records, setRecords] = useState<OnlineClassRecord[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (nextPage = 1) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage) });
      if (facultyId) params.set("facultyId", facultyId);
      if (paymentId) params.set("paymentId", paymentId);
      const data = await call<{ records: OnlineClassRecord[]; hasMore: boolean }>(`/faculty-extra-incentives/admin/online-classes?${params}`, "GET", null, token);
      setRecords(current => nextPage === 1 ? data.records : [...current, ...data.records]); setPage(nextPage); setHasMore(data.hasMore);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to load class details."); }
    finally { setLoading(false); }
  }, [token, facultyId, paymentId]);
  useEffect(() => { void load(); }, [load]);
  return <section>
    {error ? <div className="faculty-toast--error" role="alert">{error}<button type="button" className="faculty-button faculty-button--ghost" onClick={() => void load()}>Retry</button></div> : null}
    <OnlineClassRecords records={records} token={token} />
    {loading ? <p role="status">Loading class details...</p> : !records.length && !error ? <p>No linked online-class records found.</p> : null}
    {hasMore ? <button type="button" className="faculty-button faculty-button--ghost" disabled={loading} onClick={() => void load(page + 1)}>Load More</button> : null}
  </section>;
}
