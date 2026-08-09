import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Solve files are immutable because their PATH is content-addressed — M8.8C.
   *
   * `scripts/sync-solve-pack.mjs` publishes the pack to
   * `/solves/<spot>/<fingerprint>/`, where the fingerprint is the first 16 hex
   * characters of the catalog's `content_hash` over the manifest, every flop
   * file, the preflop pack and the metadata. A republished pack therefore
   * lands on a different URL, and this one can never return different bytes.
   *
   * That ordering matters: `immutable` was correctly REJECTED while the files
   * lived at the mutable `/solves/<spot>/…`, because a browser holding a cached
   * flop file would have gone on serving stale solver output against a newer
   * grader for a year. The naming change is what earns the header.
   *
   * Only the fingerprinted depth is matched. A request to the old flat path
   * gets Next's default `public/` headers, so nothing that predates this can
   * be cached forever by accident.
   */
  async headers() {
    return [
      {
        source: "/solves/:spot/:fingerprint([0-9a-f]{16})/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Dev: proxy /api/* to the local uvicorn server (npm run api).
    //
    // The port is overridable via API_PORT because 8000 is a popular default —
    // if another local service already holds it, this rewrite silently sends
    // this app's API calls into that service, which is baffling to debug.
    // package.json's `api` / `api:bare` scripts read the same variable, so
    // `API_PORT=8011 npm run dev:all` moves both sides together.
    if (process.env.NODE_ENV === "development") {
      const apiPort = process.env.API_PORT ?? "8000";
      return [
        {
          source: "/api/:path*",
          destination: `http://127.0.0.1:${apiPort}/api/:path*`,
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
