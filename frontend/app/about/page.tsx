import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { FileText, GraduationCap, Users, Video } from "lucide-react";
import CompanyLink from "../components/company/CompanyLink.jsx";
import styles from "./about.module.css";

const companyLinkProps = { className: undefined, children: undefined, ariaLabel: undefined };

export const metadata: Metadata = {
  title: "About Flowlytiks | Subho's Computer Institute",
  description: "Flowlytiks is the portal for Subho's Computer Institute, supporting fee records, receipts, staff follow-ups, faculty attendance and online classes.",
  alternates: { canonical: "https://www.flowlytiks.in/about" },
};

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}><Image src="/flow.png" alt="Flowlytiks logo" width={48} height={48} /><span>Flowlytiks</span></div>
          <Link href="/login" className={styles.button}>Go to Login</Link>
        </header>
        <section className={styles.intro} aria-labelledby="about-title">
          <span className={styles.eyebrow}>About the portal</span>
          <h1 id="about-title">About Flowlytiks</h1>
          <p><CompanyLink {...companyLinkProps} type="flowlytiks" /> is the portal for <CompanyLink {...companyLinkProps} type="institute" />. It brings student fee records and institute workflows together for authorized students, staff, faculty and administrators.</p>
          <Image src="/logo.png" alt="Subho's Computer Institute" width={480} height={180} className={styles.instituteLogo} />
        </section>
        <section className={styles.features} aria-label="Portal capabilities">
          <article><FileText aria-hidden="true" /><h2>Fee records &amp; receipts</h2><p>Students and administrators can view monthly fee records, payment status and receipts.</p></article>
          <article><Users aria-hidden="true" /><h2>Staff follow-ups</h2><p>Staff can record student follow-up notes, with saved history available to authorized staff and administrators.</p></article>
          <article><GraduationCap aria-hidden="true" /><h2>Faculty workflows</h2><p>Faculty attendance, work-ledger entries and individual incentives support the institute&apos;s existing administration and payout workflows.</p></article>
        </section>
        <section className={styles.section} aria-labelledby="google-title">
          <div className={styles.sectionHeading}><Video aria-hidden="true" /><h2 id="google-title">Optional Google connection for online classes</h2></div>
          <p>Faculty can voluntarily connect their Google account to support verification of scheduled online classes through Google Meet. The portal uses the connected account&apos;s identity and available conference records to check class completion, participant attendance and actual class duration.</p>
          <p>Verified attendance supports downloadable attendance PDF reports and online-class incentive records. Saving a schedule or sharing a class announcement does not itself create an incentive. Credit depends on the existing completion and attendance verification requirements.</p>
          <p>This connection is separate from signing in to Flowlytiks. Faculty can reconnect or disconnect their Google account using the portal&apos;s Google Account controls.</p>
        </section>
        <section className={styles.section} aria-labelledby="institute-title">
          <h2 id="institute-title">Institute &amp; technology provider</h2>
          <p><CompanyLink {...companyLinkProps} type="institute" /> provides computer education and tuition services. The legal merchant/proprietor is Mr. Subhabrata Datta.</p>
          <p>All student fee payments made through this portal are collected by <CompanyLink {...companyLinkProps} type="institute" /> and are credited to the registered merchant bank account of the institute&apos;s authorised proprietor.</p>
          <p><CompanyLink {...companyLinkProps} type="dmStackLabs" /> provides software development and technical maintenance services only. DM Stack Labs, Manojit Das and Abhirup Mukherjee do not collect, receive or control any student fee payments.</p>
          <Link href="/contact">Contact / Support</Link>
        </section>
        <nav className={styles.policies} aria-label="About page policies and access">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms &amp; Conditions</Link>
          <Link href="/contact">Contact / Support</Link>
          <Link href="/login" className={styles.button}>Go to Login</Link>
        </nav>
      </div>
    </div>
  );
}
