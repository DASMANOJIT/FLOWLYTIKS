import styles from "../legal-page.module.css";
import LegalBackButton from "../components/legal/LegalBackButton.jsx";

export default function ContactPage() {
  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <LegalBackButton />
        <header className={styles.hero}>
          <span className={styles.badge}>Contact &amp; Support</span>
          <h1 className={styles.title}>Contact Flowlytiks</h1>
          <p className={styles.intro}>
            Reach out for support, feedback, onboarding questions, or payment-related coordination
            for institutes using Flowlytiks.
          </p>
        </header>

        <div className={styles.grid}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Business Details</h2>
            <div className={styles.detailGrid}>
              <div className={styles.detailRow}>
                <p className={styles.detailLabel}>Product</p>
                <p className={styles.detailValue}>Flowlytiks Fee Management Web App</p>
              </div>
              <div className={styles.detailRow}>
                <p className={styles.detailLabel}>Operated By</p>
                <p className={styles.detailValue}>DM Stack Labs</p>
              </div>
              <div className={styles.detailRow}>
                <p className={styles.detailLabel}>Founder</p>
                <p className={styles.detailValue}>Manojit Das</p>
              </div>
              <div className={styles.detailRow}>
                <p className={styles.detailLabel}>Website</p>
                <p className={styles.detailValue}>
                  <a
                    className={styles.link}
                    href="https://www.flowlytiks.in"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    https://www.flowlytiks.in
                  </a>
                </p>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Support Channels</h2>
            <div className={styles.detailGrid}>
              <div className={styles.detailRow}>
                <p className={styles.detailLabel}>Email</p>
                <p className={styles.detailValue}>
                  <a className={styles.link} href="mailto:dmstacklabs@gmail.com">
                    dmstacklabs@gmail.com
                  </a>
                </p>
              </div>
              <div className={styles.detailRow}>
                <p className={styles.detailLabel}>Phone</p>
                <p className={styles.detailValue}>
                  <a className={styles.link} href="tel:8617759263">
                    8617759263
                  </a>{" "}
                  /{" "}
                  <a className={styles.link} href="tel:7003751561">
                    7003751561
                  </a>
                </p>
              </div>
              <div className={styles.detailRow}>
                <p className={styles.detailLabel}>Support Hours</p>
                <p className={styles.detailValue}>Monday to Saturday, 10:00 AM – 7:00 PM</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
