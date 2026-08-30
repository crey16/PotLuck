/**
 * The range-update step of the preflop loop, as a library.
 *
 *   postflop root EVs  ->  preflop best response  ->  damped by fictitious play
 *
 * That sentence is the published pack's own provenance
 * (`solver/pack/srp-btn-bb/preflop.json`), and this module is the one place it
 * is implemented. Iterations 1-4 were produced by the same arithmetic written
 * inline in `solver/preflop-br.ts`; `rangeUpdate.test.ts` re-derives the
 * committed `ranges-iter4-srp-btn-bb.json` through this module and requires it
 * to match byte for byte, so the two cannot drift.
 *
 * WHY THAT REPRODUCTION GATE IS THE POINT OF THIS FILE. The question the
 * driver exists to answer is whether the biased 25-flop sample changed the
 * STRATEGY or only its precision. That is a diff between two runs. If the code
 * producing the new run is not the code that produced the old one, the diff
 * measures the rewrite instead — and it would look exactly like an answer.
 *
 * THE TREE (chips: 10 = 1bb; SB posts 5 and folds, BB posts 10):
 *
 *   BTN  fold                      -> BTN   0
 *        open to 25
 *          BB fold                 -> BTN +15, BB -10
 *          BB call                 -> BTN ev_ip-25, BB ev_oop-25   (postflop)
 *
 * Every terminal sums to +5 across the two players — the dead small blind they
 * split. `assertPayoffInvariant` checks it, because a sign error here is
 * invisible in the output and fatal to the result.
 *
 * WHY BEST RESPONSE AND NOT CFR. With the postflop EVs held fixed, BB's
 * call/fold threshold does not depend on BTN's opening frequency — the EVs
 * already encode the ranges that produced them. The strategic coupling
 * reappears only ACROSS iterations. `preflop/cfr.ts` exists for the full tree,
 * where a 3-bet makes each player's frequency a best response to the other's;
 * this slice has no 3-bet, so running CFR over it would add machinery that
 * changes nothing and would break the reproduction above.
 *
 * UNITS: chips throughout, 10 = 1bb. EVs from `root-ev` are each player's
 * SHARE OF THE FINAL POT, not net chips — see docs/14-m87a-solver-scope.md.
 */
import { handAt } from "../../lib/poker/ranges";
import { ALL_COMBOS, blocks, classFrequencyOf } from "./evtable";

/** BTN's open, in chips. */
export const OPEN = 25;
/** The small blind's dead chips. */
export const DEAD_SB = 5;
/** The big blind's post, in chips. */
export const BB_POST = 10;

/**
 * BB calls iff calling beats folding: fold = -BB_POST, call = ev_oop - OPEN,
 * so call iff ev_oop > OPEN - BB_POST.
 */
export const BB_CALL_THRESHOLD = OPEN - BB_POST;

/**
 * The exploration floor, learned from iteration 2.
 *
 * Iteration 1 solved at 100% ranges so every hand had an EV. Narrower ranges
 * drop the excluded hands out of the postflop solve and they lose their EVs —
 * coverage fell 1326 -> 1194 and the loop could no longer tell whether a
 * folded hand should come back. Keeping every hand at a small weight costs
 * almost nothing strategically and keeps every EV computable.
 */
export const FLOOR = 0.02;

export interface BestResponse {
  /** BB's calling combos. */
  bbCalls: Set<string>;
  /** BTN's opening combos. */
  btnOpens: Set<string>;
  /** BB's calls as 169-class frequencies. */
  bbClass: Map<string, number>;
  /** BTN's opens as 169-class frequencies. */
  btnClass: Map<string, number>;
}

/**
 * Both players' best response to a fixed table of postflop root EVs.
 *
 * BTN's side carries card removal: holding one of BB's cards makes a call
 * fractionally less likely, so the open EV is computed against the callable
 * fraction of the combos BTN does not block.
 */
export function bestResponse(
  oopCombos: Map<string, number>,
  ipCombos: Map<string, number>,
): BestResponse {
  const bbCalls = new Set<string>();
  for (const c of ALL_COMBOS) {
    const ev = oopCombos.get(c);
    if (ev !== undefined && ev > BB_CALL_THRESHOLD) bbCalls.add(c);
  }

  const btnOpens = new Set<string>();
  for (const y of ALL_COMBOS) {
    const ev = btnOpenEv(y, ipCombos, bbCalls);
    if (ev !== null && ev > 0) btnOpens.add(y);
  }

  return {
    bbCalls,
    btnOpens,
    bbClass: classFrequencyOf((c) => bbCalls.has(c)),
    btnClass: classFrequencyOf((c) => btnOpens.has(c)),
  };
}

/** BTN's EV for opening `y`, in chips, against a known calling range. */
export function btnOpenEv(
  y: string,
  ipCombos: Map<string, number>,
  bbCalls: ReadonlySet<string>,
): number | null {
  const evIp = ipCombos.get(y);
  if (evIp === undefined) return null;
  let live = 0;
  let calls = 0;
  for (const x of ALL_COMBOS) {
    if (blocks(y, x)) continue;
    live++;
    if (bbCalls.has(x)) calls++;
  }
  const pCall = live > 0 ? calls / live : 0;
  return (1 - pCall) * (DEAD_SB + BB_POST) + pCall * (evIp - OPEN);
}

