/**
 * Reading a directory of root-EV exports into mean EVs, with their precision.
 *
 * ONE implementation, shared by `preflop-br.ts` (which iterates the loop) and
 * `preflop-pack.ts` (which publishes its result). These two used to be the
 * same twenty lines twice over, and CLAUDE.md's standing rule is that two
 * independent derivations of the same arithmetic is how the numbers quietly
 * stop agreeing — the published pack disagreeing with the loop that produced
 * it is the exact failure that would be invisible.
 *
 * UNITS. `expected_values(player)` returns the player's SHARE OF THE FINAL
 * POT in chips, not net chips — measured, not assumed, see
 * docs/14-m87a-solver-scope.md. Netting is the caller's job, because only the
 * caller knows what that player put in. Everything here is chips; 10 = 1bb.
 *
 * ## Why this module computes a standard error
 *
 * Measured 2026-08-07 on iteration 4: the six suit-isomorphic combos of `22`
 * have BTN open EVs spanning **-0.27bb to +1.58bb**. Those hands differ only
 * in which suits they hold, against the same 25 flops, so that entire spread
 * is sampling noise. A pack that published per-combo EVs would tell a player
 * that folding 2s2c is correct and folding 2h2d costs 1.58bb — teaching a suit
 * superstition with a decimal point on it.
 *
 * So EVs are aggregated to the 169 classes, and the 25-flop sampling error of
 * each class mean is measured by leave-one-flop-out jackknife and published
 * alongside it. `verdict.ts`'s bands are 0.1 / 0.5 / 0.75bb and the median
 * class SE is ~0.4bb — four times the whole "correct" band — so grading
 * without the SE in hand would manufacture verdicts the data cannot support.
 * That is the same failure the roadmap retired reference-range grading for.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";

/**
 * Card ids must match postflop-solver exactly: `rank << 2 | suit`, rank 0 =
 * deuce, suit 0 = clubs, with `hole_to_string` emitting the HIGHER card id
 * first. Getting either wrong fails every lookup silently rather than
 * erroring, and shows up only as absurd output — AA missing from a raising
 * range. That is why this is written once.
 */
export const cardToString = (card: number): string =>
  RANKS[card >> 2] + SUITS[card & 3];

export const ALL_COMBOS: string[] = (() => {
  const out: string[] = [];
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) out.push(cardToString(b) + cardToString(a));
  }
  return out;
})();

export const COMBO_COUNT = ALL_COMBOS.length; // 1326

/** "8s7h" -> "87o", "8s7s" -> "87s", "8s8h" -> "88". */
export function comboToClass(c: string): string {
  const r1 = c[0], s1 = c[1], r2 = c[2], s2 = c[3];
  if (r1 === r2) return r1 + r2;
  const [hi, lo] = RANKS.indexOf(r1) > RANKS.indexOf(r2) ? [r1, r2] : [r2, r1];
  return hi + lo + (s1 === s2 ? "s" : "o");
}

export const cardsOf = (c: string): [string, string] => [c.slice(0, 2), c.slice(2, 4)];

export const blocks = (a: string, b: string): boolean => {
  const [a1, a2] = cardsOf(a);
  const [b1, b2] = cardsOf(b);
  return a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2;
};

/**
 * Aggregate a per-combo predicate into 169-class frequencies.
 *
 * A class frequency of 0.25 here means one of the four suit combinations of
 * that class takes the action. At the 25-flop sample size that is mostly
 * NOISE rather than card removal — see the module header — which is why the
 * published pack indexes by class and this helper survives only for
 * `preflop-br.ts`'s iteration loop, whose per-combo behaviour is deliberately
 * left as it was when iterations 1-4 were measured.
 */
