const COMPANY_LINKS = {
  flowlytiks: {
    label: "Flowlytiks",
    href: "https://www.flowlytiks.in",
  },
  institute: {
    label: "Subho’s Computer Institute",
    href: "https://subhoscomputerinstitute.com",
  },
  dmStackLabs: {
    label: "DM Stack Labs",
    href: "https://dmstacklabs.in",
  },
};

export default function CompanyLink({ type, className, children, ariaLabel }) {
  const company = COMPANY_LINKS[type];
  if (!company) return children || null;

  return (
    <a
      href={company.href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={ariaLabel}
    >
      {children || company.label}
    </a>
  );
}
