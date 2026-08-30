/**
 * How much EV the current strategy still leaves to its own best response —
 * with an aggregate confidence bound, because that is the question the
 * stopping decision actually turns on.
 *
 * ## Why this is the primary convergence statistic
 *
 * Three quantities look like convergence and are not:
 *
 * - **Iterate-to-iterate movement.** Fictitious play's step is
 *   `(BR − σ)/(n+1)`, which decays as 1/k BY CONSTRUCTION. A threshold on it
 *   can be met by damping alone.
 * - **The frequency gap ‖BR − σ‖.** It does not vanish at a fixed point: FP's
 *   average is mixed and a best response is pure, so a genuinely INDIFFERENT
 *   class disagrees forever at no cost whatsoever.
 * - **The count of decisive-and-resolvable classes.** Better, but it is a
 *   count of individually-significant classes, and significance is not
 *   additivity: sixty classes each inside their own error can still carry
 *   material EV between them, and one class outside its error can be worth
 *   nothing.
 *
 * What answers the question is the EV: playing σ instead of the best response
 * costs `prior(class) x (br − σ) x (the EV difference between the actions)`,
 * summed over classes. An indifferent class contributes zero because its EV
 * difference is zero, which is exactly the behaviour the frequency gap lacks.
 *
 * ## The two statistical traps, and what is done about them
 *
 * 1. **Selection bias (the winner's curse).** The best response is chosen by
 *    the SIGN of the same estimated EV difference that then prices it. Where
 *    the truth is indifference, noise still picks a side and the plug-in
 *    regret is positive — so the plug-in estimate is biased UP, and a loop
 *    that stops when plug-in regret is small stops later than it needs to,
 *    while a loop that reports it as "the remaining loss" overstates it.
 *    Fixed by CROSS-FITTING: the best response for flop f is computed from
 *    the other 24 flops, and priced on flop f. The choice and the evaluation
 *    then use different data, which is what removes the bias.
 *
 * 2. **Cross-class correlation.** The 169 classes are not independent draws —
 *    one flop moves many of them together, so adding per-class variances
 *    understates the aggregate error badly. Fixed by aggregating FIRST: each
 *    flop yields one scalar regret, and the sampling error of their weighted
 *    mean is estimated across flops with the same stratified estimator
 *    `evtable.ts` uses for a class mean. Correlation between classes is
 *    inside each flop's number and needs no modelling.
 *
 * The uncertainty the remaining regret is compared against is therefore **the
 * standard error of the regret aggregate itself**, estimated over the same
 * flop sample that produced it. That is the valid comparison: both quantities
 * are functionals of one sample of boards, and the question "is the remaining
 * regret distinguishable from what this many boards can resolve" is exactly a
 * question about that aggregate's sampling distribution. It is NOT the median
 * per-class SE, which answers a different question (can one class be placed
 * on one side of its threshold) and would be the wrong yardstick for a sum.
 *
 * UNITS: chips per hand dealt, 10 = 1bb. Reported in bb by the caller.
 */
import { ALL_COMBOS, type EvTable } from "./evtable";
import {
  BB_CALL_THRESHOLD,
  BB_POST,
  DEAD_SB,
  OPEN,
  bestResponse,
  combosOfClass,
  gridHands,
  rangePercent,
} from "./rangeUpdate";

export interface SideRegret {
  /** Plug-in regret from the pooled means, in chips/hand. Biased UP. */
  plugin: number;
  /** Leave-one-flop-out cross-fitted regret, in chips/hand. The estimate. */
  crossFitted: number;
  /** Standard error of `crossFitted`, in chips/hand. */
  se: number;
  /** One-sided 95% lower bound: `crossFitted - 1.645 * se`, floored at 0. */
  lower95: number;
  /** One-sided 95% upper bound: `crossFitted + 1.645 * se`. */
  upper95: number;
  /** Each flop's own regret, in chips/hand, aligned with the table's flops. */
  perFlop: number[];
}

export interface RegretReport {
  bb: SideRegret;
  btn: SideRegret;
  /**
   * BB's regret plus BTN's, in chips/hand.
   *
   * Not one player's loss — the two sides are different seats. It is the
   * total EV the fixed point still has to distribute, which is the scalar the
   * LOOP converges on, and it is summed per flop before the error is
   * estimated so the two sides' shared board noise cancels correctly.
   */
  combined: number;
  combinedSe: number;
  combinedLower95: number;
  combinedUpper95: number;
}

