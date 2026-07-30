import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiOrigin } from "./apiOrigin";

test("uses the public request domain on Vercel", () => {
  assert.equal(
    resolveApiOrigin(
      {
        VERCEL: "1",
        VERCEL_PROJECT_PRODUCTION_URL: "potluck-poker.vercel.app",
      },
      {
        host: "potluck-poker.vercel.app",
        protocol: "https",
      }
    ),
    "https://potluck-poker.vercel.app"
  );
});

test("normalizes proxy header lists", () => {
  assert.equal(
    resolveApiOrigin(
      { VERCEL: "1" },
      { host: "preview.example.com, internal.example", protocol: "https, http" }
    ),
    "https://preview.example.com"
  );
});

test("falls back to Vercel's stable production domain", () => {
  assert.equal(
    resolveApiOrigin({
      VERCEL: "1",
      VERCEL_PROJECT_PRODUCTION_URL: "potluck-poker.vercel.app",
    }),
    "https://potluck-poker.vercel.app"
  );
});

test("uses the standalone FastAPI port in local development", () => {
  assert.equal(
    resolveApiOrigin({ API_PORT: "8123" }, { host: "localhost:3000", protocol: "http" }),
    "http://127.0.0.1:8123"
  );
});

test("rejects malformed host headers", () => {
  assert.equal(
    resolveApiOrigin(
      { VERCEL: "1", VERCEL_PROJECT_PRODUCTION_URL: "potluck-poker.vercel.app" },
      { host: "example.com/redirect", protocol: "https" }
    ),
    "https://potluck-poker.vercel.app"
  );
});
