import styles from "../legal-page.module.css";

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <span className={styles.badge}>Privacy Policy</span>
          <h1 className={styles.title}>Privacy Policy</h1>
          <p className={styles.intro}>
            This policy explains how Flowlytiks collects, uses, and protects operational data for
            institutes, admins, and students using the platform.
          </p>
        </header>

        <div className={styles.grid}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Information We Use</h2>
            <ul className={styles.list}>
              <li>Student and admin profile details needed to operate the platform.</li>
              <li>Fee schedules, payment status, receipts, and reminder records.</li>
              <li>Support and communication details used to respond to issues and requests.</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>How Information Is Used</h2>
            <p className={styles.sectionBody}>
              Platform data is used to manage institute operations, authenticate users, track fee
              activity, generate receipts, and support payment-related workflows. We do not publish
              private student or institute information publicly.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Data Protection</h2>
            <p className={styles.sectionBody}>
              We apply reasonable technical and administrative measures to protect account,
              student, and payment-related data. Access is limited to authorized users and
              operational support processes.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Contact</h2>
            <p className={styles.sectionBody}>
              For privacy-related questions, email{" "}
              <a className={styles.link} href="mailto:dmstacklabs@gmail.com">
                dmstacklabs@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
