import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BODY_BYTES,
  MAX_ENTRIES,
  RateLimiter,
  normalizeBeaconBatch,
  parseBeaconBody,
} from "./beacon";
import { CWV_THRESHOLDS, VITAL_NAMES, normalizeVitalPayload, rateVital } from "./webVitals";

/**
 * Guards the one endpoint M8.8A adds to the public surface.
 *
 * `POST /perf/vitals` is unauthenticated by necessity — a signed-out visitor's
 * TTFB on `/login` is exactly the number that matters most — so every field it
 * will ever log is attacker-controlled. These tests are what makes that
 * acceptable.
 */

const validVital = { name: "LCP", route: "/learn", value: 1234.5 };

test("a well-formed metric survives", () => {
  const payload = normalizeVitalPayload(validVital);
  assert.deepEqual(payload, { name: "LCP", route: "/learn", value: 1234.5 });
});

test("an unknown metric name is rejected, never logged under its own key", () => {
  for (const name of ["", "lcp", "LCP2", "__proto__", "x".repeat(200), 1, null]) {
    assert.equal(normalizeVitalPayload({ ...validVital, name }), null, String(name));
  }
});

test("every name the collector accepts has a threshold", () => {
  for (const name of VITAL_NAMES) {
    assert.ok(CWV_THRESHOLDS[name], name);
    // CLS is unitless and bounded far lower than the millisecond metrics, so
    // the probe value has to be one that is plausible for every name.
    assert.ok(normalizeVitalPayload({ ...validVital, name, value: 0.05 }), name);
  }
});

test("non-finite and absurd values are rejected, not clamped", () => {
  // Clamping would turn an injected 1e308 into a real-looking maximum sitting
  // at the top of the p95 column.
  for (const value of [NaN, Infinity, -Infinity, -1, 1e308, "500", null, undefined]) {
    assert.equal(normalizeVitalPayload({ ...validVital, value }), null, String(value));
  }
  assert.equal(normalizeVitalPayload({ ...validVital, value: 121_000 }), null);
  assert.ok(normalizeVitalPayload({ ...validVital, value: 119_000 }));
});

test("CLS has its own, much smaller bound", () => {
  assert.ok(normalizeVitalPayload({ name: "CLS", route: "/", value: 0.04 }));
  assert.equal(normalizeVitalPayload({ name: "CLS", route: "/", value: 50 }), null);
});

test("the route is sanitized even when the caller asks for something else", () => {
  const payload = normalizeVitalPayload({
    ...validVital,
    route: "/u/alice?token=secret",
  });
  assert.equal(payload?.route, "/u/[username]");
  const other = normalizeVitalPayload({ ...validVital, route: "/wp-admin/x" });
  assert.equal(other?.route, "/other");
  const missing = normalizeVitalPayload({ name: "LCP", value: 1 });
  assert.equal(missing?.route, "/other");
});

test("a malformed request id is dropped rather than becoming a log key", () => {
  assert.equal(
    normalizeVitalPayload({ ...validVital, requestId: "bad id\nevt=fake" })?.requestId,
    undefined
  );
  assert.equal(
    normalizeVitalPayload({ ...validVital, requestId: "9f3c1a04b7e25d68" })?.requestId,
    "9f3c1a04b7e25d68"
  );
});

test("garbage input never crashes the normalizer", () => {
  for (const input of [null, undefined, 0, "", [], "string", true, () => {}]) {
    assert.doesNotThrow(() => normalizeVitalPayload(input));
    assert.equal(normalizeVitalPayload(input as unknown), null);
  }
});

test("one bad entry does not destroy the batch around it", () => {
  const batch = normalizeBeaconBatch([
    validVital,
    { name: "NONSENSE", value: 1 },
    { name: "CLS", route: "/play", value: 0.02 },
  ]);
  assert.equal(batch.length, 2);
});

test("a batch is capped", () => {
  const batch = normalizeBeaconBatch(
    Array.from({ length: 100 }, () => validVital)
  );
  assert.equal(batch.length, MAX_ENTRIES);
});

test("a nav entry is validated on its own terms", () => {
  const [nav] = normalizeBeaconBatch([
    { kind: "nav", route: "/learn/3/12", ms: 210.44, outcome: "rendered" },
  ]);
  assert.deepEqual(nav, {
    kind: "nav",
    route: "/learn/[moduleId]/[lessonId]",
    ms: 210.4,
    outcome: "rendered",
  });
  // An unknown outcome would let a caller invent a category in the report.
  assert.equal(
    normalizeBeaconBatch([{ kind: "nav", route: "/", ms: 1, outcome: "great" }]).length,
    0
  );
  // Ten minutes is not a route transition.
  assert.equal(
    normalizeBeaconBatch([{ kind: "nav", route: "/", ms: 700_000, outcome: "rendered" }]).length,
    0
  );
});

test("a body that is not JSON, is empty, or is oversized yields nothing", () => {
  assert.deepEqual(parseBeaconBody(""), []);
  assert.deepEqual(parseBeaconBody("not json"), []);
  assert.deepEqual(parseBeaconBody("{"), []);
  assert.deepEqual(parseBeaconBody("x".repeat(MAX_BODY_BYTES + 1)), []);
  assert.equal(parseBeaconBody(JSON.stringify([validVital])).length, 1);
});

test("a deeply nested payload is not walked", () => {
  // JSON.parse handles the nesting; the normalizer must simply not find the
  // fields it needs and drop the entry, rather than recursing anywhere.
  let nested: unknown = validVital;
  for (let i = 0; i < 500; i += 1) nested = { child: nested };
  assert.doesNotThrow(() => normalizeBeaconBatch([nested]));
  assert.equal(normalizeBeaconBatch([nested]).length, 0);
});

test("rating thresholds follow the published Core Web Vitals bands", () => {
  assert.equal(rateVital("LCP", 2500), "good");
  assert.equal(rateVital("LCP", 2501), "needs-improvement");
  assert.equal(rateVital("LCP", 4001), "poor");
  assert.equal(rateVital("CLS", 0.1), "good");
  assert.equal(rateVital("CLS", 0.26), "poor");
  assert.equal(rateVital("INP", 200), "good");
});

/* --------------------------------------------------------- rate limiting */

test("the limiter admits up to the limit and then refuses", () => {
  const now = 0;
  const limiter = new RateLimiter(3, 1000, () => now);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  // A different caller is unaffected — one noisy client must not silence the
  // measurement for everyone else.
  assert.equal(limiter.allow("b"), true);
});

test("the window rolls", () => {
  let now = 0;
  const limiter = new RateLimiter(1, 1000, () => now);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  now = 1000;
  assert.equal(limiter.allow("a"), true);
});

test("a key flood cannot grow the limiter without bound", () => {
  let now = 0;
  const limiter = new RateLimiter(10, 60_000, () => now);
  let admitted = 0;
  for (let i = 0; i < 10_000; i += 1) {
    if (limiter.allow(`spoofed-${i}`)) admitted += 1;
  }
  // Bounded by the key cap, not by the number of distinct addresses claimed.
  assert.ok(admitted <= 2048, `admitted ${admitted}`);
  // And it recovers on the next window rather than staying wedged.
  now = 60_000;
  assert.equal(limiter.allow("a-real-caller"), true);
});
