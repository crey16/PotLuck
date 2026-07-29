/**
 * Pure question builder for the "Count your outs" drill — a port of the
 * reference trainer's `Q.outs` (poker-math-trainer.html lines 600-625) and
 * its `buildOpts`-style option builder (lines 378-392, integer flavour).
 *
 * Deliberately React-free and dependency-free (besides the engine) so it can
 * be unit tested with a deterministic injected Rng.
 */
import type { Rng, Spot, Street } from "../poker/engine.js";

/** "a gutshot" / "an open-ended straight draw" — reference `withArticle`. */
export function withArticle(label: string): string {
  return (/^[aeiou]/i.test(label) ? "an " : "a ") + label;
}

function uniqNums(values: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function shuffled<T>(arr: T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Ported reference `buildOpts` (integer flavour, as used by the outs
 * question): dedupe `candidates`, filter to `1..20` excluding `answer`, take
 * `totalOptions - 1` of them at random, and return `totalOptions` shuffled
 * values that always include `answer` exactly once.
 */
export function buildOpts(
  answer: number,
  candidates: number[],
  totalOptions: number,
  rng: Rng
): number[] {
  const filtered = uniqNums(candidates).filter((v) => v >= 1 && v <= 20 && v !== answer);
  const picked = shuffled(filtered, rng).slice(0, totalOptions - 1);
  return shuffled([answer, ...picked], rng);
}

const pct = (v: number): string => (v * 100).toFixed(1) + "%";

export interface OutsQuestion {
  street: Street;
  options: number[];
  answer: number;
  /** The draw label with its article already applied, e.g. "a flush draw". */
  drawLabel: string;
  hitPct: string;
  unseen: number;
}

/** Build the "how many outs do you have?" question for a dealt draw spot. */
export function buildOutsQuestion(spot: Spot, rng: Rng): OutsQuestion {
  const n = spot.outs;
  const candidates = [n - 1, n + 1, n - 2, n + 2, n + 3, n - 3, n + 6, Math.max(1, n - 4)];
  const options = buildOpts(n, candidates, 4, rng);
  return {
    street: spot.street,
    options,
    answer: n,
    drawLabel: withArticle(spot.draw),
    hitPct: pct(spot.equity),
    unseen: spot.unseen,
  };
}
