/**
 * The GTO score — one number for how well a hand (or a session) was played.
 *
 * **Derived from EV loss, never from the pot.** Winning a hand says nothing
 * about whether it was played well; a correct call loses most of the time by
 * construction. Nor is it accuracy: "3 of 4 correct" treats a 0.06bb
 * near-indifference and a 4bb blunder as the same miss, which is exactly the
 * distinction a solver trainer exists to teach. The score is a function of
 * chips given up and nothing else.
 *
 * ## The curve
 *
 * Each decision scores `100 · e^(−loss / DECAY_BB)`. Exponential decay rather
 * than a linear penalty, for three reasons:
 *
 *  - it is bounded in (0, 100] without clamping, so a single catastrophic
 *    decision cannot drive a hand negative or need an arbitrary floor;
 *  - it is steepest where the interesting distinctions are — the gap between
 *    0.1bb and 0.6bb matters far more to a player's results than the gap
 *    between 4bb and 4.5bb, and a linear scale gets that backwards;
 *  - it never reaches zero, which is honest: no finite mistake is infinitely
 *    bad, and a 0 would invite the reading that nothing was recorded.
 *
 * `DECAY_BB = 2` places the landmarks where the `verdict.ts` thresholds
 * already sit, so the score and the verdict beside it never tell different
 * stories:
 *
 * | EV loss | Score | `verdict.ts` band       |
 * |---------|-------|-------------------------|
 * | 0.00bb  | 100   | correct                 |
 * | 0.10bb  | 95    | correct (ceiling)       |
 * | 0.50bb  | 78    | acceptable (ceiling)    |
 * | 0.75bb  | 69    | blunder (floor)         |
 * | 2.00bb  | 37    | blunder                 |
 * | 5.00bb  | 8     | blunder                 |
 *
 * ## Unknown is not zero
 *
 * A decision whose EV loss is unknown — today, every preflop decision, which
 * `lib/play/preflop.ts` grades against reference ranges rather than solver
 * output — is **excluded from the mean**, not scored as perfect and not
 * scored as a blunder. This is the same rule M8 applies to legacy attempts
 * and it matters for the same reason: inventing a value for a number nobody
 * computed is how a coaching statistic quietly becomes fiction.
 *
 * A hand with no EV-graded decision therefore has **no score** (`null`), not
 * a score of 100. `M8.7A` retires reference-range preflop grading, at which
 * point preflop decisions start counting here with no change to this file.
 *
 * ## Versioning
 *
 * `GTO_SCORE_VERSION` is stored beside every displayed score along with the
 * EV-loss inputs that produced it. A stored score must always be
 * re-derivable, and a later change to the curve must be visible as a version
 * change rather than silently restating history — the same discipline M8
 * applies to grading itself.
 */
import type { Verdict } from "./verdict";

/** Bump on ANY change to the curve, the decay, or the exclusion rule. */
export const GTO_SCORE_VERSION = "gto-score-v1";

/** EV loss at which a decision scores 100/e ≈ 37. See the table above. */
export const DECAY_BB = 2;

/** One decision's contribution, before averaging. Always in (0, 100]. */
export function decisionScore(evLossBb: number): number {
  // A negative loss would mean the chosen action beat the solver's best,
  // which the export cannot produce; treat it as 0 rather than scoring >100.
  const loss = Math.max(0, evLossBb);
  return 100 * Math.exp(-loss / DECAY_BB);
}

export interface ScoredDecision {
  /** Null when the decision was not graded from solver EVs. */
  evLossBb: number | null;
  verdict: Verdict;
}

export interface GtoScore {
  /** Rounded 0–100 for display, or null when nothing could be scored. */
  score: number | null;
  /** The unrounded mean, kept so a stored score is reproducible. */
  raw: number | null;
  /** Decisions that carried a known EV loss and so entered the mean. */
  scored: number;
  /** Decisions excluded because their EV loss is unknown. */
  unscored: number;
  /** Sum of known EV losses, in big blinds. */
  totalEvLossBb: number;
  /** Worst single known EV loss, in big blinds. Null when none were known. */
  worstEvLossBb: number | null;
  counts: Record<Verdict, number>;
  version: string;
}

const EMPTY_COUNTS = (): Record<Verdict, number> => ({
  correct: 0,
  acceptable: 0,
  inaccuracy: 0,
  blunder: 0,
});

/**
 * Score a set of decisions. Works for one hand or a whole session — the
 * arithmetic is the same, which is deliberate: a session score that used a
 * different rule from the hand scores it summarises would not add up on
 * screen.
 */
export function gtoScore(decisions: readonly ScoredDecision[]): GtoScore {
  const counts = EMPTY_COUNTS();
  let sum = 0;
  let scored = 0;
  let unscored = 0;
  let totalEvLossBb = 0;
  let worstEvLossBb: number | null = null;

  for (const d of decisions) {
    counts[d.verdict] += 1;
    if (d.evLossBb === null) {
      unscored += 1;
      continue;
    }
    const loss = Math.max(0, d.evLossBb);
    sum += decisionScore(loss);
    totalEvLossBb += loss;
    if (worstEvLossBb === null || loss > worstEvLossBb) worstEvLossBb = loss;
    scored += 1;
  }

  const raw = scored > 0 ? sum / scored : null;
  return {
    score: raw === null ? null : Math.round(raw),
    raw,
    scored,
    unscored,
    totalEvLossBb,
    worstEvLossBb,
    counts,
    version: GTO_SCORE_VERSION,
  };
}

export type ScoreBand = "excellent" | "solid" | "loose" | "leaking";

/**
 * A word for the score. The cut points are the score values of the
 * `verdict.ts` thresholds, so a hand of nothing but "correct" decisions
 * cannot read as anything but excellent, and a hand containing a blunder
 * cannot read as excellent.
 */
export function scoreBand(score: number): ScoreBand {
  if (score >= 95) return "excellent"; // every decision within 0.1bb
  if (score >= 78) return "solid"; // nothing worse than the acceptable ceiling
  if (score >= 60) return "loose";
  return "leaking";
}

export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  excellent: "Excellent",
  solid: "Solid",
  loose: "Loose",
  leaking: "Leaking",
};
