import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_P50_SAMPLES,
  MIN_P95_SAMPLES,
  cleanSorted,
  formatBytes,
  formatMs,
  groupSamples,
  percentile,
  summarize,
} from "./stats";

/**
 * Guards M8.8A's arithmetic.
 *
 * Everything M8.8A produces is a percentile over a small sample, so a wrong
 * rank function or a silently-pooled cold start does not fail loudly — it
 * produces a plausible number that a later milestone gets held to. These tests
 * are the reason the baseline can be believed.
 */

test("nearest-rank percentiles are exact on a known sample", () => {
  // 1..10. Nearest rank: index = ceil(q·10), 1-based.
  const values = [10, 3, 7, 1, 9, 5, 2, 8, 4, 6];
  assert.equal(percentile(values, 0), 1);
  assert.equal(percentile(values, 0.1), 1);
  assert.equal(percentile(values, 0.5), 5);
  assert.equal(percentile(values, 0.51), 6);
  assert.equal(percentile(values, 0.9), 9);
  assert.equal(percentile(values, 0.95), 10);
  assert.equal(percentile(values, 1), 10);
});

test("a percentile is always an observed value, never an interpolation", () => {
  // Two far-apart values: an interpolating implementation would answer 55 for
  // the median. Nearest-rank must answer a number that was measured.
  const values = [10, 100];
  assert.equal(percentile(values, 0.5), 10);
  assert.equal(percentile(values, 0.95), 100);
});

test("percentiles of one sample are that sample", () => {
  assert.equal(percentile([42], 0.5), 42);
  assert.equal(percentile([42], 0.95), 42);
});

test("an empty sample has no percentile", () => {
  assert.equal(percentile([], 0.5), null);
  const summary = summarize([]);
  assert.equal(summary.n, 0);
  assert.equal(summary.p50, null);
  assert.equal(summary.p95, null);
  assert.equal(summary.confidence, "none");
});

test("q is clamped, so a caller cannot index out of the array", () => {
  assert.equal(percentile([1, 2, 3], -5), 1);
  assert.equal(percentile([1, 2, 3], 9), 3);
});

test("below the floor, no percentile is reported at all", () => {
  const summary = summarize([1, 2, 3, 4]);
  assert.equal(summary.n, 4);
  assert.equal(summary.confidence, "none");
  assert.equal(summary.p50, null);
  assert.equal(summary.p95, null);
  // Order statistics still mean what they say at n=4.
  assert.equal(summary.min, 1);
  assert.equal(summary.max, 4);
});

test("between the floors, p50 is reported and p95 is flagged unreliable", () => {
  const values = Array.from({ length: MIN_P50_SAMPLES }, (_, i) => i + 1);
  const summary = summarize(values);
  assert.equal(summary.confidence, "p50");
  assert.equal(summary.p50, 3);
  assert.equal(summary.p95Reliable, false);
  // The specific reason it is unreliable: at n<20 nearest-rank p95 IS the max.
  assert.equal(summary.p95, summary.max);
});

test("MIN_P95_SAMPLES is exactly the size at which p95 can differ from max", () => {
  // Below 20, ceil(0.95·n) === n for every n. At 20 it is 19.
  for (let n = 1; n < MIN_P95_SAMPLES; n += 1) {
    assert.equal(Math.ceil(0.95 * n), n, `n=${n}`);
  }
  assert.equal(Math.ceil(0.95 * MIN_P95_SAMPLES), MIN_P95_SAMPLES - 1);

  const values = Array.from({ length: MIN_P95_SAMPLES }, (_, i) => i + 1);
  const summary = summarize(values);
  assert.equal(summary.confidence, "full");
  assert.equal(summary.p95Reliable, true);
  assert.equal(summary.p95, 19);
  assert.equal(summary.max, 20);
  assert.notEqual(summary.p95, summary.max);
});

test("non-finite values are dropped, not allowed to poison the sample", () => {
  const values = [1, NaN, 2, Infinity, 3, -Infinity, 4, "x" as unknown as number, 5];
  assert.deepEqual(cleanSorted(values), [1, 2, 3, 4, 5]);
  const summary = summarize(values);
  // n reports what SURVIVED, so a reader can see the discard.
  assert.equal(summary.n, 5);
  assert.equal(summary.mean, 3);
  assert.equal(summary.max, 5);
});

test("a sample of only garbage summarizes as empty rather than throwing", () => {
  const summary = summarize([NaN, Infinity, undefined as unknown as number]);
  assert.equal(summary.n, 0);
  assert.equal(summary.confidence, "none");
});

test("cold and warm are never pooled into one distribution", () => {
  const samples = [
    { key: "/", ms: 800, cold: true },
    ...Array.from({ length: 10 }, () => ({ key: "/", ms: 50 })),
  ];
  const [report] = groupSamples(samples);
  assert.equal(report.warm.n, 10);
  assert.equal(report.warm.max, 50, "the 800ms cold start must not be in warm");
  assert.equal(report.cold.n, 1);
  assert.equal(report.cold.max, 800);
});

test("failures are counted, never timed", () => {
  const samples = [
    ...Array.from({ length: 8 }, () => ({ key: "/api/x", ms: 40, status: 200 })),
    { key: "/api/x", ms: 3, status: 500, failed: true },
    { key: "/api/x", ms: 9000, status: 500, failed: true },
  ];
  const [report] = groupSamples(samples);
  assert.equal(report.total, 10);
  assert.equal(report.failures, 2);
  assert.equal(report.errorRate, 0.2);
  // Neither the fast 500 nor the slow one moved the latency picture.
  assert.equal(report.warm.n, 8);
  assert.equal(report.warm.max, 40);
  assert.equal(report.warm.min, 40);
  assert.equal(report.statuses["500"], 2);
  assert.equal(report.statuses["200"], 8);
});

test("statuses record redirects so a signed-out run cannot pass as signed-in", () => {
  const samples = Array.from({ length: 6 }, () => ({ key: "/", ms: 12, status: 307 }));
  const [report] = groupSamples(samples);
  assert.equal(report.statuses["307"], 6);
  assert.equal(report.failures, 0, "a redirect is an outcome, not a failure");
});

test("grouping tolerates malformed samples", () => {
  const reports = groupSamples([
    null as never,
    { ms: 1 } as never,
    { key: "/ok", ms: 5 },
  ]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].key, "/ok");
});

test("formatters never print a fake number for a missing one", () => {
  assert.equal(formatMs(null), "—");
  assert.equal(formatBytes(null), "—");
  assert.equal(formatMs(4.25), "4.3ms");
  assert.equal(formatMs(1234.6), "1235ms");
  assert.equal(formatBytes(512), "512B");
  assert.equal(formatBytes(2048), "2.0kB");
});
