import type { NextConfig } from "next";

const API_ORIGIN = process.env.HAYAT_API_ORIGIN ?? "http://127.0.0.1:8100";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@hayat/api-client"],
  poweredByHeader: false,
  // The browser talks only to this origin; /api is proxied to Django so the session
  // cookie stays first-party, HttpOnly and SameSite (ADR-003).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
