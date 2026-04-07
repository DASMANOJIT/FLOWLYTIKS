"use client";

import Image from "next/image";

export default function Footer() {
  return (
    <footer className="app-footer" aria-label="Site footer">
      <div className="app-footer__inner">
        <div className="app-footer__brand">
          <Image
            src="/flow.png"
            alt="Flowlytiks logo"
            width={44}
            height={44}
            className="app-footer__logo"
          />
          <div className="app-footer__brand-copy">
            <span className="app-footer__title">Flowlytiks</span>
            <p className="app-footer__subtitle">
              Developed and maintained by{" "}
              <a
                href="https://www.dmstacklabs.in/"
                target="_blank"
                rel="noopener noreferrer"
              >
                DM Stack Labs
              </a>
            </p>
          </div>
        </div>

        <div className="app-footer__contact">
          <span className="app-footer__contact-label">For feedback or complaints:</span>
          <a href="mailto:dmstacklabs@gmail.com">dmstacklabs@gmail.com</a>
          <div className="app-footer__phones">
            <a href="tel:8617759263">8617759263</a>
            <a href="tel:7003751561">7003751561</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
