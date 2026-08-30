/**
 * The solver's error budget, in one command — C3 of the accuracy programme.
 *
 *   npx tsx solver/accuracy.ts --ev <dir> [--flop-set <file>] [--against <dir>]
 *
 * Every number is reported in **big blinds**, deliberately, because that is
 * the scale `lib/play/verdict.ts` grades on: 0.1bb is the whole "correct"
 * band, 0.5bb "acceptable", 0.75bb a blunder. An error budget expressed in
 * any other unit cannot be compared against the thing it threatens.
 *
 * ## Why this exists
 *
 * Before it, the solver's accuracy was four numbers scattered across a doc, a
 * commit message and nobody's head — and two of them were wrong. The
 * "~143 hours per batch" figure was quoted for months without being checked
 * against a run, and the iteration loop was believed to be unconverged when
 * its EVs had been stable to 0.004bb for two iterations. Both were cheap to
 * measure and expensive to assume.
 *
 * ## The three errors it reports
 *
 * 1. **Composition** — is the flop sample representative of real flop space?
 *    This is a BIAS: it does not shrink with more flops of the same kind, so
 *    it is a publication GATE rather than a statistic.
 * 2. **Precision** — the sampling standard error of each class mean. Shrinks
 *    as 1/sqrt(n), and is what more compute buys.
 * 3. **Stability** — how far the EVs moved since the previous iteration.
 *    This is the stopping rule: once it is well inside the precision, another
 *    iteration is re-solving every flop to chase a number smaller than the
 *    noise on that same number.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  enumerateClasses,
  stratify,
  stratumOfFlop,
} from "./flops/build";
import {
  EQUAL_WEIGHTS,
  loadEvTable,
  loadFlopWeights,
  type EvTable,
  type FlopWeights,
} from "./preflop/evtable";

/** Chips are tenths of a big blind everywhere in this pipeline. */
const bb = (chips: number) => chips / 10;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
};
const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

/** The true share of flop space each stratum carries. */
export function trueStratumWeights(): Map<string, number> {
  const { classes, totalFlops } = enumerateClasses();
  return new Map(stratify(classes, totalFlops).map((s) => [s.key, s.probability]));
}

export interface CompositionRow {
  stratum: string;
  truth: number;
  sampled: number;
  /** sampled / truth. 1.00 is perfect; 0 means the stratum is absent. */
  ratio: number;
}

export interface CompositionReport {
  rows: CompositionRow[];
  /** Total absolute deviation from truth, 0..2. Zero for a weighted set. */
  totalDeviation: number;
  missing: string[];
  ok: boolean;
}

/**
 * Is this sample representative of flop space?
 *
 * `tolerance` is the total absolute deviation allowed across strata. A set
 * built by `flops/build.ts` scores 0 by construction; the shipped 25-flop
 * set scores about 0.78, with two strata absent entirely.
 */
export function composition(
  flops: readonly string[],
  weights: readonly number[],
  tolerance = 0.02
): CompositionReport {
  const truth = trueStratumWeights();
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const sampled = new Map<string, number>();
  flops.forEach((flop, i) => {
    const key = stratumOfFlop(flop);
    sampled.set(key, (sampled.get(key) ?? 0) + weights[i] / totalWeight);
  });

  const rows: CompositionRow[] = [...truth]
    .map(([stratum, t]) => {
      const s = sampled.get(stratum) ?? 0;
      return { stratum, truth: t, sampled: s, ratio: t > 0 ? s / t : 0 };
    })
    .sort((a, b) => b.truth - a.truth);

  const totalDeviation = rows.reduce((sum, r) => sum + Math.abs(r.sampled - r.truth), 0);
  const missing = rows.filter((r) => r.sampled === 0).map((r) => r.stratum);
  return { rows, totalDeviation, missing, ok: totalDeviation <= tolerance && missing.length === 0 };
}

export interface PrecisionReport {
  /** Standard error of a class mean, in big blinds. */
  medianSe: number;
  p90Se: number;
  maxSe: number;
  /** Classes whose two actions are closer together than their own error. */
  unresolvable: { player: string; count: number; total: number }[];
}

