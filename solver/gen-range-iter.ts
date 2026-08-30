/**
 * The range-update driver: postflop root EVs in, the next iteration's solver
 * ranges out — and the diff that says whether an iteration moved the strategy.
 *
 *   # produce the next iteration's ranges
 *   npx tsx solver/gen-range-iter.ts --ev solver/ev/iter3 \
 *     --prev solver/ranges-iter3-srp-btn-bb.json --n 3 \
 *     --out solver/ranges-iter4-srp-btn-bb.json
 *
 *   # check the driver against what the loop actually produced
 *   npx tsx solver/gen-range-iter.ts --ev solver/ev/iter3 \
 *     --prev solver/ranges-iter3-srp-btn-bb.json --n 3 \
 *     --verify solver/ranges-iter4-srp-btn-bb.json
 *
 *   # did a different flop sample change the strategy, or only its precision?
 *   npx tsx solver/gen-range-iter.ts --ev solver/ev/iter4 \
 *     --against-ev solver/ev/set100-iter4 \
 *     --against-flop-set solver/flops/set-100.json
 *
 * WHICH EV DIRECTORY PRODUCES WHICH RANGE FILE. `ev/iterN` is the postflop
 * solve run WITH `ranges-iterN`, so its best response is what produces
 * `ranges-iter(N+1)`. `ranges-iter4` was therefore derived from `ev/iter3`,
 * not from `ev/iter4` — and `ev/iter4`'s best response is the iteration-4 row
 * in docs/14, whose averaged ranges were never written. Getting this off by
 * one silently compares two different iterations.
 *
 * FLOP WEIGHTS ARE AN ANALYSIS INPUT. They are applied here, at averaging
 * time. They never enter a solve: solving a board does not depend on how much
 * of flop space that board stands for.
 *
 * Units are chips throughout, 10 = 1bb.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stratumOfFlop } from "./flops/build";
import {
  ALL_COMBOS,
  EQUAL_WEIGHTS,
  loadEvTable,
  loadFlopWeights,
  type EvTable,
  type FlopWeights,
} from "./preflop/evtable";
import {
  BB_CALL_THRESHOLD,
  BB_POST,
  DEAD_SB,
  OPEN,
  assertPayoffInvariant,
  bestResponse,
  combosOfClass,
  fictitiousPlay,
  formatRangeString,
  gridHands,
  impliedFictitiousPlayCount,
  parseRangeString,
  rangePercent,
  serialiseRangeFile,
  type BestResponse,
} from "./preflop/rangeUpdate";
import { aggregateRegret } from "./preflop/regret";

export interface EvSource {
  dir: string;
  flopSet?: string;
}

export interface LoadedEv {
  table: EvTable;
  br: BestResponse;
  /** flop -> stratum, when the set was stratified. Undefined otherwise. */
  strata?: Map<string, string>;
  label: string;
}

/** Load one EV directory and take its best response. */
export function loadSource(src: EvSource): LoadedEv {
  const weights: FlopWeights = src.flopSet
    ? loadFlopWeights(resolve(src.flopSet))
    : EQUAL_WEIGHTS;
  const table = loadEvTable(resolve(src.dir), weights);
  assertPayoffInvariant(table.pot);
  const br = bestResponse(table.comboMean(0), table.comboMean(1));
  return {
    table,
    br,
    strata: src.flopSet
      ? new Map(table.flops.map((f) => [f, stratumOfFlop(f)]))
      : undefined,
    label: `${src.dir}${src.flopSet ? ` (weighted by ${src.flopSet})` : " (equal weights)"}`,
  };
}

// `rangePercent` lives in preflop/rangeUpdate.ts so `preflop/regret.ts` can
// use it without importing this driver. Re-exported because callers and tests
// have always imported it from here.
export { rangePercent };

export interface ClassMove {
  hand: string;
  from: number;
  to: number;
  /** Change in the class's frequency, in combos. */
  combos: number;
  /** Change in the class's mean EV, in chips. */
  evDelta: number;
  /**
   * The standard error OF THAT DIFFERENCE, in chips.
   *
   * Not either sample's own SE: the two samples are different flops, so their
   * errors add in quadrature. Using the larger of the two would flag moves as
   * real that two independent draws of the same quantity would produce
   * anyway.
   */
  se: number;
}