export function classFrequencyOf(inSet: (combo: string) => boolean): Map<string, number> {
  const total = new Map<string, number>();
  const hit = new Map<string, number>();
  for (const c of ALL_COMBOS) {
    const k = comboToClass(c);
    total.set(k, (total.get(k) ?? 0) + 1);
    if (inSet(c)) hit.set(k, (hit.get(k) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  for (const [k, t] of total) out.set(k, (hit.get(k) ?? 0) / t);
  return out;
}

interface EvFile {
  flop: string;
  pot: number;
  stack: number;
  players: { hands: string[]; ev: number[]; weight: number[] }[];
}

type Player = 0 | 1;
type Acc = Map<string, { ev: number; w: number }>;

export interface EvTable {
  /** Flop ids in the order they were read. Compare the count against the set. */
  flops: string[];
  /** How much each flop counts, aligned with `flops`. All 1 under EQUAL_WEIGHTS. */
  flopWeights: number[];
  /** Total pot in chips at the start of the postflop subgame. */
  pot: number;
  /** Effective stack behind, in chips. */
  stack: number;
  /** Combos with an EV, per player. Anything below 1326 means an unpriceable hand. */
  coverage(player: Player): number;
  /** Weighted mean EV per combo, in chips. Player 0 = OOP, 1 = IP. */
  comboMean(player: Player, skipFlop?: number): Map<string, number>;
  /**
   * Mean EV per 169-class, in chips: the unweighted mean over the class's
   * combos, since every combo of a class is equally likely to be dealt.
   */
  classMean(player: Player, skipFlop?: number): Map<string, number>;
  /**
   * Standard error of each class mean, in chips — the precision the published
   * EVs actually have.
   *
   * Pass `strata` (flop -> stratum key) when the sample was stratified, and
   * the correct stratified-sampling estimator is used. Omit it for the
   * delete-one jackknife, which is right for an unstratified sample.
   */
  classStandardError(player: Player, strata?: Map<string, string>): Map<string, number>;
  /** Max - min across the combos of a class, in chips: pure suit noise. */
  classComboSpread(player: Player): Map<string, number>;
  /**
   * ONE flop's class means, in chips — computed directly from that flop's own
   * accumulator.
   *
   * Not recoverable by difference from the pooled means, which is the natural
   * assumption and is wrong: `comboMean` weights each flop by the hand's
   * weight IN THE RANGE times the flop's weight, and the first varies per
   * flop and per hand. `classMean` then takes a mean of ratios, which is not
   * a ratio of means. Reconstructing it arithmetically produced values
   * outside the pot entirely (104 chips in a 55-chip pot) while still looking
   * like plausible poker for most hands.
   */
  flopClassMean(player: Player, flopIndex: number): Map<string, number>;
}

/**
 * Average the per-hand root EVs across every `.ev.json` in `dir`.
 *
 * Hands are weighted by their weight WITHIN the range: a hand present at 0.3
 * should not count as much as one present at 1.0. The exploration floor means
 * every hand is present at some weight, which is what keeps coverage at
 * 1326/1326 and lets the loop tell whether a folded hand should come back.
 */
/**
 * How much each flop counts in the average.
 *
 * `EQUAL_WEIGHTS` is the historic behaviour and is now something a caller has
 * to ASK for by name. It is not a default, because it was silently wrong: the
 * shipped 25-flop set is 80% rainbow against a true 39.8%, so averaging it
 * equally estimates the wrong quantity. Making the choice explicit at every
 * call site is what stops that recurring.
 */
export type FlopWeights = Map<string, number> | typeof EQUAL_WEIGHTS;

export const EQUAL_WEIGHTS = "equal-weights" as const;

/** Read a weighted flop set built by `solver/flops/build.ts`. */
export function loadFlopWeights(path: string): Map<string, number> {
  const set = JSON.parse(readFileSync(path, "utf8")) as {
    kind: string;
    flops: { flop: string; weight: number }[];
  };
  if (set.kind !== "weighted-flop-set") throw new Error(`${path} is not a weighted flop set`);
  const total = set.flops.reduce((sum, f) => sum + f.weight, 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw new Error(`${path} weights sum to ${total}, not 1`);
  }
  return new Map(set.flops.map((f) => [f.flop, f.weight]));
}

export function loadEvTable(dir: string, weights: FlopWeights): EvTable {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ev.json")).sort();
  if (files.length === 0) throw new Error(`no .ev.json files in ${dir}`);

  const flops: string[] = [];
  const flopWeight: number[] = [];
  const perFlop: [Acc, Acc][] = [];
  let pot = 0;
  let stack = 0;
  for (const f of files) {
    const d: EvFile = JSON.parse(readFileSync(join(dir, f), "utf8"));
    pot = d.pot;
    stack = d.stack;
    flops.push(d.flop);
    if (weights === EQUAL_WEIGHTS) {
      flopWeight.push(1);
    } else {
      const w = weights.get(d.flop);
      // A solved flop with no weight cannot be averaged in — silently
      // dropping it, or silently giving it weight 1, are both how a sample
      // stops being the sample it claims to be.
      if (w === undefined) {
        throw new Error(`${d.flop} is solved in ${dir} but absent from the flop set`);
      }
      flopWeight.push(w);
    }
    const pair: [Acc, Acc] = [new Map(), new Map()];
    for (let p = 0; p < 2; p++) {
      const { hands, ev, weight } = d.players[p];
      for (let i = 0; i < hands.length; i++) {
        pair[p].set(hands[i], { ev: ev[i] * weight[i], w: weight[i] });
      }
    }
    perFlop.push(pair);
  }

  const comboMean = (player: Player, skipFlop?: number): Map<string, number> => {
    const acc: Acc = new Map();
    perFlop.forEach((pair, i) => {
      if (i === skipFlop) return;
      // TWO weights multiply here and they mean different things: `v.w` is how
      // much of the hand is in the RANGE, `flopWeight[i]` is how much of flop
      // space this BOARD stands for. Dropping the second is the bias this
      // whole change exists to remove.
      const fw = flopWeight[i];
      for (const [combo, v] of pair[player]) {
        const cur = acc.get(combo) ?? { ev: 0, w: 0 };
        cur.ev += v.ev * fw;
        cur.w += v.w * fw;
        acc.set(combo, cur);
      }
    });
    const out = new Map<string, number>();
    for (const [combo, v] of acc) if (v.w > 0) out.set(combo, v.ev / v.w);
    return out;
  };

  const toClassMean = (combos: Map<string, number>): Map<string, number> => {
    const sums = new Map<string, { total: number; n: number }>();
    for (const combo of ALL_COMBOS) {
      const v = combos.get(combo);
      if (v === undefined) continue;
      const k = comboToClass(combo);
      const cur = sums.get(k) ?? { total: 0, n: 0 };
      cur.total += v;
      cur.n++;
      sums.set(k, cur);
    }
    const out = new Map<string, number>();
    for (const [k, v] of sums) out.set(k, v.total / v.n);
    return out;
  };

  return {
    flops,
    flopWeights: [...flopWeight],
    pot,
    stack,
    coverage: (player) => {
      const m = comboMean(player);
      return ALL_COMBOS.filter((c) => m.has(c)).length;
    },
    comboMean,
    classMean: (player, skipFlop) => toClassMean(comboMean(player, skipFlop)),
    flopClassMean(player, flopIndex) {
      const pair = perFlop[flopIndex];
      if (!pair) throw new Error(`no flop at index ${flopIndex}`);
      const combos = new Map<string, number>();
      for (const [combo, v] of pair[player]) if (v.w > 0) combos.set(combo, v.ev / v.w);
      return toClassMean(combos);
    },
    /**
     * Standard error of each class mean, in chips — by the estimator that
     * matches how the flops were actually sampled.
     *
     * **Stratified** when strata are supplied, which is the correct formula
     * for a probability-weighted set: `Var = sum_s W_s^2 * s_s^2 / n_s`,
     * where `W_s` is the stratum's share of flop space, `s_s^2` the variance
     * of the per-flop EVs within it and `n_s` how many were sampled. That is
     * also the estimator that SHOWS the benefit of stratifying, because the
     * between-stratum variance drops out of it entirely.
     *
     * **Delete-one jackknife** otherwise, which is what the equal-weighted
     * legacy path used and is right for an unstratified sample.
     *
     * A stratum with one flop has no within-stratum variance to estimate, so
     * its variance is POOLED from the others rather than counted as zero.
     * Counting it as zero would report a tiny error for a set that sampled a
     * whole texture once — the most confident number would come from the
     * thinnest evidence.
     */
    classStandardError(player, strata) {
      const full = toClassMean(comboMean(player));
      const n = perFlop.length;
      if (n < 2) {
        // One flop cannot estimate its own sampling error. Returning zero
        // would claim infinite precision, which is the opposite of the truth.
        return new Map([...full.keys()].map((k) => [k, Number.POSITIVE_INFINITY]));
      }

      // Per-flop class means, needed by both estimators.
      const perFlopClassMean = perFlop.map((_, i) => {
        const single: Acc = new Map();
        for (const [combo, v] of perFlop[i][player]) single.set(combo, v);
        const combos = new Map<string, number>();
        for (const [combo, v] of single) if (v.w > 0) combos.set(combo, v.ev / v.w);
        return toClassMean(combos);
      });

      const out = new Map<string, number>();

      if (strata) {
        const groups = new Map<string, number[]>();
        perFlop.forEach((_, i) => {
          const key = strata.get(flops[i]);
          if (key === undefined) throw new Error(`${flops[i]} has no stratum`);
          (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
        });
        // Stratum weight = the total flop weight it carries, which for a
        // properly built set is its true share of flop space.
        const weightOf = new Map<string, number>();
        for (const [key, idx] of groups) {
          weightOf.set(key, idx.reduce((sum, i) => sum + flopWeight[i], 0));
        }
        for (const [k, mean] of full) {
          // Pooled within-stratum variance, for the singleton strata.
          let pooledSs = 0;
          let pooledDf = 0;
          const perStratum = new Map<string, { variance: number | null; n: number }>();
          for (const [key, idx] of groups) {
            const xs = idx.map((i) => perFlopClassMean[i].get(k) ?? mean);
            if (xs.length < 2) {
              perStratum.set(key, { variance: null, n: xs.length });
              continue;
            }
            const m = xs.reduce((a, b) => a + b, 0) / xs.length;
            const ss = xs.reduce((a, b) => a + (b - m) * (b - m), 0);
            perStratum.set(key, { variance: ss / (xs.length - 1), n: xs.length });
            pooledSs += ss;
            pooledDf += xs.length - 1;
          }
          const pooled = pooledDf > 0 ? pooledSs / pooledDf : 0;
          let variance = 0;
          for (const [key, s] of perStratum) {
            const w = weightOf.get(key)!;
            variance += w * w * ((s.variance ?? pooled) / Math.max(1, s.n));
          }
          out.set(k, Math.sqrt(variance));
        }
        return out;
      }

      const partials = perFlop.map((_, i) => toClassMean(comboMean(player, i)));
      for (const [k, mean] of full) {
        let ss = 0;
        for (const part of partials) {
          const d = (part.get(k) ?? mean) - mean;
          ss += d * d;
        }
        out.set(k, Math.sqrt(((n - 1) / n) * ss));
      }
      return out;
    },
    classComboSpread(player) {
      const combos = comboMean(player);
      const byClass = new Map<string, { lo: number; hi: number }>();
      for (const combo of ALL_COMBOS) {
        const v = combos.get(combo);
        if (v === undefined) continue;
        const k = comboToClass(combo);
        const cur = byClass.get(k);
        if (!cur) byClass.set(k, { lo: v, hi: v });
        else {
          cur.lo = Math.min(cur.lo, v);
          cur.hi = Math.max(cur.hi, v);
        }
      }
      return new Map([...byClass].map(([k, v]) => [k, v.hi - v.lo]));
    },
  };
}
