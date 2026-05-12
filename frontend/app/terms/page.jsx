import styles from "../legal-page.module.css";

export default function TermsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.hero}>
          <span className={styles.badge}>Terms &amp; Conditions</span>
          <h1 className={styles.title}>Terms of Service</h1>
          <p className={styles.intro}>
            These terms govern access to and use of Flowlytiks, a fee management web application
            operated by DM Stack Labs for tutors, coaching centers, and educational institutes.
          </p>
        </header>

        <div className={styles.grid}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Platform Usage</h2>
            <p className={styles.sectionBody}>
              Flowlytiks is provided to help institutes manage students, monthly fees, payment
              records, reminders, and receipts. By using the platform, you agree to provide
              accurate information, use the service lawfully, and protect the confidentiality of
              your account credentials.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Accounts &amp; Responsibility</h2>
            <ul className={styles.list}>
              <li>Admins are responsible for data entered by their institute staff.</li>
              <li>Students are responsible for keeping login and OTP details secure.</li>
              <li>Unauthorized access, abuse, or misuse of the platform may result in suspension.</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Payments &amp; Records</h2>
            <p className={styles.sectionBody}>
              Flowlytiks records fee payments and related status information based on institute
              operations and supported payment workflows. Institutes remain responsible for the
              accuracy of student fee schedules, due amounts, and manual payment entries.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Support</h2>
            <p className={styles.sectionBody}>
              For support, feedback, or complaints, contact{" "}
              <a className={styles.link} href="mailto:dmstacklabs@gmail.com">
                dmstacklabs@gmail.com
              </a>
              . Support hours are Monday to Saturday, 10:00 AM to 7:00 PM.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
