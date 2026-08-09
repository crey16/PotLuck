import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { FLUSH_DELAY_MS, MAX_BATCH, VITALS_ENDPOINT } from "./report";
import { MAX_ENTRIES } from "./beacon";

/**
 * Guards the browser's reporting queue — M8.8A.
 *
 * `flush()` and `enqueue()` need `navigator`, `setTimeout` and `Blob` to do
 * anything, so what is tested here is the part that is wrong silently: the
 * caps, the endpoint, and the import boundary that keeps this module cheap
 * enough to sit in every route's bundle.
 */

test("the client's batch cap matches the collector's", () => {
  // The two constants are deliberately separate — see the import note in
  // `report.ts` — so this is what stops them drifting. A client batching more
  // than the server accepts would build a body guaranteed to be discarded, and
  // the metrics would simply stop arriving with nothing anywhere saying so.
  assert.equal(MAX_BATCH, MAX_ENTRIES);
});

test("the collector endpoint is not under /api", () => {
  // `/api/*` is rewritten to the Python function, so a Next route handler
  // there would never run.
  assert.equal(VITALS_ENDPOINT, "/perf/vitals");
});

test("the flush delay is long enough to batch and short enough to survive", () => {
  // Vitals arrive over several seconds; a delay under a second sends one
  // request per metric, and one much longer loses the batch to a tab close
  // that `pagehide` did not catch.
  assert.ok(FLUSH_DELAY_MS >= 1000 && FLUSH_DELAY_MS <= 10_000, String(FLUSH_DELAY_MS));
});

test("report.ts imports no VALUES from the validation modules", () => {
  // This is a bundle-size property, and it is worth 1.0 kB gzip on EVERY
  // route: a value import of `webVitals.ts` drags `route.ts`'s pattern tables
  // into the shared client bundle to be used by nothing, because the browser
  // sends a raw pathname and the server sanitizes it.
  const source = readFileSync(path.join(import.meta.dirname, "report.ts"), "utf8");
  const imports = [...source.matchAll(/^import\s+(type\s+)?.*from\s+"(\.\/[^"]+)"/gm)];
  for (const [line, isType, module] of imports) {
    if (module === "./webVitals" || module === "./beacon" || module === "./route") {
      assert.ok(isType, `report.ts must import only types from ${module}: ${line}`);
    }
  }
});

test("PerfReporter does not statically import the Web Vitals library", () => {
  const reporter = readFileSync(
    path.join(import.meta.dirname, "..", "..", "components", "perf", "PerfReporter.tsx"),
    "utf8"
  );
  assert.ok(!reporter.includes('from "next/web-vitals"'));
  assert.ok(!reporter.includes('from "@/lib/observability/webVitals"'));
});
