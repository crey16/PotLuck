/**
 * The structured server log — M8.8A.
 *
 * One JSON object per line on stdout. That format is not a preference: Vercel's
 * runtime log drain is line-oriented, and there is no log agent, sidecar or
 * collector in this architecture to parse anything richer. A line is also what
 * `scripts/perf-baseline.ts --ingest` reads, so the debugging format and the
 * baseline format are the same format — there is no second path to keep
 * correct.
 *
 * ## What may be logged, and how that is enforced
 *
 * `PerfEvent` is a closed shape. It is closed rather than `Record<string,
 * unknown>` on purpose: an open field bag is how a session token, an email or
 * a raw `?next=` ends up in a log line six months from now, added by someone
 * debugging something urgent. Adding a field here is a deliberate edit with a
 * reviewer.
 *
 * `route` is a bounded key from `routeKey()` (never a URL, never a query
 * string). `rid` is a request id, which by construction is random and carries
 * no identity. There is no field for a user id, a token, a cookie or a body —
 * `log.test.ts` reads this module's own source and fails if one appears, the
 * same technique `lib/content/publicContent.test.ts` uses.
 *
 * ## Cost
 *
 * `serverLog` is a `console.log` of a small object. It runs after a response is
 * decided and never on the render path of anything a user waits for. It is off
 * by default in tests (`PERF_LOG=0`) so a suite does not print a thousand lines.
 */

import type { Confidence } from "./stats";

/** Which boundary emitted the line. */
export type PerfEventKind =
  /** Next middleware saw a document request. */
  | "next.request"
  /** A named group of server-side Supabase reads finished. */
  | "next.read"
  /** A browser Web Vital arrived at the collector. */
  | "web.vital"
  /** A client-side route transition completed. */
  | "web.nav";

export interface PerfEvent {
  evt: PerfEventKind;
  /** Full request id, `<trace>-<hop>`. */
  rid: string;
  /** Join key across boundaries. */
  trace: string;
  /** Bounded route pattern. Never a URL. */
  route: string;
  /** Duration in milliseconds, from one monotonic clock. */
  ms?: number;
  /**
   * A measurement that is NOT a duration. Only CLS uses it today: CLS is a
   * unitless cumulative score in the hundredths, and writing 0.04 into a field
   * called `ms` would put it in the same column as a 400ms TTFB for anything
   * summing by name. Separate fields is the cheapest way to make that mistake
   * impossible.
   */
  value?: number;
  status?: number;
  /** Metric or read-group name — a compile-time constant at every call site. */
  name?: string;
  /** True when this observation hit a process that had served nothing yet. */
  cold?: boolean;
  /** Set when a read group or request failed. A short reason, never a payload. */
  error?: string;
}

/**
 * Logging is opt-out in development and opt-in elsewhere.
 *
 * Vercel bills and rate-limits log volume, and this project has no sampling
 * infrastructure, so production defaults to quiet and is switched on
 * deliberately for a measurement window by setting `PERF_LOG=1`. That is also
 * the honest answer to "why is the production table empty": nobody turned it
 * on, rather than a silent drop.
 */
export function perfLoggingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.PERF_LOG;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return env.NODE_ENV === "development";
}

type Sink = (line: string) => void;

let sink: Sink = (line) => {
  console.log(line);
};

/** Test seam. Returns the previous sink so a test can restore it. */
export function setPerfSink(next: Sink): Sink {
  const previous = sink;
  sink = next;
  return previous;
}

/**
 * Serialize an event. Extracted from the emit path so the shape can be tested
 * without capturing stdout, and so a malformed event is caught here rather
 * than inside a `console.log` nobody reads.
 *
 * Non-finite durations are dropped rather than serialized: `NaN` is not valid
 * JSON and `JSON.stringify` would silently write `null`, which reads as "0ms"
 * to anything summing the column.
 */
export function formatPerfEvent(event: PerfEvent): string {
  const out: Record<string, string | number | boolean> = {
    evt: event.evt,
    rid: event.rid,
    trace: event.trace,
    route: event.route,
  };
  if (typeof event.ms === "number" && Number.isFinite(event.ms)) {
    // Sub-millisecond precision is noise from a shared clock; a tenth is the
    // most this is entitled to claim.
    out.ms = Math.round(event.ms * 10) / 10;
  }
  if (typeof event.value === "number" && Number.isFinite(event.value)) {
    out.value = Math.round(event.value * 1000) / 1000;
  }
  if (typeof event.status === "number" && Number.isFinite(event.status)) {
    out.status = event.status;
  }
  if (event.name) out.name = event.name;
  if (event.cold !== undefined) out.cold = event.cold;
  // Truncated: an error message is a hint for a human, not a payload, and an
  // unbounded one is both a log-cost and a disclosure risk.
  if (event.error) out.error = event.error.slice(0, 120);
  return JSON.stringify(out);
}

export function serverLog(event: PerfEvent): void {
  if (!perfLoggingEnabled()) return;
  try {
    sink(formatPerfEvent(event));
  } catch {
    // Instrumentation must never be able to fail a request it is measuring.
  }
}

/** Shared vocabulary for anything rendering a `Confidence` to a human. */
export const CONFIDENCE_NOTE: Record<Confidence, string> = {
  none: "smoke only — too few samples for any percentile",
  p50: "median usable; p95 is the maximum at this sample size",
  full: "p50 and p95 both meaningful",
};
