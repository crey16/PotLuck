import assert from "node:assert/strict";
import test from "node:test";

import { clsSummary, parseLogLines, samplesFromLogs } from "./perf-baseline";
import { groupSamples } from "../lib/observability/stats";

/**
 * Guards the baseline reader — M8.8A.
 *
 * The report is only as trustworthy as this parser. Every bug here is silent:
 * a dropped event kind removes a whole endpoint from the table, a merged key
 * pools two unrelated operations into one distribution, and a CLS score
 * counted as milliseconds puts a 0.04 in a latency column.
 */

const LOG = [
  "▲ Next.js 16.2.12",                                       // framework banner
  "",
  '{"evt":"next.request","rid":"aaaaaaaaaaaaaaaa-0","trace":"aaaaaaaaaaaaaaaa","route":"/","ms":12.4,"status":200}',
  '{"evt":"next.read","rid":"aaaaaaaaaaaaaaaa-0","trace":"aaaaaaaaaaaaaaaa","route":"/","name":"dashboard.stats","ms":180.2}',
  '{"evt":"api.request","rid":"aaaaaaaaaaaaaaaa-1","trace":"aaaaaaaaaaaaaaaa","route":"/api/progress/attempts","method":"POST","ms":94.1,"status":200,"cold":false}',
  '{"evt":"api.request","rid":"bbbbbbbbbbbbbbbb-0","trace":"bbbbbbbbbbbbbbbb","route":"/api/progress/attempts","method":"POST","ms":812.0,"status":200,"cold":true,"boot_ms":410.2}',
  '{"evt":"api.request","rid":"cccccccccccccccc-1","trace":"cccccccccccccccc","route":"/api/daily","method":"GET","ms":3.0,"status":500}',
  '{"evt":"web.vital","rid":"aaaaaaaaaaaaaaaa","trace":"aaaaaaaaaaaaaaaa","route":"/","name":"LCP","ms":1840}',
  '{"evt":"web.vital","rid":"aaaaaaaaaaaaaaaa","trace":"aaaaaaaaaaaaaaaa","route":"/","name":"CLS","value":0.031}',
  '{"evt":"web.nav","rid":"dddddddddddddddd","trace":"dddddddddddddddd","route":"/learn","ms":214.5,"name":"rendered"}',
  "not json at all",
  "{ broken json",
  '{"unrelated":"object"}',
].join("\n");

test("only instrumented lines are parsed; everything else is skipped", () => {
  const lines = parseLogLines(LOG);
  assert.equal(lines.length, 8);
  assert.ok(lines.every((line) => typeof line.evt === "string"));
});

test("a log with no instrumented lines yields an empty report, not a crash", () => {
  assert.deepEqual(parseLogLines("hello\nworld\n"), []);
  assert.deepEqual(samplesFromLogs([]), []);
  assert.deepEqual(groupSamples([]), []);
});

test("each event kind gets its own key space", () => {
  const keys = samplesFromLogs(parseLogLines(LOG)).map((s) => s.key);
  assert.ok(keys.includes("next.doc /"));
  assert.ok(keys.includes("read dashboard.stats"));
  assert.ok(keys.includes("api POST /api/progress/attempts"));
  assert.ok(keys.includes("vital LCP /"));
  assert.ok(keys.includes("nav /learn (rendered)"));
  // A Next read group and a FastAPI endpoint that happened to share a name
  // must never land in the same row.
  assert.equal(new Set(keys).size, keys.length - 1); // the two attempts rows share a key
});

test("the same endpoint at two hops is one row", () => {
  const reports = groupSamples(samplesFromLogs(parseLogLines(LOG)));
  const attempts = reports.find((r) => r.key === "api POST /api/progress/attempts");
  assert.ok(attempts);
  assert.equal(attempts.total, 2);
});

test("a cold FastAPI request is never pooled into the warm distribution", () => {
  const reports = groupSamples(samplesFromLogs(parseLogLines(LOG)));
  const attempts = reports.find((r) => r.key === "api POST /api/progress/attempts")!;
  assert.equal(attempts.warm.n, 1);
  assert.equal(attempts.warm.max, 94.1);
  assert.equal(attempts.cold.n, 1);
  assert.equal(attempts.cold.max, 812);
});

test("a 500 is counted as a failure and kept out of latency", () => {
  const reports = groupSamples(samplesFromLogs(parseLogLines(LOG)));
  const daily = reports.find((r) => r.key === "api GET /api/daily")!;
  assert.equal(daily.failures, 1);
  assert.equal(daily.errorRate, 1);
  // The fast 500 must not appear as a 3ms p50 that makes the endpoint look
  // like the healthiest thing in the table.
  assert.equal(daily.warm.n, 0);
  assert.equal(daily.warm.p50, null);
});

test("CLS is summarized apart from every duration", () => {
  const lines = parseLogLines(LOG);
  // It carries `value`, not `ms`, so the latency path cannot see it at all.
  assert.equal(
    samplesFromLogs(lines).some((s) => s.key.startsWith("vital CLS")),
    false
  );
  const cls = clsSummary(lines);
  assert.equal(cls.get("/")?.n, 1);
  assert.equal(cls.get("/")?.max, 0.031);
});

test("a line missing its duration is skipped rather than counted as zero", () => {
  const samples = samplesFromLogs([
    { evt: "api.request", route: "/api/x", method: "GET" },
    { evt: "api.request", route: "/api/x", method: "GET", ms: 10 },
  ]);
  assert.equal(samples.length, 1);
});

test("a line with an error field is a failure even at a 200", () => {
  const [sample] = samplesFromLogs([
    { evt: "next.read", name: "learn.path", ms: 40, error: "TypeError" },
  ]);
  assert.equal(sample.failed, true);
});

test("percentiles from the ingested sample obey the confidence floors", () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    evt: "api.request",
    route: "/api/x",
    method: "GET",
    ms: i + 1,
    status: 200,
  }));
  const [report] = groupSamples(samplesFromLogs(many));
  assert.equal(report.warm.n, 25);
  assert.equal(report.warm.confidence, "full");
  assert.equal(report.warm.p50, 13);
  assert.equal(report.warm.p95, 24);
  assert.equal(report.warm.p95Reliable, true);

  const few = many.slice(0, 6);
  const [small] = groupSamples(samplesFromLogs(few));
  assert.equal(small.warm.confidence, "p50");
  assert.equal(small.warm.p95Reliable, false, "p95 must not be quoted at n=6");
});
