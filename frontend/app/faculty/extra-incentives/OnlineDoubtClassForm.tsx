
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Copy, RotateCcw, Search, X } from "lucide-react";
import { apiCall } from "../../../lib/api.js";
import OnlineClassRecords, {
  type OnlineClassRecord,
} from "./OnlineClassRecords";
import styles from "./online-classes.module.css";
import GoogleConnectionCard from "./GoogleConnectionCard";
import GoogleAccountButton from "./GoogleAccountButton";
import pageStyles from "../online-classes/page.module.css";
import ClassDateTimeFields from "../online-classes/ClassDateTimeFields";
import Modal from "../../components/ui/Modal";
import ClassDirectoryFields, {
  type DirectoryBatch,
} from "../online-classes/ClassDirectoryFields";

const call = apiCall as <T>(
  endpoint: string,
  method?: string,
  body?: unknown,
  token?: string | null,
) => Promise<T>;

const emptyForm = {
  batchName: "",
  batchIds: [] as string[],
  topic: "",
  message: "",
  date: "",
  startTime: "",
  meetUrl: "",
};

type Page = {
  records: OnlineClassRecord[];
  hasMore: boolean;
  teacherName: string;
  total?: number;
  batches?: string[];
};

const localParts = (value: string) =>
  new Date(new Date(value).getTime() + 330 * 60000).toISOString();

