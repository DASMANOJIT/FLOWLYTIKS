
"use client";

import { useEffect, useState } from "react";
import { apiCall } from "../../../lib/api.js";
import type { OnlineClassRecord } from "./OnlineClassRecords";
import styles from "./online-classes.module.css";

const call = apiCall as <T>(
  endpoint: string,
  method: string,
  body: unknown,
  token: string | null
) => Promise<T>;

const date = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
  });

const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    timeStyle: "short",
  });

const STATUS_OPTIONS = [
  { value: "COMPLETED", label: "Completed" },
  { value: "INCOMPLETE", label: "Incomplete" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "LIVE", label: "Live" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

type RecordStatus = (typeof STATUS_OPTIONS)[number]["value"];

export default function OnlineClassSummary({
  token,
  incentiveTypeId,
}: {
  token: string | null;
  incentiveTypeId: string;
}) {
  const [records, setRecords] = useState<OnlineClassRecord[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<RecordStatus[]>([
    "COMPLETED",
  ]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  const statusesKey = selectedStatuses.join(",");

  useEffect(() => {
    let active = true;

    const endpoint =
      `/faculty-extra-incentives/my/online-classes` +
      `?incentiveTypeId=${encodeURIComponent(incentiveTypeId)}` +
      `&page=${page}` +
      `&statuses=${encodeURIComponent(statusesKey)}`;

    void call<{ records: OnlineClassRecord[]; hasMore: boolean }>(
      endpoint,
      "GET",
      null,
      token
    )
      .then((data) => {
        if (!active) return;

        setRecords((current) =>
          page === 1 ? data.records : [...current, ...data.records]
        );
        setHasMore(data.hasMore);
      })
      .catch((err) => {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load class records."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, incentiveTypeId, page, statusesKey, retry]);

  const updateStatuses = (nextStatuses: RecordStatus[]) => {
    setSelectedStatuses(nextStatuses);
    setRecords([]);
    setPage(1);
    setHasMore(false);
    setError("");
    setLoading(true);
  };

  const selectAll = () => {
    updateStatuses(
      selectedStatuses.length === STATUS_OPTIONS.length
        ? []
        : STATUS_OPTIONS.map((option) => option.value)
    );
  };

  const toggleStatus = (status: RecordStatus, checked: boolean) => {
    const nextStatuses = checked
      ? [...selectedStatuses, status]
      : selectedStatuses.filter((value) => value !== status);

    updateStatuses(nextStatuses);
  };

  return (
    <div className={styles.summaryContainer}>
      <fieldset className={styles.summaryFilters}>
        <legend>Filter Class Records</legend>

        <label className={styles.filterOption}>
          <input
            type="checkbox"
            checked={selectedStatuses.length === STATUS_OPTIONS.length}
            onChange={selectAll}
          />
          <strong>Select All</strong>
        </label>

        <div className={styles.filterOptions}>
          {STATUS_OPTIONS.map((option) => (
            <label key={option.value} className={styles.filterOption}>
              <input
                type="checkbox"
                checked={selectedStatuses.includes(option.value)}
                onChange={(event) =>
                  toggleStatus(option.value, event.target.checked)
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.records}>
        {records.map((record) => (
          <article key={record.id} className={styles.record}>
            <dl className={styles.details}>
              <div>
                <dt>Batch Name</dt>
                <dd>{record.batchName}</dd>
              </div>

              <div>
                <dt>Topic</dt>
                <dd>{record.topic}</dd>
              </div>

              <div>
                <dt>Class Date (IST)</dt>
                <dd>{date(record.startsAt)}</dd>
              </div>

              <div>
                <dt>Start Time (IST)</dt>
                <dd>{time(record.startsAt)}</dd>
              </div>

              <div>
                <dt>Actual End Time (IST)</dt>
                <dd>
                  {record.actualEndAt
                    ? time(record.actualEndAt)
                    : "Pending Google end time"}
                </dd>
              </div>
            </dl>
          </article>
        ))}

        {loading ? (
          <p role="status">Loading class records...</p>
        ) : null}

        {error ? (
          <p role="alert" className="faculty-toast--error">
            {error}
          </p>
        ) : null}

        {!loading && !error && !records.length ? (
          <p>
            {selectedStatuses.length === 0
              ? "Select at least one status to view class records."
              : "No class records found for the selected statuses."}
          </p>
        ) : null}

        {hasMore && !error ? (
          <button
            className="faculty-button faculty-button--ghost"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setPage((current) => current + 1);
            }}
          >
            Load More
          </button>
        ) : null}

        {error ? (
          <button
            className="faculty-button faculty-button--ghost"
            onClick={() => {
              setLoading(true);
              setError("");
              setRetry((current) => current + 1);
            }}
          >
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}
