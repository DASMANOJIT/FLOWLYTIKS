import Image from "next/image";
import Link from "next/link";
import CompanyLink from "../company/CompanyLink.jsx";

const merchantDetails = {
  businessType: "",
  registeredBusinessAddress: "",
};

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
                <span className="app-footer__title" id="footer-brand-title">
                  <CompanyLink type="flowlytiks" className="app-footer__nav-link" />
                </span>
                <p className="app-footer__subtitle">
                  <CompanyLink type="flowlytiks" className="app-footer__nav-link" /> is the
                  official student fee management portal of{" "}
                  <CompanyLink type="institute" className="app-footer__nav-link" />. It is used to
                  manage student records, monthly tuition fees, payment reminders and receipts
                  through a secure digital workflow. All student fee payments made through this
                  portal are collected by{" "}
                  <CompanyLink type="institute" className="app-footer__nav-link" /> and are
                  credited to the registered merchant bank account of the institute’s authorised
                  proprietor.
                </p>
                <p className="app-footer__subtitle">
                  <CompanyLink type="dmStackLabs" className="app-footer__nav-link" /> provides
                  software development and technical maintenance services only.{" "}
                  <CompanyLink type="dmStackLabs" className="app-footer__nav-link" />, Manojit Das
                  and Abhirup Mukherjee do not collect, receive or control any student fee
                  payments.
                </p>
              </div>
            </div>
          </section>

          <section className="app-footer__panel" aria-labelledby="footer-business-title">
            <p className="app-footer__section-title" id="footer-business-title">
              Merchant and Institute Details
            </p>
            <dl className="app-footer__detail-list">
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Institute Name</dt>
                <dd className="app-footer__detail-value">
                  <CompanyLink type="institute" className="app-footer__nav-link" />
                </dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Legal Merchant / Proprietor</dt>
                <dd className="app-footer__detail-value">Mr. Subhabrata Datta</dd>
              </div>
              {merchantDetails.businessType ? (
                <div className="app-footer__detail-item">
                  <dt className="app-footer__detail-term">Business Type</dt>
                  <dd className="app-footer__detail-value">{merchantDetails.businessType}</dd>
                </div>
              ) : null}
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Service Type</dt>
                <dd className="app-footer__detail-value">Computer education and tuition services</dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Platform Type</dt>
                <dd className="app-footer__detail-value">
                  Student fee management portal exclusively used by{" "}
                  <CompanyLink type="institute" className="app-footer__nav-link" />
                </dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Payment Use Case</dt>
                <dd className="app-footer__detail-value">
                  Monthly tuition fee collection from enrolled students of{" "}
                  <CompanyLink type="institute" className="app-footer__nav-link" />
                </dd>
              </div>
              {merchantDetails.registeredBusinessAddress ? (
                <div className="app-footer__detail-item">
                  <dt className="app-footer__detail-term">Registered Business Address</dt>
                  <dd className="app-footer__detail-value">
                    {merchantDetails.registeredBusinessAddress}
                  </dd>
                </div>
              ) : null}
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Merchant Contact Number</dt>
                <dd className="app-footer__detail-value">
                  <a
                    href="tel:+919831934306"
                    className="app-footer__nav-link"
                    aria-label="Call Subho’s Computer Institute"
                  >
                    9831934306
                  </a>
                </dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Merchant Email Address</dt>
                <dd className="app-footer__detail-value">
                  <a
                    href="mailto:subhoscomputerinstitute@gmail.com"
                    className="app-footer__nav-link"
                  >
                    subhoscomputerinstitute@gmail.com
                  </a>
                </dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Institute Website</dt>
                <dd className="app-footer__detail-value">
                  <CompanyLink type="institute" className="app-footer__nav-link" />
                </dd>
              </div>
              <div className="app-footer__detail-item">
                <dt className="app-footer__detail-term">Technology Provider</dt>
                <dd className="app-footer__detail-value">
                  <CompanyLink type="dmStackLabs" className="app-footer__nav-link" /> — software
                  development and technical maintenance only
                </dd>
              </div>
            </dl>
          </section>

          <section className="app-footer__panel" aria-labelledby="footer-support-title">
            <p className="app-footer__section-title" id="footer-support-title">
              Payment, Fee and Refund Support
            </p>
            <p className="app-footer__contact-label">
              <CompanyLink type="institute" className="app-footer__nav-link" />
            </p>
            <div className="app-footer__phones">
              <a
                href="tel:+919831934306"
                className="app-footer__nav-link"
                aria-label="Call Subho’s Computer Institute"
              >
                9831934306
              </a>
              <a
                href="mailto:subhoscomputerinstitute@gmail.com"
                className="app-footer__nav-link"
                aria-label="Email Subho’s Computer Institute"
              >
                subhoscomputerinstitute@gmail.com
              </a>
            </div>
            <p className="app-footer__panel-note">
              Support Hours: Monday–Friday, 8:00 AM–9:00 PM
            </p>
            <a
              href="mailto:subhoscomputerinstitute@gmail.com"
              className="app-footer__mail-button"
              aria-label="Email Subho’s Computer Institute"
            >
              Email Institute Support
            </a>
          </section>

          <section className="app-footer__panel" aria-labelledby="footer-technical-title">
            <p className="app-footer__section-title" id="footer-technical-title">
              Technical Support
            </p>
            <p className="app-footer__contact-label">
              <CompanyLink type="dmStackLabs" className="app-footer__nav-link" />
            </p>
            <a
              href="mailto:dmstacklabs@gmail.com"
              className="app-footer__nav-link"
              aria-label="Email DM Stack Labs technical support"
            >
              dmstacklabs@gmail.com
            </a>
            <p className="app-footer__panel-note">
              <CompanyLink type="dmStackLabs" className="app-footer__nav-link" /> handles technical
              issues related to accessing or using the web application only. It cannot approve
              refunds and does not collect or receive student fee payments.
            </p>
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
          <span>
            © <CompanyLink type="flowlytiks" className="app-footer__nav-link" /> 2026
          </span>
          <span>
            Developed and technically maintained by{" "}
            <CompanyLink type="dmStackLabs" className="app-footer__nav-link" />
          </span>
        </div>
      </div>
    </footer>
  );
}
