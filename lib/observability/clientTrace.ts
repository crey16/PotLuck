"use client";

/**
 * The browser half of one logical trace — M8.8A.
 *
 * ## The problem this solves
 *
 * After M8.8C there is no server-to-server hop left in this app: the browser
 * fetches FastAPI directly, and the Next server never calls its own public API
 * (commit `ddab0e6` removed the last one). So nothing on the server can carry
 * an id from the document render into the XHRs that follow it. **The browser is
 * the only place that knows those requests belong together**, and it is
 * therefore where the trace has to be held.
 *
 * ## How the id gets here
 *
 * Next middleware mints the document's request id and writes it into the
 * request headers the render sees. `app/layout.tsx` reads it and passes it to
 * `PerfReporter`, which calls `adoptTrace()` during hydration. From then on
 * every authenticated `fetch` in this app sends `<same trace>-<n>`, so the
 * document line and the API lines share a `trace` and differ by hop.
 *
 * ## Why a client route transition mints a NEW trace
 *
 * A soft navigation is a different user action. Keeping the original trace
 * would put every request of a twenty-minute session under one key, which is
 * the "one browser action creates unrelated traces" failure in reverse and
 * just as useless. `startNavigationTrace()` rolls it, so `/learn`'s reads join
 * `/learn`'s navigation and not the load of `/` half an hour earlier.
 *
 * ## Before hydration
 *
 * `currentTrace` starts null. A fetch that somehow beats `adoptTrace` mints a
 * standalone trace rather than sending nothing — an unjoined line is a small
 * loss, a missing line is a hole in the baseline. That branch is expected to be
 * rare, and it is visible: such a trace has no `next.request` line.
 */

import { newTraceId, REQUEST_ID_HEADER, requestIdFor, isValidRequestId } from "./requestId";

let currentTrace: string | null = null;
let hop = 0;

/**
 * Adopt the document's trace. Ignores anything malformed — the value crosses a
 * header and a prop, and a bad one must not become a log key.
 */
export function adoptTrace(requestId: string | null | undefined): void {
  if (!isValidRequestId(requestId)) return;
  // The document is hop 0; the browser's own requests continue from 1.
  const cut = requestId.lastIndexOf("-");
  const trace = cut > 0 && /^\d{1,4}$/.test(requestId.slice(cut + 1))
    ? requestId.slice(0, cut)
    : requestId;
  currentTrace = trace;
  hop = 0;
}

/** Roll to a fresh trace for a new user action. Returns it. */
export function startNavigationTrace(): string {
  currentTrace = newTraceId();
  hop = 0;
  return currentTrace;
}

/** The trace in force, minting one if hydration has not run yet. */
export function currentTraceId(): string {
  if (currentTrace === null) currentTrace = newTraceId();
  return currentTrace;
}

/** The next request id on this trace. Every call advances the hop. */
export function nextRequestId(): string {
  return requestIdFor(currentTraceId(), ++hop);
}

/**
 * Headers to merge into a `fetch` so the call joins the current trace.
 *
 * Returned as a plain object rather than a `Headers` so it spreads into the
 * existing `{ Authorization, "Content-Type", ...init.headers }` literals at the
 * five call sites without changing their shape.
 */
export function traceHeaders(): Record<string, string> {
  return { [REQUEST_ID_HEADER]: nextRequestId() };
}

/** Test seam — resets module state between cases. */
export function __resetTraceForTest(): void {
  currentTrace = null;
  hop = 0;
}
