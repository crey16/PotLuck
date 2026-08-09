/**
 * Latency distributions — M8.8A.
 *
 * The one rule this module exists to enforce: **a percentile is a claim about
 * a sample, and the sample size travels with it.** `p95` from 5 observations
 * is the maximum wearing a different name, and a baseline that prints it
 * without saying so is worse than no baseline, because a later change gets
 * compared against a number nobody should have believed.
 *
 * So `summarize` always returns `n`, and always returns `confidence`:
 *
 * - `none`   — fewer than `MIN_P50_SAMPLES`. No percentile is reported at all;
 *              `p50`/`p95` are null. Use `min`/`max` and say "smoke test".
 * - `p50`    — enough for a median, not for a tail. `p95` is computed but
 *              `p95Reliable` is false, and every renderer marks it.
 * - `full`   — enough that the 95th percentile is not simply the maximum.
 *
 * The `full` threshold is 20, not a round 100, and the reason is arithmetic
 * rather than taste: with nearest-rank on n observations the 95th percentile
 * IS the maximum whenever n < 20, because ceil(0.95 · n) = n. Twenty is the
 * first sample size at which p95 and max can differ. It is a floor on
 * meaningfulness, not a claim of precision — 20 samples still gives a wide
 * interval, which is why the report prints n next to every figure.
 *
 * ## Nearest-rank, not interpolated
 *
 * `percentile` returns an observed value, never an average of two. Interpolation
 * invents a latency nobody measured, and for the small samples this project can
 * actually collect it mostly smooths away the tail that the p95 exists to show.
 */

export const MIN_P50_SAMPLES = 5;
export const MIN_P95_SAMPLES = 20;

export type Confidence = "none" | "p50" | "full";

export interface Summary {
  n: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  confidence: Confidence;
  /** False whenever p95 cannot differ from max at this sample size. */
  p95Reliable: boolean;
}

export const EMPTY_SUMMARY: Summary = {
  n: 0,
  min: null,
  max: null,
  mean: null,
  p50: null,
  p95: null,
  p99: null,
  confidence: "none",
  p95Reliable: false,
};

/**
 * Nearest-rank percentile of an already-sorted ascending array.
 *
 * `q` is a fraction in [0, 1]. Rank is `ceil(q · n)`, clamped to [1, n], so
 * q=0 gives the minimum and q=1 the maximum, and every returned value is one
 * that was actually observed.
 */
export function percentileSorted(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const clamped = Math.min(1, Math.max(0, q));
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(clamped * sorted.length)));
  return sorted[rank - 1];
}

/** Nearest-rank percentile of an unsorted sample. Ignores non-finite values. */
export function percentile(values: number[], q: number): number | null {
  return percentileSorted(cleanSorted(values), q);
}

/**
 * Drop everything that is not a finite number, then sort ascending.
 *
 * Non-finite input is dropped rather than thrown on: these samples come from
 * clocks and from JSON that crossed a network, and one `NaN` must not be able
 * to destroy a whole run's report. The count that survives is what `n`
 * reports, so a caller can always see how much was discarded.
 */
export function cleanSorted(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  }
  return out.sort((a, b) => a - b);
}

export function summarize(values: readonly number[]): Summary {
  const sorted = cleanSorted(values);
  const n = sorted.length;
  if (n === 0) return { ...EMPTY_SUMMARY };

  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const confidence: Confidence =
    n >= MIN_P95_SAMPLES ? "full" : n >= MIN_P50_SAMPLES ? "p50" : "none";

  return {
    n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: sum / n,
    // Below MIN_P50_SAMPLES nothing is reported as a percentile. min/max still
    // are: they are order statistics that mean exactly what they say at n=2.
    p50: confidence === "none" ? null : percentileSorted(sorted, 0.5),
    p95: confidence === "none" ? null : percentileSorted(sorted, 0.95),
    p99: confidence === "none" ? null : percentileSorted(sorted, 0.99),
    confidence,
    p95Reliable: n >= MIN_P95_SAMPLES,
  };
}

/** One measured operation: a route, an endpoint, a server read group. */
export interface Sample {
  /** The grouping key — a route pattern or endpoint, never a raw URL. */
  key: string;
  /** Milliseconds. */
  ms: number;
  /** HTTP status where there is one. */
  status?: number;
  /** Bytes transferred where known. */
  bytes?: number;
  /**
   * Whether this observation hit a cold process. Cold and warm are DIFFERENT
   * distributions — a serverless cold start is 300–800ms of runtime boot that
   * no warm request pays — so they are summarized separately and never
   * silently pooled.
   */
  cold?: boolean;
  /** True when the observation is a failure. Failures never enter latency. */
  failed?: boolean;
}

export interface GroupReport {
  key: string;
  /** Every observation, failures included. */
  total: number;
  failures: number;
  errorRate: number;
  /** Latency of SUCCESSFUL observations only — see note below. */
  warm: Summary;
  cold: Summary;
  bytes: Summary;
  statuses: Record<string, number>;
}

/**
 * Group samples into per-key reports.
 *
 * **Failures are counted, not timed.** A 500 that returns in 3ms would drag a
 * p50 down and make a broken endpoint look fast; a timeout would inflate it
 * and make a working one look broken. So failed observations contribute to
 * `failures`/`errorRate` and to `statuses`, and never to a latency summary.
 * This is also why `errorRate` is reported next to every distribution rather
 * than on its own line: a fast p95 over a 40% error rate is not a good result,
 * and the two numbers have to be read together to see that.
 *
 * **Cold and warm are separate summaries, never merged.** A run that mixes a
 * process boot into a warm distribution reports a p95 that describes neither.
 */
export function groupSamples(samples: readonly Sample[]): GroupReport[] {
  const byKey = new Map<string, Sample[]>();
  for (const sample of samples) {
    if (!sample || typeof sample.key !== "string") continue;
    const list = byKey.get(sample.key);
    if (list) list.push(sample);
    else byKey.set(sample.key, [sample]);
  }

  const reports: GroupReport[] = [];
  for (const [key, list] of byKey) {
    const failures = list.filter((s) => s.failed).length;
    const ok = list.filter((s) => !s.failed);
    const statuses: Record<string, number> = {};
    for (const sample of list) {
      const label = sample.status === undefined ? "none" : String(sample.status);
      statuses[label] = (statuses[label] ?? 0) + 1;
    }
    reports.push({
      key,
      total: list.length,
      failures,
      errorRate: list.length ? failures / list.length : 0,
      warm: summarize(ok.filter((s) => !s.cold).map((s) => s.ms)),
      cold: summarize(ok.filter((s) => s.cold).map((s) => s.ms)),
      bytes: summarize(
        ok.map((s) => s.bytes).filter((b): b is number => typeof b === "number")
      ),
      statuses,
    });
  }
  reports.sort((a, b) => (b.warm.p95 ?? 0) - (a.warm.p95 ?? 0) || a.key.localeCompare(b.key));
  return reports;
}

/** Milliseconds, at a precision that does not pretend to sub-millisecond truth. */
export function formatMs(value: number | null): string {
  if (value === null) return "—";
  if (value < 10) return `${value.toFixed(1)}ms`;
  return `${Math.round(value)}ms`;
}

export function formatBytes(value: number | null): string {
  if (value === null) return "—";
  if (value < 1024) return `${Math.round(value)}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}kB`;
  return `${(value / (1024 * 1024)).toFixed(2)}MB`;
}
