import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Service Unavailable — Flowlytiks',
  description: 'This service is temporarily suspended.',
};

export default function SuspendedPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)',
        color: '#ffffff',
        padding: '2rem',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        textAlign: 'center',
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: '96px',
          height: '96px',
          borderRadius: '50%',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '2px solid rgba(239, 68, 68, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '2rem',
          animation: 'pulse 2s infinite',
        }}
      >
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ef4444"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>

      {/* Badge */}
      <span
        style={{
          display: 'inline-block',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          color: '#f87171',
          fontSize: '0.75rem',
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          padding: '0.3rem 0.9rem',
          borderRadius: '999px',
          marginBottom: '1.5rem',
        }}
      >
        Service Suspended
      </span>

      {/* Heading */}
      <h1
        style={{
          fontSize: 'clamp(1.75rem, 4vw, 2.75rem)',
          fontWeight: 700,
          lineHeight: 1.2,
          marginBottom: '1rem',
          background: 'linear-gradient(135deg, #ffffff 0%, #94a3b8 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        Service Temporarily Unavailable
      </h1>

      {/* Description */}
      <p
        style={{
          color: '#94a3b8',
          fontSize: '1.05rem',
          maxWidth: '480px',
          lineHeight: 1.7,
          marginBottom: '2.5rem',
        }}
      >
        This website has been temporarily suspended due to a billing or configuration issue.
        If you are the site owner, please contact your administrator to restore access.
      </p>

      {/* Divider */}
      <div
        style={{
          width: '60px',
          height: '2px',
          background: 'linear-gradient(90deg, transparent, rgba(148,163,184,0.4), transparent)',
          marginBottom: '2rem',
        }}
      />

      {/* Footer note */}
      <p style={{ color: '#475569', fontSize: '0.8rem' }}>
        Powered by{' '}
        <span style={{ color: '#6366f1', fontWeight: 600 }}>Flowlytiks</span>
      </p>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.97); }
        }
      `}</style>
    </div>
  );
}