export function precision(table: EvTable, strata?: Map<string, string>): PrecisionReport {
  const all: number[] = [];
  const unresolvable: PrecisionReport["unresolvable"] = [];
  for (const player of [0, 1] as const) {
    const se = table.classStandardError(player, strata);
    const mean = table.classMean(player);
    const values = [...se.values()].map(bb);
    all.push(...values);
    // A hand is unresolvable when the gap between acting and folding is
    // smaller than the error on it. BB's threshold is ev - 25 > -10; BTN's
    // open EV is dominated by a noise-free dead-money term, so only the
    // called branch carries error and its margin is compared directly.
    const threshold = player === 0 ? 15 : 0;
    let count = 0;
    for (const [cls, value] of mean) {
      if (Math.abs(value - threshold) < (se.get(cls) ?? 0)) count++;
    }
    unresolvable.push({ player: player === 0 ? "BB" : "BTN", count, total: mean.size });
  }
  return {
    medianSe: median(all),
    p90Se: quantile(all, 0.9),
    maxSe: Math.max(...all),
    unresolvable,
  };
}

export interface StabilityReport {
  medianDelta: number;
  p90Delta: number;
  maxDelta: number;
  /** medianDelta as a fraction of the sampling SE. Below 0.1 means converged. */
  ratioToNoise: number;
  converged: boolean;
}

/**
 * How far the EVs moved since the previous iteration — the stopping rule.
 *
 * Measured 2026-08-07 between iterations 3 and 4: median 0.004bb (BB) and
 * 0.013bb (BTN) against a 0.39bb noise floor, a ratio of 0.01-0.04. Every one
 * of the 169 classes moved less than the noise. The loop had been converged
 * for at least two iterations while the plan called for two more.
 */
export function stability(
  previous: EvTable,
  current: EvTable,
  strata?: Map<string, string>,
  threshold = 0.1
): StabilityReport {
  const deltas: number[] = [];
  const ses: number[] = [];
  for (const player of [0, 1] as const) {
    const a = previous.classMean(player);
    const b = current.classMean(player);
    const se = current.classStandardError(player, strata);
    for (const [cls, after] of b) {
      const before = a.get(cls);
      if (before === undefined) continue;
      deltas.push(Math.abs(bb(after - before)));
      ses.push(bb(se.get(cls) ?? 0));
    }
  }
  const med = median(deltas);
  const noise = median(ses);
  const ratio = noise > 0 ? med / noise : Number.POSITIVE_INFINITY;
  return {
    medianDelta: med,
    p90Delta: quantile(deltas, 0.9),
    maxDelta: Math.max(...deltas),
    ratioToNoise: ratio,
    converged: ratio < threshold,
  };
}

/**
 * Which of a directory's solved boards the flop set does not ask for.
 *
 * Non-empty means the directory was solved over a DIFFERENT flop set, and a
 * stability comparison against it would conflate a composition change with a
 * stability change: the measured movement would be about which boards were
 * sampled, not about whether the strategy stopped moving — precisely the
 * confusion section 3 exists to prevent. So the refusal stands; this exists
 * only to report it in the report's own voice instead of a stack trace.
 * (`loadEvTable`'s throw stays in place as the backstop for every other
 * caller.)
 *
 * Under EQUAL_WEIGHTS there is no set to disagree with, so nothing is absent.
 */
export function flopsAbsentFromSet(flops: readonly string[], weights: FlopWeights): string[] {
  if (weights === EQUAL_WEIGHTS) return [];
  return flops.filter((f) => !weights.has(f));
}

