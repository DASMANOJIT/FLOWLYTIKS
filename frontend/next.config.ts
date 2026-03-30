import type { NextConfig } from "next";

const normalizeBaseUrl = (value?: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
};

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },

  async rewrites() {
    const backend =
      normalizeBaseUrl(process.env.BACKEND_URL) ||
      normalizeBaseUrl(process.env.NEXT_PUBLIC_BACKEND_URL) ||
      "http://localhost:5000";

    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
