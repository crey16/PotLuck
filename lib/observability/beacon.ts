/**
 * Validating what the browser sends to `/perf/vitals` — M8.8A.
 *
 * The collector is unauthenticated by necessity (see `webVitals.ts`), so this
 * module treats the body as hostile input and is pure so that treatment can be
 * tested without a server. Everything the endpoint will ever log passes through
 * `normalizeBeaconBatch`; the route handler adds no fields of its own.
 *
 * The rate limiter lives here too, and its limitation is stated rather than
 * hidden: **it is per-instance, and Vercel runs many instances.** A token
 * bucket in module memory therefore bounds what one warm instance will accept,
 * not what the deployment as a whole will. That is worth having anyway — it
 * stops a single looping client from filling the log, which is the realistic
 * failure — but it is not a defence against a distributed flood, and the only
 * honest protection against that is that the endpoint writes to a log with a
 * hard per-line cost and no database behind it. Nothing here touches Postgres.
 */

import { normalizeVitalPayload, type VitalPayload } from "./webVitals";
import { routeKey } from "./route";

/** A completed client-side route transition, as reported by the browser. */
export interface NavPayload {
  kind: "nav";
  route: string;
  ms: number;
  outcome: "rendered" | "redirected";
  requestId?: string;
}

export type BeaconEntry = VitalPayload | NavPayload;

/** Largest body the collector will read, in bytes. */
export const MAX_BODY_BYTES = 4096;

/** Most entries one beacon may carry. */
export const MAX_ENTRIES = 12;

/**
 * A navigation slower than this is not a navigation — it is a tab left open in
 * the background, or a fabricated number. Ten minutes is far past any real
 * transition and past every budget, so it rejects nonsense without truncating
 * a genuinely awful measurement.
 */
const MAX_NAV_MS = 600_000;

const OUTCOMES: ReadonlySet<string> = new Set(["rendered", "redirected"]);

function normalizeNav(raw: Record<string, unknown>): NavPayload | null {
  const ms = raw.ms;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0 || ms > MAX_NAV_MS) {
    return null;
  }
  const outcome = raw.outcome;
  if (typeof outcome !== "string" || !OUTCOMES.has(outcome)) return null;

  const payload: NavPayload = {
    kind: "nav",
    route: routeKey(typeof raw.route === "string" ? raw.route : null),
    ms: Math.round(ms * 10) / 10,
    outcome: outcome as NavPayload["outcome"],
  };
  if (typeof raw.requestId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(raw.requestId)) {
    payload.requestId = raw.requestId;
  }
  return payload;
}

/**
 * Validate a whole beacon body.
 *
 * Invalid entries are dropped individually, not the batch — one browser quirk
 * in a single metric must not erase the five good measurements beside it.
 */
export function normalizeBeaconBatch(input: unknown): BeaconEntry[] {
  const list = Array.isArray(input) ? input : [input];
  const out: BeaconEntry[] = [];
  for (const entry of list.slice(0, MAX_ENTRIES)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    const normalized = raw.kind === "nav" ? normalizeNav(raw) : normalizeVitalPayload(raw);
    if (normalized) out.push(normalized);
  }
  return out;
}

/**
 * Parse a body that arrived as `text/plain` (which is what `sendBeacon` sends
 * to avoid a CORS preflight). Returns null for anything that is not JSON — the
 * caller answers 204 either way, because telling an unauthenticated caller
 * exactly why its payload was rejected is a probing oracle and buys nothing.
 */
export function parseBeaconBody(text: string): BeaconEntry[] {
  if (text.length === 0 || text.length > MAX_BODY_BYTES) return [];
  try {
    return normalizeBeaconBatch(JSON.parse(text));
  } catch {
    return [];
  }
}

/**
 * A fixed-window counter over a caller key.
 *
 * Fixed window rather than a sliding one on purpose: a sliding window needs a
 * timestamp list per key, which is unbounded memory on the very input it is
 * meant to bound. This holds one integer and one window stamp per key, and the
 * whole map is dropped when the window rolls, so memory cannot grow across
 * windows either.
 */
export class RateLimiter {
  private windowStart = 0;
  private counts = new Map<string, number>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** Injected so tests need no real time. */
    private readonly now: () => number = () => Date.now()
  ) {}

  /** True when this call is allowed. */
  allow(key: string): boolean {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.counts.clear();
    }
    // A cap on distinct keys, so a spoofed-address flood cannot grow the map
    // without bound. Once full the window rejects unknown keys outright.
    if (this.counts.size >= 2048 && !this.counts.has(key)) return false;
    const used = this.counts.get(key) ?? 0;
    if (used >= this.limit) return false;
    this.counts.set(key, used + 1);
    return true;
  }
}
