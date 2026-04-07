import Image from "next/image";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="app-footer" aria-label="Site footer">
      <div className="app-footer__inner">
        <div className="app-footer__grid">
          <section className="app-footer__panel app-footer__panel--brand">
            <div className="app-footer__brand">
              <Image
                src="/flow.png"
                alt="Flowlytiks logo"
                width={56}
                height={56}
                className="app-footer__logo"
              />
              <div className="app-footer__brand-copy">
                <span className="app-footer__title">Flowlytiks</span>
                <p className="app-footer__subtitle">
                  Smart fee operations and secure tuition payments for modern institutes.
                </p>
                <p className="app-footer__credits-text">
                  Developed and maintained by{" "}
                  <a
                    href="https://www.dmstacklabs.in/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="app-footer__nav-link"
                  >
                    DM Stack Labs
                  </a>
                </p>
              </div>
            </div>
          </section>

          <section className="app-footer__panel">
            <p className="app-footer__section-title">Support &amp; Feedback</p>
            <p className="app-footer__contact-label">
              Share feedback, report issues, or raise complaints and our team will help you out.
            </p>
            <a href="mailto:dmstacklabs@gmail.com" className="app-footer__nav-link">
              dmstacklabs@gmail.com
            </a>
            <p className="app-footer__panel-note">
              We welcome suggestions, issue reports, and formal complaints.
            </p>
          </section>

          <section className="app-footer__panel">
            <p className="app-footer__section-title">Contact</p>
            <div className="app-footer__phones">
              <a href="tel:8617759263" className="app-footer__nav-link">
                8617759263
              </a>
              <a href="tel:7003751561" className="app-footer__nav-link">
                7003751561
              </a>
            </div>
            <a href="mailto:dmstacklabs@gmail.com" className="app-footer__mail-button">
              Mail Us
            </a>
          </section>
        </div>

        <div className="app-footer__bottom">
          <span>© Flowlytiks {currentYear}</span>
          <span>All rights reserved</span>
        </div>
      </div>
    </footer>
  );
}