/**
 * Compare one side's best response between two EV samples.
 *
 * The EV columns are what makes a move interpretable. A class whose mean EV
 * moved less than the standard error of that difference has not moved — the
 * median class SE on these samples is ~0.24bb, larger than the whole 0.10bb
 * "correct" band — so a frequency change under it is a boundary combo
 * jittering across a threshold, not a strategy change.
 */
export function compareSide(
  a: LoadedEv,
  b: LoadedEv,
  player: 0 | 1,
  side: "bbClass" | "btnClass",
): ClassMove[] {
  const fa = a.br[side];
  const fb = b.br[side];
  const evA = a.table.classMean(player);
  const evB = b.table.classMean(player);
  const seA = a.table.classStandardError(player, a.strata);
  const seB = b.table.classStandardError(player, b.strata);
  const moves: ClassMove[] = [];
  for (const hand of gridHands()) {
    const from = fa.get(hand) ?? 0;
    const to = fb.get(hand) ?? 0;
    if (from === to) continue;
    moves.push({
      hand,
      from,
      to,
      combos: (to - from) * combosOfClass(hand),
      evDelta: (evB.get(hand) ?? 0) - (evA.get(hand) ?? 0),
      se: Math.hypot(seA.get(hand) ?? 0, seB.get(hand) ?? 0),
    });
  }
  moves.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from));
  return moves;
}

export interface GapRow {
  hand: string;
  /** The range file's frequency for this class. */
  sigma: number;
  /** The best response's frequency. */
  br: number;
  /** |br - sigma| in combos. */
  combos: number;
  /** How far the class's mean EV sits from its decision threshold, in chips. */
  margin: number;
  /** The standard error of that class mean, in chips. */
  se: number;
  /** margin > se: the EVs can actually tell the two frequencies apart. */
  resolvable: boolean;
}

export interface GapReport {
  rows: GapRow[];
  /** Total |br - sigma| across classes, in combos. */
  combosMoved: number;
  /** Classes where BR and sigma disagree by half the class or more. */
  decisive: number;
  /** Decisive AND the class EV margin exceeds its own SE — a real disagreement. */
  decisiveResolvable: number;
  /**
   * What the disagreement COSTS, in chips per hand dealt.
   *
   * The frequency gap is the practical stopping rule, but it is not the
   * quantity that vanishes at a fixed point: fictitious play's average is
   * mixed and a best response is pure, so ‖BR − σ‖ stays positive at any
   * genuinely mixed class forever. What vanishes is the EV given up by
   * playing σ instead of the best response, which is
   * `prior(class) * |σ − br| * margin * scale` summed over classes — a class
   * that mixes only because it is INDIFFERENT contributes nothing, because
   * its margin is zero. That is the theoretically right convergence measure
   * and it costs nothing extra to compute.
   */
  evCost: number;
  /** The same sum over resolvable classes only — the part the sample can see. */
  evCostResolvable: number;
}

/**
 * The fictitious-play gap ‖BR(σ) − σ‖ — the STOPPING statistic for the loop.
 *
 * Iterate-to-iterate movement is the wrong statistic, and the reason is
 * structural: fictitious play's step size is (BR − σ)/(n+1), so it decays as
 * 1/k BY CONSTRUCTION whether or not σ is anywhere near the fixed point. A
 * stability threshold on consecutive iterates can therefore be reached by
 * damping alone — a false CONVERGED with a decimal point on it. The gap does
 * not shrink from damping: it is zero exactly when σ is a best response to
 * the EVs it produces, and it costs no extra compute to measure.
 *
 * Measured at the switch to the representative sample (2026-08-08): the BR to
 * `ev/set100-iter4` sits 15.6% (BB) / 14.5% (BTN) of hands away from
 * `ranges-iter4` itself, while a damped n=4 step moves only ~2.9% / ~2.7% —
 * the gap is 5x the step, which is exactly the false-convergence hazard.
 *
 * `resolvable` guards the other direction: a class whose EV margin from its
 * own threshold is inside its sampling SE will jitter across the boundary
 * forever, so demanding gap → 0 outright would chase noise. The stopping rule
 * is decisiveResolvable === 0: every remaining disagreement is inside the
 * precision the sample actually has.
 *
 * The floor is invisible here by construction: sigma carries FLOOR where the
 * BR has 0, so sub-floor differences are not counted as gap.
 */
