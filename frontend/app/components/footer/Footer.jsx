import Image from "next/image";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="app-footer" aria-label="Site footer">
      <div className="app-footer__inner">
        <div className="app-footer__grid">
          <section className="app-footer__panel app-footer__panel--brand" aria-labelledby="footer-brand-title">
            <div className="app-footer__brand">
              <Image
                src="/flow.png"
                alt="Flowlytiks logo"
                width={56}
                height={56}
                className="app-footer__logo"
              />
              <div className="app-footer__brand-copy">
                <span className="app-footer__title" id="footer-brand-title">Flowlytiks</span>
                <p className="app-footer__subtitle">
                  Flowlytiks is a fee management web application created and operated by{" "}
                  <a
                    href="https://dmstacklabs.in"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="app-footer__nav-link"
                    aria-label="Visit DM Stack Labs website"
                  >
                    DM Stack Labs
                  </a>
                  , a web development company founded by Manojit Das in 2025. Flowlytiks helps
                  tutors, coaching centers, and educational institutes manage students, monthly
                  fees, payments, reminders, and receipts in a simple digital workflow.
                </p>
              </div>
            </div>
          </section>

          <section className="app-footer__panel" aria-labelledby="footer-business-title">
            <p className="app-footer__section-title" id="footer-business-title">Business Details</p>
            <dl className="app-footer__detail-list">
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Product</dt>
                <dd className="app-footer__detail-value">Flowlytiks Fee Management Web App</dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Operated By</dt>
                <dd className="app-footer__detail-value">DM Stack Labs</dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Founder</dt>
                <dd className="app-footer__detail-value">Manojit Das</dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Website</dt>
                <dd className="app-footer__detail-value">
                  <a
                    href="https://www.flowlytiks.in"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="app-footer__nav-link"
                    aria-label="Visit Flowlytiks website"
                  >
                    https://www.flowlytiks.in
                  </a>
                </dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Service Type</dt>
                <dd className="app-footer__detail-value">
                  SaaS platform for tutors and educational institutes
                </dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Payment Use Case</dt>
                <dd className="app-footer__detail-value">
                  Student fee collection and institute/vendor payment management
                </dd>
              </div>
            </dl>
          </section>

          <section className="app-footer__panel" aria-labelledby="footer-support-title">
            <p className="app-footer__section-title" id="footer-support-title">Support &amp; Feedback</p>
            <p className="app-footer__contact-label">
              Share feedback, report issues, or raise complaints. Our team will review and
              respond as soon as possible.
            </p>
            <a
              href="mailto:dmstacklabs@gmail.com"
              className="app-footer__nav-link"
              aria-label="Email DM Stack Labs support"
            >
              dmstacklabs@gmail.com
            </a>
            <p className="app-footer__panel-note">
              Support Hours: Monday to Saturday, 10:00 AM – 7:00 PM
            </p>
          </section>

          <section className="app-footer__panel" aria-labelledby="footer-contact-title">
            <p className="app-footer__section-title" id="footer-contact-title">Contact</p>
            <div className="app-footer__phones">
              <a
                href="tel:8617759263"
                className="app-footer__nav-link"
                aria-label="Call 8617759263"
              >
                8617759263
              </a>
              <a
                href="tel:7003751561"
                className="app-footer__nav-link"
                aria-label="Call 7003751561"
              >
                7003751561
              </a>
            </div>
            <a
              href="mailto:dmstacklabs@gmail.com"
              className="app-footer__mail-button"
              aria-label="Email DM Stack Labs"
            >
              Mail Us
            </a>
          </section>

          <section className="app-footer__panel" aria-labelledby="footer-legal-title">
            <p className="app-footer__section-title" id="footer-legal-title">Legal &amp; Policies</p>
            <div className="app-footer__nav-group">
              <Link href="/terms" className="app-footer__nav-link">
                Terms &amp; Conditions
              </Link>
              <Link href="/privacy" className="app-footer__nav-link">
                Privacy Policy
              </Link>
              <Link href="/refund-cancellation" className="app-footer__nav-link">
                Refund &amp; Cancellation Policy
              </Link>
              <Link href="/contact" className="app-footer__nav-link">
                Contact / Support
              </Link>
            </div>
          </section>
        </div>

        <div className="app-footer__bottom">
          <span>© Flowlytiks 2026</span>
          <span>
            Created &amp; operated by{" "}
            <a
              href="https://dmstacklabs.in"
              target="_blank"
              rel="noopener noreferrer"
              className="app-footer__nav-link"
              aria-label="Visit DM Stack Labs website"
            >
              DM Stack Labs
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
