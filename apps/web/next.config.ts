import type { NextConfig } from "next";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  transpilePackages: ["@js/shared"],
  poweredByHeader: false,
  // The browser only ever talks to this origin; /api/* is forwarded to the Fastify API
  // so the session cookie stays first-party and no CORS is needed.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${apiUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
