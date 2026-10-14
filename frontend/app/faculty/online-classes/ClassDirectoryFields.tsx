"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import styles from "./batch-selector.module.css";

export type DirectoryBatch = { id: string; name: string; isActive: boolean };
export type DirectorySelection = { batchIds: string[]; batchName: string };

export default function ClassDirectoryFields({ batches, value, onChange, disabled, loading = false, error = "", existing = false }: {
  batches: DirectoryBatch[]; value: DirectorySelection; onChange: (selection: DirectorySelection) => void; disabled?: boolean; loading?: boolean; error?: string; existing?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    const element = panel.current;
    if (!open || disabled || !element) return;
    element.showPopover();
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0;
      const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
      const below = topEdge + height - rect.bottom - 16, above = rect.top - topEdge - 16;
      const down = below >= Math.min(280, above);
      const panelWidth = Math.min(Math.max(rect.width, 260), width - 24);
      element.style.width = `${panelWidth}px`;
      element.style.left = `${Math.max(leftEdge + 12, Math.min(rect.left, leftEdge + width - panelWidth - 12))}px`;
      element.style.maxHeight = `${Math.max(100, Math.min(360, down ? below : above))}px`;
      element.style.top = `${down ? rect.bottom + 6 : Math.max(topEdge + 12, rect.top - element.getBoundingClientRect().height - 6)}px`;
    };
    position(); searchInput.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }); } };
    const focus = (event: FocusEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard, true);
    document.addEventListener("focusin", focus);
    window.addEventListener("resize", position); window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      if (element.matches(":popover-open")) element.hidePopover();
      document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keyboard, true); document.removeEventListener("focusin", focus);
      window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); window.visualViewport?.removeEventListener("resize", position);
    };
  }, [open, disabled]);
  const selected = new Set(value.batchIds);
  const change = (batchId: string) => onChange({ ...value, batchIds: selected.has(batchId) ? value.batchIds.filter(item => item !== batchId) : [...value.batchIds, batchId] });
  const options = batches.filter(batch => batch.isActive && batch.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div ref={root} className={styles.selector}>
    <label id={`${id}-label`}>Batches <small>(select one or more)</small></label>
    <button ref={trigger} type="button" className={styles.trigger} disabled={disabled} aria-labelledby={`${id}-label ${id}-summary`} aria-expanded={open && !disabled} aria-controls={`${id}-panel`} aria-haspopup="dialog" onClick={() => { setSearch(""); setOpen(current => !current); }} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}>
      <span id={`${id}-summary`}>{loading ? "Loading batches..." : error ? "Batches unavailable" : value.batchIds.length ? `${value.batchIds.length} ${value.batchIds.length === 1 ? "batch" : "batches"} selected` : "Select batches"}</span><ChevronDown size={17} />
    </button>
    {value.batchIds.length ? <div className={styles.chips}>{value.batchIds.map(batchId => <button key={batchId} type="button" disabled={disabled} onClick={() => change(batchId)} aria-label={`Remove ${batches.find(batch => batch.id === batchId)?.name || "batch"}`}>
      <span>{batches.find(batch => batch.id === batchId)?.name || "Unavailable batch"}</span><X size={14} aria-hidden="true" />
    </button>)}</div> : null}
    <div ref={panel} popover="manual" id={`${id}-panel`} role="dialog" aria-label="Choose batches" className={styles.panel}>
      <label htmlFor={id} className={styles.searchLabel}>Search batches</label>
      <input ref={searchInput} id={id} type="search" placeholder="Search batches" value={search} onChange={event => setSearch(event.target.value)} />
      <div className={styles.options}>{options.map(batch => <label key={batch.id}><input type="checkbox" checked={selected.has(batch.id)} onChange={() => change(batch.id)} /><span>{batch.name}</span></label>)}{!options.length ? <p role="status">{loading ? "Loading batches..." : error ? "Unable to load batches." : batches.some(batch => batch.isActive) ? "No active batches match." : "No active batches available."}</p> : null}</div>
      <button type="button" className={styles.done} onClick={close}>Done</button>
    </div>
    {existing && !value.batchIds.length && value.batchName ? <small>Legacy batch: {value.batchName}. Select an active batch to save changes; historical details are retained.</small> : null}
  </div>;
}