/** One-sided 95% normal quantile. */
export const Z95 = 1.645;

const PRIOR = new Map(gridHands().map((h) => [h, combosOfClass(h) / ALL_COMBOS.length]));

/**
 * BB's per-class EV difference between calling and folding, in chips.
 *
 * Folding costs the 10 already posted; calling costs 25 more and returns the
 * hand's share of the pot. So the difference is exactly `ev - 15`, with no
 * scaling — BB's decision is priced on the postflop scale directly.
 */
const bbActionDiff = (classEv: number): number => classEv - BB_CALL_THRESHOLD;

/**
 * BTN's per-class EV difference between opening and folding, in chips.
 *
 * Opening is worth `(1-p)*(DEAD_SB+BB_POST) + p*(ev - OPEN)` against a call
 * frequency `p`; folding is worth 0. So a chip of postflop margin is worth
 * only `p` chips at the decision, and the boundary sits at
 * `OPEN - (DEAD_SB+BB_POST)*(1-p)/p` — about 2.07bb at p = 0.78, NOT at zero.
 * Pricing BTN's regret on the raw postflop scale would overstate it by ~28%
 * and put its indifference point in the wrong place.
 */
const btnActionDiff = (classEv: number, pCall: number): number =>
  (1 - pCall) * (DEAD_SB + BB_POST) + pCall * (classEv - OPEN);

/** The open/fold boundary on the postflop-EV scale, in chips. Derived, never hard-coded. */
export const btnThreshold = (pCall: number): number =>
  OPEN - ((DEAD_SB + BB_POST) * (1 - pCall)) / pCall;

/**
 * Regret of `sigma` against the best response to `table`, priced per flop.
 *
 * `skipFlop` selects the leave-one-out best response; the prices always come
 * from `flopIndex`'s own class means. Passing the same index to both is the
 * plug-in (biased) version; passing different ones is the cross-fitted one.
 */
function regretOnFlop(
  table: EvTable,
  sigmaOop: Map<string, number>,
  sigmaIp: Map<string, number>,
  flopIndex: number,
  skipFlop: number | undefined,
): { bb: number; btn: number } {
  const br = bestResponse(table.comboMean(0, skipFlop), table.comboMean(1, skipFlop));
  // BB's call frequency as the fraction of all combos, which is what BTN's
  // open EV is a function of. Card removal shifts it per hand by under 1% —
  // noise at this precision, and it would make the price hand-dependent.
  const pCall = rangePercent(br.bbClass) / 100;

  const oopEv = table.flopClassMean(0, flopIndex);
  const ipEv = table.flopClassMean(1, flopIndex);

  let bb = 0;
  let btn = 0;
  for (const hand of gridHands()) {
    const prior = PRIOR.get(hand)!;
    const oop = oopEv.get(hand);
    if (oop !== undefined) {
      bb += prior * ((br.bbClass.get(hand) ?? 0) - (sigmaOop.get(hand) ?? 0)) * bbActionDiff(oop);
    }
    const ip = ipEv.get(hand);
    if (ip !== undefined) {
      btn += prior * ((br.btnClass.get(hand) ?? 0) - (sigmaIp.get(hand) ?? 0)) * btnActionDiff(ip, pCall);
    }
  }
  return { bb, btn };
}

/**
 * The standard error of a flop-weighted mean.
 *
 * Stratified when strata are supplied — `Var = sum_s W_s^2 * s_s^2 / n_s`,
 * the estimator that matches a probability-weighted set and the one
 * `evtable.ts` documents. A stratum sampled once has no within-stratum
 * variance of its own, so its variance is POOLED from the others rather than
 * counted as zero; counting it as zero would report the most confident number
 * from the thinnest evidence.
 */
