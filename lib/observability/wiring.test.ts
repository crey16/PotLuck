import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { REQUEST_ID_HEADER } from "./requestId";
import { VITALS_ENDPOINT } from "./report";

/**
 * Guards that M8.8A is actually wired up — not merely written.
 *
 * Every module in this directory can be perfect and the milestone still
 * deliver nothing, because instrumentation only exists at the boundaries that
 * call it. These are source-level checks: a unit test cannot run Next
 * middleware, but it can prove middleware still mints the id, still forwards
 * it, and still excludes the collector from the auth path.
 */

const root = path.join(import.meta.dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

test("middleware mints the request id and echoes it on the response", () => {
  const source = read("middleware.ts");
  assert.match(source, /resolveRequestId\(request\.headers\.get\(REQUEST_ID_HEADER\)\)/);
  assert.match(source, /response\.headers\.set\(REQUEST_ID_HEADER, requestId\)/);
});

test("middleware forwards the id and the route onto the render's headers", () => {
  // Without this the server reads have nothing to attach themselves to and the
  // root layout has nothing to hand the browser — the trace would stop at the
  // edge and every line would be its own island.
  const source = read("middleware.ts");
  assert.match(source, /updateSession\(request, \{/);
  assert.match(source, /\[REQUEST_ID_HEADER\]: requestId/);
  assert.match(source, /"x-perf-route": route/);

  const supabase = read("lib", "supabase", "middleware.ts");
  assert.match(supabase, /extraRequestHeaders\?: Record<string, string>/);
  // Rebuilt at each `NextResponse.next`, never snapshotted: the cookie header
  // is mutated in between by the session refresh, and forwarding a stale copy
  // is the logged-out-on-refresh bug.
  const nextCalls = supabase.match(/NextResponse\.next\([^;]*?\);/g) ?? [];
  assert.ok(nextCalls.length >= 2, "expected the supabase double-response pattern");
  for (const call of nextCalls) {
    assert.match(call, /forwardedHeaders\(\)/, call);
  }
});

test("the collector path is excluded from the auth middleware", () => {
  // A beacon has no session to refresh. Running the Supabase check on it would
  // make the measurement endpoint cost more than most of what it measures.
  const source = read("middleware.ts");
  const matcher = /matcher: \[([\s\S]*?)\]/.exec(source)?.[1] ?? "";
  assert.ok(
    matcher.includes("perf/vitals"),
    "middleware must not intercept the vitals collector"
  );
  assert.ok(matcher.includes("api"), "FastAPI must still own /api/*");
});

test("the collector lives outside /api, which is rewritten to Python", () => {
  // `next.config.ts` sends every `/api/:path*` to the Python function, so a
  // Next route handler under `/api` would never run.
  assert.ok(!VITALS_ENDPOINT.startsWith("/api"), VITALS_ENDPOINT);
  const config = read("next.config.ts");
  assert.match(config, /source: "\/api\/:path\*"/);
  // And the handler exists at exactly that path.
  assert.ok(read("app", "perf", "vitals", "route.ts").includes("export async function POST"));
});

test("the root layout hands the browser the id it was rendered under", () => {
  const layout = read("app", "layout.tsx");
  assert.match(layout, /headers\(\)\)\.get\(REQUEST_ID_HEADER\)/);
  assert.match(layout, /<PerfReporter requestId=\{requestId\} \/>/);
});

test("the Web Vitals collector is loaded lazily, not into every route's first paint", () => {
  // M8.8C took 63.5 kB gzipped off first paint. A monitoring feature that put
  // a few kB back on every route would be spending the result to observe it.
  const reporter = read("components", "perf", "PerfReporter.tsx");
  assert.match(reporter, /dynamic\(\s*\(\) => import\("\.\/VitalsCollector"\)/);
  assert.match(reporter, /ssr: false/);
  // And the dependency itself is only reachable through that boundary.
  assert.ok(!reporter.includes("next/web-vitals"));
  assert.ok(read("components", "perf", "VitalsCollector.tsx").includes("next/web-vitals"));
});

test("no analytics SDK was added for this milestone", () => {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
  };
  const forbidden = [
    "web-vitals",
    "@vercel/analytics",
    "@vercel/speed-insights",
    "@sentry/nextjs",
    "posthog-js",
    "mixpanel-browser",
  ];
  for (const name of forbidden) {
    assert.ok(!(name in pkg.dependencies), `${name} must not be a dependency`);
  }
  // Web Vitals come from `next/web-vitals`, which ships with the framework
  // already installed here.
  assert.ok("next" in pkg.dependencies);
});

test("the server read groups that matter are actually timed", () => {
  // Named here rather than inferred, so removing an instrumentation point is a
  // test change and not a silent hole in the baseline.
  const expected: Array<[string, string[]]> = [
    ["dashboard.stats", ["lib", "drill", "serverStats.ts"]],
    ["drill.kindStats", ["lib", "drill", "serverStats.ts"]],
    ["placement.routing", ["lib", "placement", "server.ts"]],
    ["learn.path", ["lib", "learn", "server.ts"]],
    ["learn.module", ["lib", "learn", "server.ts"]],
    ["learn.lesson", ["lib", "learn", "server.ts"]],
    ["learn.recommendation", ["lib", "learn", "server.ts"]],
    ["layout.headerProfile", ["app", "layout.tsx"]],
    ["social.leaderboard", ["components", "social", "LeaderboardPanel.tsx"]],
  ];
  for (const [name, file] of expected) {
    assert.ok(
      read(...file).includes(`"${name}"`),
      `${file.join("/")} no longer times ${name}`
    );
  }
});

test("the header name is one constant, used everywhere", () => {
  assert.equal(REQUEST_ID_HEADER, "x-request-id");
  // A literal at a call site is how two layers end up disagreeing about the
  // header while both look correct in isolation.
  for (const file of [
    ["middleware.ts"],
    ["app", "layout.tsx"],
    ["lib", "observability", "clientTrace.ts"],
  ]) {
    const source = read(...file);
    assert.ok(source.includes("REQUEST_ID_HEADER"), file.join("/"));
    assert.ok(
      !/["']x-request-id["']/.test(source),
      `${file.join("/")} hard-codes the header name instead of importing it`
    );
  }
});
