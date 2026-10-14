import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import styles from "./BackToDashboard.module.css";

export default function BackToDashboard({ href = "/admin", label = "Back to Dashboard" }: { href?: string; label?: string } = {}) {
  return <Link href={href} className={styles.link}><ArrowLeft size={19} aria-hidden="true" /><span>{label}</span></Link>;
}