export function fpGap(
  brClass: Map<string, number>,
  sigmaClass: Map<string, number>,
  classMean: Map<string, number>,
  classSe: Map<string, number>,
  threshold: number,
  /**
   * Chips of EV per unit of frequency per unit of margin — 1 for BB, whose
   * call/fold difference IS `ev - 15`, and the call frequency `p` for BTN,
   * whose open EV is `p * (ev - btnThreshold)`. Getting this wrong overstates
   * BTN's cost by ~28% at p≈0.78, which is exactly the class of unit error
   * this pipeline keeps being bitten by.
   */
  scale = 1,
): GapReport {
  const rows: GapRow[] = [];
  let evCost = 0;
  let evCostResolvable = 0;
  for (const hand of gridHands()) {
    const sigma = sigmaClass.get(hand) ?? 0;
    const br = brClass.get(hand) ?? 0;
    if (Math.abs(br - sigma) <= 0.02 + 1e-9) continue; // the exploration floor
    const margin = Math.abs((classMean.get(hand) ?? threshold) - threshold);
    const se = classSe.get(hand) ?? 0;
    const combos = combosOfClass(hand);
    const resolvable = margin > se;
    const cost = (combos / ALL_COMBOS.length) * Math.abs(br - sigma) * margin * scale;
    evCost += cost;
    if (resolvable) evCostResolvable += cost;
    rows.push({
      hand,
      sigma,
      br,
      combos: Math.abs(br - sigma) * combos,
      margin,
      se,
      resolvable,
    });
  }
  rows.sort((a, b) => b.combos - a.combos);
  const decisiveRows = rows.filter((r) => Math.abs(r.br - r.sigma) >= 0.5);
  return {
    rows,
    combosMoved: rows.reduce((s, r) => s + r.combos, 0),
    decisive: decisiveRows.length,
    decisiveResolvable: decisiveRows.filter((r) => r.resolvable).length,
    evCost,
    evCostResolvable,
  };
}

