import styles from "../legal-page.module.css";
import LegalBackButton from "../components/legal/LegalBackButton.jsx";

export default function RefundCancellationPage() {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <LegalBackButton />
        <header className={styles.hero}>
          <span className={styles.badge}>Refund &amp; Cancellation Policy</span>
          <h1 className={styles.title}>Refund &amp; Cancellation Policy</h1>
          <p className={styles.intro}>
            This policy outlines how refund and cancellation matters are handled for student fee
            payments managed through Flowlytiks.
          </p>
        </header>

        <div className={styles.grid}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Fee Payments</h2>
            <p className={styles.sectionBody}>
              Student fee payments are recorded according to the institute&apos;s fee schedule and
              payment status maintained within Flowlytiks. Any refund or cancellation request is
              subject to the institute&apos;s review, applicable payment records, and payment gateway
              processing rules where relevant.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Manual Review</h2>
            <ul className={styles.list}>
              <li>Refund requests should include the student name, month, and payment reference.</li>
              <li>Institutes may verify dues, credits, and prior adjustments before approving a refund.</li>
              <li>Approved refunds, where applicable, may depend on gateway timelines and bank processing.</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Support Contact</h2>
            <p className={styles.sectionBody}>
              For refund or cancellation assistance, contact{" "}
              <a className={styles.link} href="mailto:dmstacklabs@gmail.com">
                dmstacklabs@gmail.com
              </a>{" "}
              or call{" "}
              <a className={styles.link} href="tel:8617759263">
                8617759263
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
