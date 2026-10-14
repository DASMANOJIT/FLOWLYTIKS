"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiCall } from "../../../lib/api.js";
import { getFacultyAuthToken } from "../../../lib/authStorage.js";
import FacultyPortalLayout from "../FacultyPortalLayout";
import OnlineDoubtClassForm from "../extra-incentives/OnlineDoubtClassForm";
import "../../admin/faculty/faculty.css";
import styles from "./page.module.css";

type IncentiveType = { id: string; name: string; onlineClassWorkflow?: boolean };
const call = apiCall as <T>(endpoint: string, method: string, body: unknown, token: string | null) => Promise<T>;
const idle = () => {};

export default function FacultyOnlineClassesPage() {
  const token = useMemo(() => getFacultyAuthToken(), []);
  const [type, setType] = useState<IncentiveType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const data = await call<{ types: IncentiveType[] }>("/faculty-extra-incentives/my", "GET", null, token);
      setType(data.types.find(item => item.name.trim().replace(/\s+/g, " ").toUpperCase() === "ONLINE DOUBT CLASS") || data.types.find(item => item.onlineClassWorkflow) || null);
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to load online classes."); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  return <FacultyPortalLayout title="Online Classes" subtitle="Schedule classes and view your online class history.">
    <section className={`faculty-card ${styles.content}`}>
      {loading && !type ? <p role="status">Loading online classes...</p> : null}
      {error ? <div role="alert" className="faculty-toast--error">{error}<button className="faculty-button faculty-button--ghost" onClick={() => void load()}>Retry</button></div> : null}
      {type ? <OnlineDoubtClassForm token={token} incentiveTypeId={type.id} allClasses onChanged={load} onBusy={idle} /> : !loading && !error ? <p>Online Doubt Class is not configured. Please contact admin.</p> : null}
    </section>
  </FacultyPortalLayout>;
}