function reportGap(name: string, gap: GapReport): void {
  console.log(`\n${name}`);
  console.log(
    `  gap ‖BR − σ‖: ${gap.combosMoved.toFixed(0)}/1326 combos ` +
      `(${((100 * gap.combosMoved) / ALL_COMBOS.length).toFixed(1)}% of hands)   ` +
      `decisive classes: ${gap.decisive}   of them resolvable: ${gap.decisiveResolvable}`,
  );
  console.log(
    `  EV cost of playing σ instead of the BR: ${(gap.evCost / 10).toFixed(4)}bb/hand ` +
      `(resolvable part ${(gap.evCostResolvable / 10).toFixed(4)}bb/hand)`,
  );
  const shown = gap.rows.filter((r) => Math.abs(r.br - r.sigma) >= 0.5).slice(0, 15);
  if (shown.length > 0) {
    console.log("  hand    sigma ->  BR     margin(bb)  SE(bb)  resolvable");
    for (const r of shown) {
      console.log(
        `  ${r.hand.padEnd(6)} ${r.sigma.toFixed(3)} -> ${r.br.toFixed(3)}   ` +
          `${(r.margin / 10).toFixed(3).padStart(8)}  ${(r.se / 10).toFixed(3).padStart(6)}   ` +
          `${r.resolvable ? "yes" : "no"}`,
      );
    }
  }
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function reportBr(loaded: LoadedEv): void {
  const { table, br } = loaded;
  console.log(`\n${loaded.label}`);
  console.log(
    `  flops averaged: ${table.flops.length}   pot: ${table.pot} chips   ` +
      `coverage OOP ${table.coverage(0)}/${ALL_COMBOS.length} IP ${table.coverage(1)}/${ALL_COMBOS.length}`,
  );
  if (table.coverage(0) < ALL_COMBOS.length * 0.99) {
    console.log(
      "  *** INCOMPLETE: hands missing from the postflop solve cannot be\n" +
        "      evaluated here. Re-run with wider ranges — docs/14-m87a-solver-scope.md.",
    );
  }
  console.log(`  BTN open: ${rangePercent(br.btnClass).toFixed(1)}%   BB call: ${rangePercent(br.bbClass).toFixed(1)}%`);
}

function reportMoves(name: string, moves: ClassMove[]): void {
  const combos = moves.reduce((s, m) => s + Math.abs(m.combos), 0);
  const beyondSe = moves.filter((m) => Math.abs(m.evDelta) > m.se);
  const decisive = moves.filter((m) => Math.abs(m.to - m.from) >= 0.5);
  console.log(`\n${name}`);
  console.log(
    `  classes that changed: ${moves.length}/169   combos moved: ${combos.toFixed(0)}/1326 ` +
      `(${((100 * combos) / ALL_COMBOS.length).toFixed(1)}% of hands)`,
  );
  console.log(
    `  changed by half the class or more: ${decisive.length}   ` +
      `EV moved beyond the standard error of the difference: ${beyondSe.length}`,
  );
  if (moves.length === 0) return;
  console.log("  hand    from ->   to    dEV(bb)  SE(diff)  beyond SE");
  for (const m of moves.slice(0, 25)) {
    console.log(
      `  ${m.hand.padEnd(6)} ${m.from.toFixed(3)} -> ${m.to.toFixed(3)}   ` +
        `${(m.evDelta / 10).toFixed(3).padStart(7)}    ${(m.se / 10).toFixed(3).padStart(6)}   ` +
        `${Math.abs(m.evDelta) > m.se ? "yes" : "no"}`,
    );
  }
  if (moves.length > 25) console.log(`  ... and ${moves.length - 25} more`);
}

function main(): void {
  const argv = process.argv.slice(2);
  const evDir = arg(argv, "ev");
  if (!evDir) {
    console.error(
      "usage: npx tsx solver/gen-range-iter.ts --ev <dir> [--flop-set <set.json>]\n" +
        "         [--prev <ranges.json> --n <k> (--out <ranges.json> | --verify <ranges.json>)]\n" +
        "         [--against-ev <dir> [--against-flop-set <set.json>]]\n" +
        "         [--gap <ranges.json>] [--regret <ranges.json>]",
    );
    process.exit(2);
  }

  const source = loadSource({ dir: evDir, flopSet: arg(argv, "flop-set") });
  reportBr(source);

  const againstDir = arg(argv, "against-ev");
  if (againstDir) {
    const other = loadSource({ dir: againstDir, flopSet: arg(argv, "against-flop-set") });
    reportBr(other);
    reportMoves("BB call — best response moves", compareSide(source, other, 0, "bbClass"));
    reportMoves("BTN open — best response moves", compareSide(source, other, 1, "btnClass"));
  }

  const gapPath = arg(argv, "gap");
  if (gapPath) {
    const sigma = JSON.parse(readFileSync(resolve(gapPath), "utf8"));
    console.log(`\nFP gap of ${gapPath} against the best response to ${evDir}`);
    console.log("  (the stopping statistic: damping cannot shrink it — see fpGap)");
    const seOop = source.table.classStandardError(0, source.strata);
    const seIp = source.table.classStandardError(1, source.strata);
    // BTN's open/fold boundary ON THE POSTFLOP-EV SCALE. Open EV is
    // (1-p)*(DEAD_SB+BB_POST) + p*(ev - OPEN) with p = BB's call frequency, so
    // the boundary sits at ev = OPEN - (DEAD_SB+BB_POST)*(1-p)/p — about 20.7
    // chips at p≈0.78, NOT 0. Comparing against 0 (accuracy.ts's shorthand for
    // a different question) overstates every BTN margin by ~2bb, which would
    // classify pure boundary jitter as resolvable and make the stopping rule
    // unreachable. Card removal shifts p per hand by <1%, noise at this
    // precision, so the range-level p is used.
    const pCall = rangePercent(source.br.bbClass) / 100;
    const btnThreshold = OPEN - ((DEAD_SB + BB_POST) * (1 - pCall)) / pCall;
    reportGap(
      "BB call — gap",
      fpGap(
        source.br.bbClass,
        parseRangeString(sigma.oop),
        source.table.classMean(0),
        seOop,
        BB_CALL_THRESHOLD,
      ),
    );
    reportGap(
      `BTN open — gap (threshold ${(btnThreshold / 10).toFixed(2)}bb at ${(100 * pCall).toFixed(1)}% calls)`,
      // scale = pCall: BTN's open EV is p*(ev - btnThreshold), so a chip of
      // postflop margin is only worth p chips at the decision.
      fpGap(
        source.br.btnClass,
        parseRangeString(sigma.ip),
        source.table.classMean(1),
        seIp,
        btnThreshold,
        pCall,
      ),
    );
  }

  const regretPath = arg(argv, "regret");
  if (regretPath) {
    const sigma = JSON.parse(readFileSync(resolve(regretPath), "utf8"));
    const r = aggregateRegret(
      source.table,
      parseRangeString(sigma.oop),
      parseRangeString(sigma.ip),
      source.strata,
    );
    const bb = (x: number) => (x / 10).toFixed(4).padStart(8);
    console.log(`\nSTRATEGIC REGRET of ${regretPath} against the best response to ${evDir}`);
    console.log("  cross-fitted (leave-one-flop-out), bb per hand dealt:");
    console.log("  side        regret       SE     95% lower   95% upper    plug-in");
    for (const [name, s] of [["BB call", r.bb], ["BTN open", r.btn]] as const) {
      console.log(
        `  ${name.padEnd(10)}${bb(s.crossFitted)} ${bb(s.se)}   ${bb(s.lower95)}  ${bb(s.upper95)}  ${bb(s.plugin)}`,
      );
    }
    console.log(
      `  combined  ${bb(r.combined)} ${bb(r.combinedSe)}   ${bb(r.combinedLower95)}  ${bb(r.combinedUpper95)}`,
    );
    console.log(
      `  → remaining regret is ${r.combinedLower95 > 0 ? "DISTINGUISHABLE from zero" : "NOT distinguishable from zero"}` +
        ` at one-sided 95% over this flop sample.`,
    );
  }

  const prevPath = arg(argv, "prev");
  const outPath = arg(argv, "out");
  const verifyPath = arg(argv, "verify");
  if (!outPath && !verifyPath) return;

  let prevOop: Map<string, number> | undefined;
  let prevIp: Map<string, number> | undefined;
  if (prevPath) {
    const prev = JSON.parse(readFileSync(resolve(prevPath), "utf8"));
    prevOop = parseRangeString(prev.oop);
    prevIp = parseRangeString(prev.ip);
    const implied = impliedFictitiousPlayCount(prevIp);
    console.log(
      `\nprevious ranges: ${prevPath}` +
        (implied === null ? "" : `   (averages ${implied + 1} best responses -> --n ${implied + 1})`),
    );
  }
  const nArg = arg(argv, "n");
  if (prevPath && nArg === undefined) {
    console.error("--prev needs --n: how many best responses it already averages.");
    process.exit(2);
  }
  const n = Number(nArg ?? 1);

  const file = {
    spot: "srp-btn-bb",
    oop: formatRangeString(fictitiousPlay(source.br.bbClass, prevOop, n)),
    ip: formatRangeString(fictitiousPlay(source.br.btnClass, prevIp, n)),
    pot: source.table.pot,
    stack: source.table.stack,
  };
  const text = serialiseRangeFile(file);

  if (outPath) {
    writeFileSync(resolve(outPath), text);
    console.log(`wrote ${outPath}`);
  }
  if (verifyPath) {
    if (!existsSync(resolve(verifyPath))) {
      console.error(`--verify: ${verifyPath} does not exist`);
      process.exit(1);
    }
    const expected = readFileSync(resolve(verifyPath), "utf8");
    if (expected === text) {
      console.log(`VERIFIED: byte-identical to ${verifyPath}`);
    } else {
      console.error(`MISMATCH: does not reproduce ${verifyPath}`);
      process.exit(1);
    }
  }
}

if (process.argv[1]?.endsWith("gen-range-iter.ts")) main();
