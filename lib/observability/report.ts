"use client";

/**
 * The browser's outbound path for measurements — M8.8A.
 *
 * Split out of the component so the queueing and batching rules are testable
 * without a DOM, and so `components/perf/PerfReporter.tsx` stays a few lines of
 * effect wiring.
 *
 * ## Why a queue at all
 *
 * The six Web Vitals do not arrive together. TTFB and FCP land within a few
 * hundred milliseconds; LCP settles at the first interaction; CLS and INP are
 * only final when the page is hidden. One request per metric would be six
 * requests per page load, on a connection the page is otherwise trying to keep
 * free. So metrics accumulate and flush on a timer, on `visibilitychange`, and
 * on `pagehide`.
 *
 * ## Why `sendBeacon`, and what happens when it is missing
 *
 * `navigator.sendBeacon` is queued by the browser and survives the page being
 * torn down, which is the only way the final CLS and INP ever get reported —
 * a `fetch` issued from `pagehide` is cancelled with the document. It is also
 * fire-and-forget: no response to parse, no promise the page waits on, and it
 * cannot delay a navigation.
 *
 * `fetch(..., { keepalive: true })` is the fallback, which is the same
 * guarantee by a different name. If neither exists the metrics are dropped
 * silently — this is instrumentation, and it has no business raising an error
 * in someone's poker session.
 *
 * ## What is deliberately NOT here
 *
 * No retry, no persistence across reloads, no dead-letter queue. A dropped
 * beacon costs one sample out of many; a retry loop on an unauthenticated
 * endpoint costs a request storm from a page that is already failing.
 */

// Types only — a value import here would pull `webVitals.ts` and, through it,
// `route.ts`'s pattern tables into the shared client bundle on EVERY route,
// to be used by nothing: the browser sends a raw pathname and the collector
// sanitizes it server-side. Measured at 1.0 kB gzip per route before this was
// split, which is most of what this file was costing.
import type { VitalPayload } from "./webVitals";
import type { NavPayload } from "./beacon";

/**
 * Cap on entries per beacon. Duplicated from `beacon.ts`'s `MAX_ENTRIES` for
 * the reason above, and pinned to it by `report.test.ts` — a client that
 * batched more than the collector accepts would build a body guaranteed to be
 * discarded.
 */
export const MAX_BATCH = 12;

/** Collector path. Not under `/api` — that prefix is rewritten to FastAPI. */
export const VITALS_ENDPOINT = "/perf/vitals";

/** How long a metric may wait for company before being sent. */
export const FLUSH_DELAY_MS = 3000;

type QueueEntry = VitalPayload | NavPayload;

let queue: QueueEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Send whatever has accumulated. Safe to call when the queue is empty, when
 * the page is being unloaded, and in a non-browser environment.
 */
export function flush(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];

  const body = JSON.stringify(batch);
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // `text/plain` avoids a CORS preflight. Same-origin here, so it changes
      // nothing today, but a preflight on a `pagehide` beacon is a round trip
      // the browser will not wait for — the report would simply vanish.
      navigator.sendBeacon(VITALS_ENDPOINT, new Blob([body], { type: "text/plain" }));
      return;
    }
    if (typeof fetch === "function") {
      void fetch(VITALS_ENDPOINT, {
        method: "POST",
        body,
        keepalive: true,
        headers: { "Content-Type": "text/plain" },
      }).catch(() => {
        // Reporting a measurement must never surface as an error to the user.
      });
    }
  } catch {
    // Same.
  }
}

/**
 * Add one measurement.
 *
 * Flushes immediately at `MAX_BATCH` rather than growing: the collector rejects
 * anything larger, so an unbounded queue would build a body that is guaranteed
 * to be thrown away.
 */
export function enqueue(entry: QueueEntry): void {
  queue.push(entry);
  if (queue.length >= MAX_BATCH) {
    flush();
    return;
  }
  if (timer === null) {
    timer = setTimeout(flush, FLUSH_DELAY_MS);
  }
}

/** Test seam. */
export function __queueSizeForTest(): number {
  return queue.length;
}

/** Test seam. */
export function __resetQueueForTest(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  queue = [];
}