function weightedMeanSe(
  values: number[],
  weights: number[],
  flops: string[],
  strata: Map<string, string> | undefined,
): number {
  const n = values.length;
  if (n < 2) return Number.POSITIVE_INFINITY;
  if (!strata) {
    // Unstratified: the variance of a weighted mean of independent draws.
    const total = weights.reduce((a, b) => a + b, 0);
    const mean = values.reduce((s, v, i) => s + (weights[i] / total) * v, 0);
    const varSum = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1);
    return Math.sqrt(varSum / n);
  }
  const groups = new Map<string, number[]>();
  flops.forEach((f, i) => {
    const key = strata.get(f);
    if (key === undefined) throw new Error(`${f} has no stratum`);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(i);
  });
  let pooledSs = 0;
  let pooledDf = 0;
  const perStratum = new Map<string, { variance: number | null; n: number; w: number }>();
  for (const [key, idx] of groups) {
    const w = idx.reduce((s, i) => s + weights[i], 0);
    const xs = idx.map((i) => values[i]);
    if (xs.length < 2) {
      perStratum.set(key, { variance: null, n: xs.length, w });
      continue;
    }
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const ss = xs.reduce((a, b) => a + (b - m) * (b - m), 0);
    perStratum.set(key, { variance: ss / (xs.length - 1), n: xs.length, w });
    pooledSs += ss;
    pooledDf += xs.length - 1;
  }
  const pooled = pooledDf > 0 ? pooledSs / pooledDf : 0;
  let variance = 0;
  for (const s of perStratum.values()) {
    variance += s.w * s.w * ((s.variance ?? pooled) / Math.max(1, s.n));
  }
  return Math.sqrt(variance);
}

const summarise = (
  perFlop: number[],
  weights: number[],
  flops: string[],
  strata: Map<string, string> | undefined,
  plugin: number,
): SideRegret => {
  const total = weights.reduce((a, b) => a + b, 0);
  const crossFitted = perFlop.reduce((s, v, i) => s + (weights[i] / total) * v, 0);
  const se = weightedMeanSe(perFlop, weights, flops, strata);
  return {
    plugin,
    crossFitted,
    se,
    lower95: Math.max(0, crossFitted - Z95 * se),
    upper95: crossFitted + Z95 * se,
    perFlop,
  };
};

/**
 * Aggregate strategic regret of `sigma`, cross-fitted, with its own error.
 *
 * Cost is one best response per flop plus one pooled — 26 sweeps of the
 * 1,326-combo card-removal loop for a 25-flop set. Seconds, against hours per
 * solve, so there is no reason for the loop to stop on a cheaper statistic.
 */
export function aggregateRegret(
  table: EvTable,
  sigmaOop: Map<string, number>,
  sigmaIp: Map<string, number>,
  strata?: Map<string, string>,
): RegretReport {
  const n = table.flops.length;
  const weights = table.flopWeights;

  const bbPerFlop: number[] = [];
  const btnPerFlop: number[] = [];
  const bothPerFlop: number[] = [];
  for (let f = 0; f < n; f++) {
    // The best response is computed WITHOUT flop f and priced ON flop f.
    const r = regretOnFlop(table, sigmaOop, sigmaIp, f, f);
    bbPerFlop.push(r.bb);
    btnPerFlop.push(r.btn);
    bothPerFlop.push(r.bb + r.btn);
  }

  // The plug-in version, for the record: same best response for every flop,
  // chosen from all the data including the flop being priced.
  const pluginPerFlop = Array.from({ length: n }, (_, f) =>
    regretOnFlop(table, sigmaOop, sigmaIp, f, undefined),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  const pluginBb = pluginPerFlop.reduce((s, r, i) => s + (weights[i] / total) * r.bb, 0);
  const pluginBtn = pluginPerFlop.reduce((s, r, i) => s + (weights[i] / total) * r.btn, 0);

  const bb = summarise(bbPerFlop, weights, table.flops, strata, pluginBb);
  const btn = summarise(btnPerFlop, weights, table.flops, strata, pluginBtn);
  const combinedSe = weightedMeanSe(bothPerFlop, weights, table.flops, strata);
  const combined = bothPerFlop.reduce((s, v, i) => s + (weights[i] / total) * v, 0);
  return {
    bb,
    btn,
    combined,
    combinedSe,
    combinedLower95: Math.max(0, combined - Z95 * combinedSe),
    combinedUpper95: combined + Z95 * combinedSe,
  };
}
