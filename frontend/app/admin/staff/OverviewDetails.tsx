"use client";
import { useRef } from "react";
import { useModalDialog } from "../../components/ui/Modal";
import { X } from "lucide-react";
import styles from "./staffOverview.module.css";

export default function OverviewDetails({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useModalDialog(dialog);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="staff-overview-detail-title" onCancel={event => { event.preventDefault(); onClose(); }}><header className={styles.detailHeader}><h2 id="staff-overview-detail-title">{title}</h2><button onClick={onClose} aria-label="Close details"><X size={20} /></button></header>{children}</dialog>;
}
