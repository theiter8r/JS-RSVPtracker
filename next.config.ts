import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The response pages must never be cached by a CDN or a corporate proxy:
  // every visitor's page is personalised by token.
  async headers() {
    return [
      {
        source: "/r/:token",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
