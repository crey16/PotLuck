/**
 * Browser measurements, and the boundary that has to distrust them — M8.8A.
 *
 * `POST /perf/vitals` is unauthenticated. It has to be: TTFB and LCP for
 * `/login` are exactly the numbers a signed-out visitor produces, and gating
 * the collector on a session would leave the first page anyone ever sees
 * unmeasured. That makes the body attacker-controlled, so nothing in it is
 * trusted:
 *
 * - `name` must be one of six known metrics. Anything else is rejected, not
 *   recorded under its own key — an open name field is an unbounded log-key
 *   space handed to the internet.
 * - `route` goes through `routeKey()`, which drops the query string and
 *   collapses dynamic segments. A caller cannot make the collector log
 *   `/u/somebody` or a `?next=` value even by asking for it directly.
 * - `value` must be a finite number in a plausible range. `Infinity` and
 *   `1e308` are rejected rather than clamped, because a clamped absurdity
 *   silently becomes a real-looking maximum in the p95 column.
 * - `id` — web-vitals' own per-metric id — is **discarded**. It is
 *   high-cardinality, it is not a join key for anything this project reports,
 *   and keeping it would double the log volume for no answered question.
 *
 * `normalizeVitalPayload` is pure and is where all of that lives, so the route
 * handler is thin and the rules are testable without a browser or a server.
 */

import { routeKey } from "./route";

/**
 * The six metrics `useReportWebVitals` delivers. FID is included because Next
 * 16's bundled web-vitals still emits it; it is deprecated in favour of INP and
 * the report labels it so.
 */
export const VITAL_NAMES = ["LCP", "CLS", "INP", "FCP", "TTFB", "FID"] as const;
export type VitalName = (typeof VITAL_NAMES)[number];

const VITAL_SET: ReadonlySet<string> = new Set(VITAL_NAMES);

/**
 * Upper bounds beyond which a value is a lie rather than a slow page.
 *
 * CLS is unitless and cumulative; anything above 10 is not a layout shift, it
 * is a fabricated number. The timing metrics are milliseconds — 120 seconds is
 * far past any real page and well past every threshold in the report, so the
 * bound rejects nonsense without truncating a genuinely terrible measurement.
 */
const MAX_VALUE: Record<VitalName, number> = {
  LCP: 120_000,
  FCP: 120_000,
  TTFB: 120_000,
  INP: 120_000,
  FID: 120_000,
  CLS: 10,
};

export interface VitalPayload {
  name: VitalName;
  route: string;
  value: number;
  /** web-vitals' own rating, when the browser supplied a recognised one. */
  rating?: "good" | "needs-improvement" | "poor";
  /** The trace the page load belongs to, when hydration had adopted one. */
  requestId?: string;
}

const RATINGS: ReadonlySet<string> = new Set(["good", "needs-improvement", "poor"]);

/**
 * Validate and reduce one reported metric, or return null.
 *
 * Null means "drop this", never "record a zero". A rejected metric that became
 * a 0 would pull an LCP distribution down; a rejected metric that becomes
 * nothing leaves `n` one smaller, which the report already prints.
 */
export function normalizeVitalPayload(input: unknown): VitalPayload | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  const name = raw.name;
  if (typeof name !== "string" || !VITAL_SET.has(name)) return null;

  const value = raw.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_VALUE[name as VitalName]) return null;

  const payload: VitalPayload = {
    name: name as VitalName,
    route: routeKey(typeof raw.route === "string" ? raw.route : null),
    // Three decimals keeps CLS meaningful (it lives in the hundredths) without
    // logging a float's full tail for a millisecond timing.
    value: Math.round(value * 1000) / 1000,
  };

  if (typeof raw.rating === "string" && RATINGS.has(raw.rating)) {
    payload.rating = raw.rating as VitalPayload["rating"];
  }
  if (typeof raw.requestId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(raw.requestId)) {
    payload.requestId = raw.requestId;
  }
  return payload;
}

/**
 * Standard Core Web Vitals thresholds, as published by web.dev. **External
 * standard, not a PotLuck budget** — the project's own budgets live in
 * `docs/17-m88a-performance-baseline.md` and are stricter or looser for stated
 * reasons. Kept here so the report can label each number with which bar it is
 * being held to.
 *
 * Each entry is [good, needs-improvement] — at or below `good` is good, above
 * `poor` bound is poor.
 */
export const CWV_THRESHOLDS: Record<VitalName, readonly [number, number]> = {
  LCP: [2500, 4000],
  CLS: [0.1, 0.25],
  INP: [200, 500],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  FID: [100, 300],
};

export function rateVital(name: VitalName, value: number): VitalPayload["rating"] {
  const [good, poor] = CWV_THRESHOLDS[name];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}