/**
 * Every terminal must sum to the dead small blind across the two players.
 *
 * `pot` is the postflop pot in chips as the solve reports it, so the check is
 * that the two open bets plus the dead blind are what is being played for.
 */
export function assertPayoffInvariant(pot: number): void {
  const bbFold = DEAD_SB + BB_POST + -BB_POST;
  if (bbFold !== DEAD_SB) {
    throw new Error(`BB-fold terminal sums to ${bbFold}, expected ${DEAD_SB}`);
  }
  const postflop = pot - 2 * OPEN;
  if (postflop !== DEAD_SB) {
    throw new Error(`postflop terminal sums to ${postflop}, expected ${DEAD_SB}`);
  }
}

/**
 * Fictitious play: the new range is the running mean of every best response so
 * far, not the latest one.
 *
 * Replacing the range with the raw best response each iteration makes the two
 * players chase each other — BB tightened 81% -> 72%, so BTN widened 76% ->
 * 79%, which pushes BB back. Averaging is the textbook damping, and it is what
 * converges where alternating best response oscillates.
 *
 * `n` is how many best responses `prev` already averages. It is not recorded
 * anywhere in the range files, but it is readable back out of them: a raw best
 * response only produces denominators dividing 12 (suited 1/4, pairs 1/6,
 * offsuit 1/12), and each averaging step multiplies the denominator by (n+1).
 * `impliedFictitiousPlayCount` does that reading. Getting `n` wrong changes
 * the damping RATE, not the fixed point.
 */
export function fictitiousPlay(
  br: Map<string, number>,
  prev: Map<string, number> | undefined,
  n: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const hand of gridHands()) {
    const b = br.get(hand) ?? 0;
    const p = prev?.get(hand);
    const avg = p === undefined ? b : (p * n + b) / (n + 1);
    out.set(hand, Math.max(avg, FLOOR));
  }
  return out;
}

/** The 169 hands in the order the solver range strings are written in. */
export function gridHands(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) out.push(handAt(i, j));
  return out;
}

/** Combos per 169-class: 6 for a pair, 4 suited, 12 offsuit. */
export const combosOfClass = (hand: string): number =>
  hand.length === 2 ? 6 : hand.endsWith("s") ? 4 : 12;

/**
 * The share of all 1,326 combos a set of class frequencies covers, as a %.
 *
 * Combo-weighted, not a mean over the 169 cells: AKo is three times as many
 * hands as AKs and a range that plays one but not the other is not "half".
 */
export function rangePercent(freq: Map<string, number>): number {
  let combos = 0;
  for (const hand of gridHands()) combos += (freq.get(hand) ?? 0) * combosOfClass(hand);
  return (100 * combos) / 1326;
}

/** `"AA,KK:0.5"` -> a frequency per class. A bare hand means 1. */
export function parseRangeString(str: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const tok of str.split(",")) {
    const [h, f] = tok.split(":");
    m.set(h, f === undefined ? 1 : Number(f));
  }
  return m;
}

/**
 * The inverse, in the solver's own format.
 *
 * Three decimals and the `>= 0.999` collapse to a bare hand are what
 * iterations 1-4 were written with; changing either would make the committed
 * files unreproducible even where the arithmetic agreed.
 */
export function formatRangeString(freq: Map<string, number>): string {
  return gridHands()
    .map((hand) => {
      const f = freq.get(hand) ?? 0;
      return f >= 0.999 ? hand : `${hand}:${+f.toFixed(3)}`;
    })
    .join(",");
}

export interface RangeFile {
  spot: string;
  oop: string;
  ip: string;
  pot: number;
  stack: number;
}

/** Serialise a range file exactly as the loop has always written one. */
export function serialiseRangeFile(file: RangeFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

/**
 * How many best responses a range file already averages, read off its
 * denominators — i.e. the `n` it was written with, plus one.
 *
 * A raw best response has denominators dividing 12 (suited 1/4, pairs 1/6,
 * offsuit 1/12), and each averaging step multiplies the denominator by (n+1).
 * So a file whose entries mostly land on 48ths averages 4 best responses and
 * was written with `n = 3`.
 *
 * MOSTLY, not all. Once the exploration floor censors an entry at 0.02, every
 * later average that inherits it is off the lattice for good — 23% of
 * `ranges-iter4` does not fit any denominator. So this scores each candidate
 * rather than requiring exactness, and returns null if none is convincing.
 * It is a diagnostic for a number that is recorded nowhere else, not a proof.
 *
 * It takes the SMALLEST k that fits as well as the best one does, not the
 * best-fitting k: every multiple of a fitting k also fits, plus whatever
 * noise it happens to catch, so "best fit" answers a multiple of the truth.
 */
export function impliedFictitiousPlayCount(freq: Map<string, number>): number | null {
  const MARGIN = 0.02;
  const fits: number[] = [];
  for (let k = 1; k <= 12; k++) {
    const denom = 12 * k;
    let fit = 0;
    let total = 0;
    for (const f of freq.values()) {
      if (f === FLOOR) continue; // censored by the floor, carries no information
      total++;
      const scaled = f * denom;
      // The files carry three decimals, so exactness is only to that rounding.
      if (Math.abs(scaled - Math.round(scaled)) <= denom * 5e-4 + 1e-9) fit++;
    }
    if (total === 0) return null;
    fits.push(fit / total);
  }
  const best = Math.max(...fits);
  if (best < 0.9) return null;
  return fits.findIndex((f) => f >= best - MARGIN);
}