export default function OnlineDoubtClassForm({
  token,
  incentiveTypeId,
  onChanged,
  onBusy,
  allClasses = false,
}: {
  token: string | null;
  incentiveTypeId: string;
  onChanged: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  allClasses?: boolean;
}) {
  const [form, setForm] = useState(emptyForm);

  // Faculty default Google Meet link
  const [defaultMeetUrl, setDefaultMeetUrl] = useState("");
  const [defaultMeetUrlDraft, setDefaultMeetUrlDraft] = useState("");
  const [editingDefaultMeetUrl, setEditingDefaultMeetUrl] = useState(false);
  const [defaultMeetUrlBusy, setDefaultMeetUrlBusy] = useState(false);

  const [editing, setEditing] = useState<OnlineClassRecord | null>(null);
  const [teacherName, setTeacherName] = useState("");
  const [directory, setDirectory] = useState<DirectoryBatch[]>([]);
  const [directoryError, setDirectoryError] = useState("");
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [records, setRecords] = useState<OnlineClassRecord[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFilters] = useState({
    search: "",
    date: "",
    batch: "",
  });
  const [searchText, setSearchText] = useState("");
  const [batches, setBatches] = useState<string[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingMessage, setPendingMessage] = useState(false);
  const [preview, setPreview] = useState<OnlineClassRecord | null>(null);
  const [deleting, setDeleting] = useState<OnlineClassRecord | null>(null);

  const requestId = useRef("");
  const pending = useRef(false);
  const topicRef = useRef<HTMLInputElement>(null);
  const historyRefresh = useRef<HTMLButtonElement>(null);
  const loadSequence = useRef(0);

  const base = "/faculty-extra-incentives/my/online-classes";

  const load = useCallback(
    async (nextPage = 1) => {
      const sequence = ++loadSequence.current;

      setLoading(true);
      setError("");

      if (allClasses && nextPage === 1) {
        setRecords([]);
        setPage(1);
      }

      try {
        const query = new URLSearchParams({
          page: String(nextPage),
        });

        if (allClasses) {
          query.set("historyFilters", "true");

          Object.entries(filters).forEach(([key, value]) => {
            if (value) query.set(key, value);
          });
        } else {
          query.set("incentiveTypeId", incentiveTypeId);
        }

        const data = await call<Page>(
          `${base}?${query}`,
          "GET",
          null,
          token,
        );

        if (sequence !== loadSequence.current) return;

        setTeacherName(data.teacherName);
        setTotal(data.total ?? null);
        setBatches(data.batches || []);

        setRecords((current) =>
          nextPage === 1
            ? data.records
            : [...current, ...data.records],
        );

        setPage(nextPage);
        setHasMore(data.hasMore);
      } catch (err) {
        if (sequence === loadSequence.current) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load online classes.",
          );
        }
      } finally {
        if (sequence === loadSequence.current) {
          setLoading(false);
        }
      }
    },
    [token, incentiveTypeId, allClasses, filters],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Load the faculty's saved default Google Meet link.
  useEffect(() => {
    let active = true;

    const loadDefaultMeetUrl = async () => {
      try {
        const data = await call<{
          success: boolean;
          defaultMeetUrl: string | null;
        }>(
          "/faculty-extra-incentives/my/online-class-meet-link",
          "GET",
          null,
          token,
        );

        if (!active) return;

        const savedUrl = data.defaultMeetUrl || "";

        setDefaultMeetUrl(savedUrl);
        setDefaultMeetUrlDraft(savedUrl);

        // Never overwrite an existing class-specific URL.
        setForm((current) => ({
          ...current,
          meetUrl: current.meetUrl || savedUrl,
        }));
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load your default Google Meet link.",
          );
        }
      }
    };

    void loadDefaultMeetUrl();

    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    let active = true;

    const refresh = (reloadHistory = true) => {
      void call<{ batches: DirectoryBatch[] }>(
        "/faculty-extra-incentives/online-class-directory",
        "GET",
        null,
        token,
      )
        .then((data) => {
          if (active) {
            setDirectory(data.batches);
            setDirectoryError("");
          }
        })
        .catch((err) => {
          if (active) {
            setDirectoryError(
              err instanceof Error
                ? err.message
                : "Unable to load the batch directory.",
            );
          }
        })
        .finally(() => {
          if (active) {
            setDirectoryLoading(false);
          }
        });

      if (
        reloadHistory &&
        !pending.current &&
        document.visibilityState === "visible"
      ) {
        void load();
      }
    };

    refresh(false);

    const onFocus = () => refresh();
    const timer = setInterval(onFocus, 30000);

    window.addEventListener("focus", onFocus);

    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [token, load]);

  useEffect(() => {
    const timer = setTimeout(
      () =>
        setFilters((current) =>
          current.search === searchText
            ? current
            : { ...current, search: searchText },
        ),
      300,
    );

    return () => clearTimeout(timer);
  }, [searchText]);

  const field = (name: keyof typeof emptyForm, value: string) =>
    setForm((current) => ({
      ...current,
      [name]: value,
    }));

  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;

    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setMessage("");
    setPendingMessage(false);

    try {
      await work();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save online class.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
      onBusy(false);
    }
  };

  // Save or update the faculty's default Google Meet link.
  const saveDefaultMeetUrl = async () => {
    const value = defaultMeetUrlDraft.trim();

    let url: URL;

    try {
      url = new URL(value);
    } catch {
      setError("Enter a valid HTTPS Google Meet link.");
      return;
    }

    if (
      url.protocol !== "https:" ||
      url.hostname !== "meet.google.com" ||
      url.port ||
      url.username ||
      url.password ||
      !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)
    ) {
      setError("Enter a valid HTTPS Google Meet link.");
      return;
    }

    setDefaultMeetUrlBusy(true);
    setError("");
    setMessage("");

    try {
      const data = await call<{
        success: boolean;
        defaultMeetUrl: string;
      }>(
        "/faculty-extra-incentives/my/online-class-meet-link",
        "PATCH",
        { meetUrl: value },
        token,
      );

      const savedUrl = data.defaultMeetUrl;

      setDefaultMeetUrl(savedUrl);
      setDefaultMeetUrlDraft(savedUrl);
      setEditingDefaultMeetUrl(false);

      // Update the scheduling form only if it was using the old default.
      // An existing class-specific URL must remain untouched.
      setForm((current) => ({
        ...current,
        meetUrl:
          !editing &&
          (!current.meetUrl || current.meetUrl === defaultMeetUrl)
            ? savedUrl
            : current.meetUrl,
      }));

      setMessage("Default Google Meet link saved successfully.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save your default Google Meet link.",
      );
    } finally {
      setDefaultMeetUrlBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();

    if (
      !form.batchIds.length ||
      ![
        form.topic,
        form.date,
        form.startTime,
        form.meetUrl,
      ].every((value) => value.trim())
    ) {
      setError(
        "Select at least one active batch and complete all required class details.",
      );
      return;
    }

    let url: URL;

    try {
      url = new URL(form.meetUrl);
    } catch {
      setError("Enter a valid HTTPS Google Meet link.");
      return;
    }

    if (
      url.protocol !== "https:" ||
      url.hostname !== "meet.google.com" ||
      url.port ||
      url.username ||
      url.password ||
      !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)
    ) {
      setError("Enter a valid HTTPS Google Meet link.");
      return;
    }

    void run(async () => {
      if (!requestId.current) {
        requestId.current = crypto.randomUUID();
      }

      const result = await call<{
        record: OnlineClassRecord;
      }>(
        editing ? `${base}/${editing.id}` : base,
        editing ? "PATCH" : "POST",
        {
          ...form,
          incentiveTypeId: editing?.incentiveTypeId || incentiveTypeId,
          requestId: requestId.current,
          expectedUpdatedAt: editing?.updatedAt,
        },
        token,
      );

      setPreview(result.record);

      // Reset the form with the latest saved faculty default.
      setForm({
        ...emptyForm,
        meetUrl: defaultMeetUrl,
      });

      setEditing(null);
      requestId.current = "";

      setMessage("Class scheduled. No incentive has been added.");

      await load();
    });
  };

  const edit = (record: OnlineClassRecord) => {
    setEditing(record);
    setError("");
    setMessage("");

    setForm({
      batchName: record.batchName,
      batchIds: record.batchIds || [],
      topic: record.topic,
      message: record.message || "",
      date: localParts(record.startsAt).slice(0, 10),
      startTime: localParts(record.startsAt).slice(11, 16),

      // Preserve the URL saved with this particular class.
      meetUrl: record.meetUrl,
    });

    topicRef.current?.focus();
  };

  const action = (
    record: OnlineClassRecord,
    kind: "cancel" | "check",
  ) => {
    if (
      kind === "cancel" &&
      !window.confirm(
        "Cancel this class? Cancelled classes cannot receive an incentive.",
      )
    ) {
      return;
    }

    void run(async () => {
      const result = await call<{
        record: OnlineClassRecord;
      }>(
        `${base}/${record.id}/${kind}`,
        "POST",
        {},
        token,
      );

      if (editing?.id === record.id) {
        setEditing(null);
        setForm({
          ...emptyForm,
          meetUrl: defaultMeetUrl,
        });
      }

      setPendingMessage(
        kind === "check" &&
          Boolean(result.record.verificationPending),
      );

      setMessage(
        kind === "check"
          ? result.record.verificationStatus === "VERIFIED"
            ? "Google meeting verified. Its linked incentive is recorded."
            : result.record.verificationMessage ||
              result.record.verificationError ||
              "Meeting status checked. No incentive has been credited yet."
          : "Class cancelled. No incentive was added.",
      );

      if (
        kind === "check" &&
        result.record.verificationError &&
        !result.record.verificationPending
      ) {
        setMessage("");
        setError(result.record.verificationError);
      }

      await load();

      if (kind === "check") {
        await onChanged();
      }
    });
  };

  const removeClass = () => {
    if (!deleting) return;

    void run(async () => {
      await call(
        `${base}/${encodeURIComponent(deleting.id)}`,
        "DELETE",
        null,
        token,
      );

      if (editing?.id === deleting.id) {
        setEditing(null);
        setForm({
          ...emptyForm,
          meetUrl: defaultMeetUrl,
        });
      }

      if (preview?.id === deleting.id) {
        setPreview(null);
      }

      setDeleting(null);

      setMessage(
        "Class deleted. Its linked unpaid incentive, if any, was reversed.",
      );

      await load();
      await onChanged();

      requestAnimationFrame(() =>
        historyRefresh.current?.focus({
          preventScroll: true,
        }),
      );
    });
  };

  return (
    <>
      {allClasses ? (
        <GoogleAccountButton token={token} />
      ) : (
        <GoogleConnectionCard token={token} onBusy={onBusy} />
      )}

      {error ? (
        <div className="faculty-toast--error" role="alert">
          {error}
        </div>
      ) : null}

      {directoryError ? (
        <div className="faculty-toast--error" role="alert">
          {directoryError}
        </div>
      ) : null}

      {message ? (
        <p
          className={pendingMessage ? styles.muted : styles.success}
          role="status"
        >
          {message}
        </p>
      ) : null}

      <section className={allClasses ? pageStyles.formCard : undefined}>
        {allClasses ? (
          <div className={pageStyles.sectionHeading}>
            <h2>
              {editing ? "Edit Online Class" : "Schedule Online Class"}
            </h2>
            <span className={pageStyles.timezone}>
              IST · Asia/Kolkata
            </span>
          </div>
        ) : null}

        {/* Faculty Default Google Meet Link */}
        <div className="faculty-field faculty-field--wide">
          <span>Default Google Meet Link</span>

          {editingDefaultMeetUrl ? (
            <>
              <input
                type="url"
                value={defaultMeetUrlDraft}
                onChange={(event) =>
                  setDefaultMeetUrlDraft(event.target.value)
                }
                placeholder="https://meet.google.com/abc-defg-hij"
                disabled={defaultMeetUrlBusy || busy}
              />

              <div className="faculty-modal-actions">
                <button
                  type="button"
                  className="faculty-button faculty-button--ghost"
                  disabled={defaultMeetUrlBusy || busy}
                  onClick={() => {
                    setDefaultMeetUrlDraft(defaultMeetUrl);
                    setEditingDefaultMeetUrl(false);
                    setError("");
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="faculty-button faculty-button--primary"
                  disabled={
                    busy ||
                    defaultMeetUrlBusy ||
                    !defaultMeetUrlDraft.trim()
                  }
                  onClick={() => void saveDefaultMeetUrl()}
                >
                  {defaultMeetUrlBusy
                    ? "Saving..."
                    : "Save Default Link"}
                </button>
              </div>
            </>
          ) : (
            <div>
              <p>
                {defaultMeetUrl ||
                  "No default Google Meet link saved yet."}
              </p>

              <button
                type="button"
                className="faculty-button faculty-button--ghost"
                disabled={busy || defaultMeetUrlBusy}
                onClick={() => {
                  setDefaultMeetUrlDraft(defaultMeetUrl);
                  setEditingDefaultMeetUrl(true);
                  setError("");
                }}
              >
                {defaultMeetUrl
                  ? "Edit Default Link"
                  : "Add Default Link"}
              </button>
            </div>
          )}
        </div>

        <form
          className={`faculty-form-grid ${
            allClasses ? pageStyles.formGrid : ""
          }`}
          onSubmit={save}
        >
          <label className="faculty-field">
            <span>Teacher Name</span>
            <input
              readOnly
              value={
                teacherName ||
                (loading ? "Loading..." : "Unavailable")
              }
            />
          </label>

          <ClassDirectoryFields
            batches={directory}
            value={form}
            onChange={(selection) =>
              setForm((current) => ({
                ...current,
                ...selection,
              }))
            }
            loading={directoryLoading}
            error={directoryError}
            disabled={
              busy ||
              defaultMeetUrlBusy ||
              directoryLoading ||
              Boolean(directoryError)
            }
            existing={Boolean(editing)}
          />

          <label className="faculty-field">
            <span>Topic / Title</span>
            <input
              ref={topicRef}
              required
              maxLength={200}
              value={form.topic}
              onChange={(event) =>
                field("topic", event.target.value)
              }
              disabled={busy || defaultMeetUrlBusy}
            />
          </label>

          <label className="faculty-field faculty-field--wide">
            <span>Announcement (optional)</span>
            <textarea
              maxLength={2000}
              value={form.message}
              onChange={(event) =>
                field("message", event.target.value)
              }
              disabled={busy || defaultMeetUrlBusy}
            />
          </label>

          {allClasses ? (
            <ClassDateTimeFields
              date={form.date}
              startTime={form.startTime}
              disabled={busy || defaultMeetUrlBusy}
              onChange={field}
            />
          ) : (
            <>
              <label className="faculty-field">
                <span>Class Date (IST)</span>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(event) =>
                    field("date", event.target.value)
                  }
                  disabled={busy || defaultMeetUrlBusy}
                />
              </label>

              <div className="faculty-field">
                <span>Timezone</span>
                <strong>Asia/Kolkata (IST)</strong>
              </div>

              <label className="faculty-field">
                <span>Start Time (IST)</span>
                <input
                  type="time"
                  required
                  value={form.startTime}
                  onChange={(event) =>
                    field("startTime", event.target.value)
                  }
                  disabled={busy || defaultMeetUrlBusy}
                />
              </label>
            </>
          )}

          <label className="faculty-field faculty-field--wide">
            <span>Google Meet Link</span>
            <input
              type="url"
              required
              value={form.meetUrl}
              onChange={(event) =>
                field("meetUrl", event.target.value)
              }
              disabled={busy || defaultMeetUrlBusy}
            />
          </label>

          <div className="faculty-modal-actions faculty-field--wide">
            {editing ? (
              <button
                type="button"
                className="faculty-button faculty-button--ghost"
                disabled={busy || defaultMeetUrlBusy}
                onClick={() => {
                  setEditing(null);
                  setForm({
                    ...emptyForm,
                    meetUrl: defaultMeetUrl,
                  });
                }}
              >
                Cancel Edit
              </button>
            ) : null}

            <button
              type="submit"
              className="faculty-button faculty-button--primary"
              disabled={
                busy ||
                defaultMeetUrlBusy ||
                !teacherName
              }
            >
              {busy
                ? "Saving..."
                : editing
                  ? "Save Changes"
                  : "Save Class & Generate Message"}
            </button>
          </div>
        </form>
      </section>

      {preview ? (
        <section className={styles.section}>
          <h3>WhatsApp Message Preview</h3>

          <pre className={styles.preview}>
            {preview.announcement}
          </pre>

          <button
            type="button"
            className="faculty-button faculty-button--soft"
            onClick={() => {
              if (!navigator.clipboard) {
                setError(
                  "Unable to copy. Select and copy the preview text manually.",
                );
                return;
              }

              void navigator.clipboard
                .writeText(preview.announcement)
                .then(() =>
                  setMessage(
                    "Message copied. Paste it manually into your WhatsApp group.",
                  ),
                )
                .catch(() =>
                  setError(
                    "Unable to copy. Select and copy the preview text manually.",
                  ),
                );
            }}
          >
            <Copy size={16} /> Copy Message
          </button>
        </section>
      ) : null}

      <section
        className={allClasses ? pageStyles.history : styles.section}
      >
        <div className={styles.actions}>
          <h3>Your Online Classes</h3>

          <button
            ref={historyRefresh}
            type="button"
            className="faculty-button faculty-button--ghost"
            disabled={busy || loading}
            onClick={() => {
              setError("");
              void load();
            }}
          >
            <RotateCcw size={16} /> Refresh
          </button>
        </div>

        {allClasses ? (
          <>
            <div className={pageStyles.filters}>
              <label className="faculty-field">
                <span>Search Classes</span>

                <div className={pageStyles.inputIcon}>
                  <Search size={17} />

                  <input
                    type="search"
                    maxLength={200}
                    placeholder="Topic, batch or class date"
                    value={searchText}
                    onChange={(event) =>
                      setSearchText(event.target.value)
                    }
                    disabled={busy}
                  />
                </div>
              </label>

              <label className="faculty-field">
                <span>Date (IST)</span>
                <input
                  type="date"
                  value={filters.date}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                  disabled={busy}
                />
              </label>

              <label className="faculty-field">
                <span>Batch</span>

                <select
                  aria-label="Batch"
                  value={filters.batch}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      batch: event.target.value,
                    }))
                  }
                  disabled={busy}
                >
                  <option value="">All Batches</option>

                  {batches.map((batch) => (
                    <option key={batch} value={batch}>
                      {batch}
                    </option>
                  ))}

                  {loading && !batches.length ? (
                    <option disabled>
                      Loading batches...
                    </option>
                  ) : !batches.length ? (
                    <option disabled>
                      {error
                        ? "Unable to load batches"
                        : "No batches available"}
                    </option>
                  ) : null}
                </select>
              </label>

              <button
                type="button"
                className="faculty-button faculty-button--ghost"
                disabled={busy}
                onClick={() => {
                  setSearchText("");
                  setFilters({
                    search: "",
                    date: "",
                    batch: "",
                  });
                }}
              >
                <X size={16} /> Clear Filters
              </button>
            </div>

            {!loading && !error && total !== null ? (
              <p className={pageStyles.resultCount} role="status">
                {total} matching {total === 1 ? "class" : "classes"}
              </p>
            ) : null}
          </>
        ) : null}

        <OnlineClassRecords
          records={loading && page === 1 ? [] : records}
          token={token}
          busy={busy || loading}
          onEdit={edit}
          onAction={action}
          onPreview={setPreview}
          onDelete={allClasses ? setDeleting : undefined}
          enhanced={allClasses}
        />

        {loading ? (
          <p role="status">Loading online classes...</p>
        ) : !records.length && !error ? (
          <p className={allClasses ? pageStyles.empty : undefined}>
            {allClasses && Object.values(filters).some(Boolean)
              ? "No classes match these filters. Try another date or batch, or clear the filters."
              : "No online classes scheduled yet."}
          </p>
        ) : null}

        {hasMore ? (
          <button
            type="button"
            className="faculty-button faculty-button--ghost"
            disabled={busy || loading}
            onClick={() => void load(page + 1)}
          >
            Load More
          </button>
        ) : null}
      </section>

      {deleting ? (
        <Modal
          onClose={() => {
            if (!pending.current) {
              setDeleting(null);
            }
          }}
        >
          <section className={pageStyles.confirmation}>
            <h2>Delete Online Class?</h2>

            <p>
              <strong>{deleting.topic}</strong>
            </p>

            <p>
              This scheduled or cancelled class will be removed from
              your class records. Its linked unpaid incentive, if any,
              will also be reversed. Live, completed, paid or
              processing records cannot be deleted here.
            </p>

            {error ? (
              <p role="alert" className="faculty-toast--error">
                {error}
              </p>
            ) : null}

            <div>
              <button
                type="button"
                className="faculty-button faculty-button--ghost"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </button>

              <button
                type="button"
                className={`faculty-button ${pageStyles.deleteButton}`}
                disabled={busy}
                onClick={removeClass}
              >
                {busy ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </section>
        </Modal>
      ) : null}
    </>
  );
}
