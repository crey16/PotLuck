import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Dev: proxy /api/* to the local uvicorn server (npm run api).
    if (process.env.NODE_ENV === "development") {
      return [
        {
          source: "/api/:path*",
          destination: "http://127.0.0.1:8000/api/:path*",
        },
      ];
    }
    // Production (Vercel): file-based routing only exposes the Python function
    // at its file path, /api/index. Rewrite every /api/* request to it — the
    // rewrite selects which function runs, but the ASGI app still receives the
    // ORIGINAL path, so FastAPI's /api-prefixed routes match. This is the
    // pattern from Vercel's nextjs-fastapi template; without it /api/* falls
    // through to Next and 404s.
    return [
      {
        source: "/api/:path*",
        destination: "/api/index",
      },
    ];
  },
};

export default nextConfig;
