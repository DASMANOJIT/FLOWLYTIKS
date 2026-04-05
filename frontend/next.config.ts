import type { NextConfig } from "next";

const normalizeBaseUrl = (value?: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
};

const toOriginIfAbsolute = (value?: string) => {
  const raw = normalizeBaseUrl(value);
  if (!raw || raw.startsWith("/")) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
};

const buildCsp = () => {
  const isProduction = process.env.NODE_ENV === "production";
  const connectSources = new Set(["'self'"]);

  [
    process.env.BACKEND_URL,
    process.env.NEXT_PUBLIC_BACKEND_URL,
    process.env.NEXT_PUBLIC_API_URL,
  ]
    .map(toOriginIfAbsolute)
    .filter(Boolean)
    .forEach((origin) => connectSources.add(origin));

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
    `connect-src ${[...connectSources].join(" ")}`,
    "form-action 'self'",
    "worker-src 'self' blob:",
  ];

  if (isProduction) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
};

const resolveBackendBaseUrl = () => {
  const configured =
    normalizeBaseUrl(process.env.BACKEND_URL) ||
    normalizeBaseUrl(process.env.NEXT_PUBLIC_BACKEND_URL);

  if (configured) {
    return configured;
  }

  const isRenderBuild = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
  if (process.env.NODE_ENV === "production" && isRenderBuild) {
    throw new Error(
      "BACKEND_URL (or NEXT_PUBLIC_BACKEND_URL) must be set for production frontend rewrites."
    );
  }

  return "http://localhost:5000";
};

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },

  async headers() {
    const headers = [
      {
        key: "Content-Security-Policy",
        value: buildCsp(),
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "Permissions-Policy",
        value:
          "camera=(), microphone=(), geolocation=(), browsing-topics=(), payment=(), usb=()",
      },
    ];

    if (process.env.NODE_ENV === "production") {
      headers.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },

  async rewrites() {
    const backend = resolveBackendBaseUrl();

    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