/** Flop ids present in an ev directory, without loading the EVs. */
function flopsIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ev.json"))
    .sort()
    .map((f) => (JSON.parse(readFileSync(join(dir, f), "utf8")) as { flop: string }).flop);
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const evDir = flag("ev");
  if (!evDir) {
    console.error(
      "usage: npx tsx solver/accuracy.ts --ev <dir> [--flop-set <file>] [--against <dir>]"
    );
    process.exit(2);
  }
  const setPath = flag("flop-set");
  const weights: FlopWeights = setPath ? loadFlopWeights(resolve(setPath)) : EQUAL_WEIGHTS;
  const table = loadEvTable(resolve(evDir), weights);
  const strata = new Map(table.flops.map((f) => [f, stratumOfFlop(f)]));

  console.log(`\n=== ${evDir} — ${table.flops.length} flops, ${setPath ?? "equal weights"} ===\n`);

  // ---- 1. composition: a bias, so a gate ----------------------------------
  const comp = composition(table.flops, table.flopWeights);
  console.log("1. COMPOSITION — is the sample representative of flop space?");
  console.log("   stratum              true    sampled   ratio");
  for (const r of comp.rows) {
    const flagged = Math.abs(r.ratio - 1) > 0.1 ? "  <<<" : "";
    console.log(
      `   ${r.stratum.padEnd(20)} ${(100 * r.truth).toFixed(1).padStart(5)}%  ` +
        `${(100 * r.sampled).toFixed(1).padStart(6)}%  ${r.ratio.toFixed(2).padStart(6)}x${flagged}`
    );
  }
  if (comp.missing.length > 0) {
    console.log(`   MISSING ENTIRELY: ${comp.missing.join(", ")}`);
  }
  console.log(
    `   total deviation ${comp.totalDeviation.toFixed(3)} — ${comp.ok ? "PASS" : "FAIL"}`
  );
  if (!comp.ok) {
    console.log(
      "   This is a BIAS. It does not shrink with more flops of the same kind,\n" +
        "   so no amount of extra compute removes it. Rebuild the set with\n" +
        "   `npx tsx solver/flops/build.ts` and re-solve."
    );
  }

  // ---- 2. precision --------------------------------------------------------
  const prec = precision(table, setPath ? strata : undefined);
  console.log("\n2. PRECISION — sampling error of a class EV");
  console.log(
    `   median ${prec.medianSe.toFixed(3)}bb   p90 ${prec.p90Se.toFixed(3)}bb   ` +
      `max ${prec.maxSe.toFixed(3)}bb`
  );
  console.log(
    `   for scale, verdict.ts bands are 0.10 / 0.50 / 0.75bb — ` +
      `the error is ${(prec.medianSe / 0.1).toFixed(1)}x the whole "correct" band`
  );
  for (const u of prec.unresolvable) {
    console.log(
      `   ${u.player}: ${u.count}/${u.total} classes sit within their own error of the fold threshold`
    );
  }

  // ---- 3. stability --------------------------------------------------------
  const againstDir = flag("against");
  if (againstDir) {
    const previousFlops = flopsIn(resolve(againstDir));
    const absent = flopsAbsentFromSet(previousFlops, weights);
    if (absent.length > 0) {
      const named = absent.slice(0, 4).join(", ") + (absent.length > 4 ? ", ..." : "");
      console.log(`\n3. STABILITY — NOT MEASURED: the two directories were solved over different flop sets`);
      console.log(
        `   ${againstDir} holds ${previousFlops.length} boards, of which ${absent.length} are\n` +
          `   absent from ${setPath ?? "the flop set"} (${named}).`
      );
      console.log(
        "   Comparing EV tables built over different flop sets conflates a\n" +
          "   COMPOSITION change with a STABILITY change: the movement would measure\n" +
          "   which boards were sampled, not whether the strategy stopped moving."
      );
      console.log(
        "   --against needs a directory solved over the SAME flop set as --ev."
      );
      console.log("");
      process.exit(1);
    }
    const previous = loadEvTable(resolve(againstDir), weights);
    const stab = stability(previous, table, setPath ? strata : undefined);
    console.log(`\n3. STABILITY — movement since ${againstDir}`);
    console.log(
      `   median |delta| ${stab.medianDelta.toFixed(4)}bb   p90 ${stab.p90Delta.toFixed(4)}bb   ` +
        `max ${stab.maxDelta.toFixed(3)}bb`
    );
    console.log(
      `   that is ${stab.ratioToNoise.toFixed(3)}x the sampling error — ` +
        `${stab.converged ? "CONVERGED, stop iterating" : "still moving, iterate again"}`
    );
    if (stab.converged) {
      console.log(
        "   Another iteration re-solves every flop to chase a change far\n" +
          "   smaller than the noise on the same numbers. Spend the compute on\n" +
          "   FLOPS instead — that is the error that is actually binding."
      );
    }
  } else {
    console.log("\n3. STABILITY — pass --against <previous-ev-dir> to measure it");
  }

  console.log("");
  process.exit(comp.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith("accuracy.ts")) main();
