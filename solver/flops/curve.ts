/**
 * How much accuracy does a flop buy? — C4/C6 of the accuracy programme.
 *
 *   npx tsx solver/flops/curve.ts --ev solver/ev/set100-iter4 --set solver/flops/set-100.json
 *
 * Answers the two questions the batch is sized from, both by RESAMPLING one
 * solved run rather than by solving anything new:
 *
 *   1. **How does the error fall with N?** Draw many stratified subsets of
 *      size N from the solved boards, compute each one's class means, and
 *      measure how far they scatter. That scatter IS the sampling error at
 *      that N.
 *   2. **Is stratifying worth anything?** Draw unstratified subsets of the
 *      same size from the same solved boards and compare. Identical
 *      underlying solves, so the only difference is how the sample was
 *      chosen — which is the cleanest possible A/B, and the claim the whole
 *      plan rests on.
 *
 * ## The finite-population caveat, stated
 *
 * Subsets are drawn from the boards actually solved, not from all 1,755
 * classes. So a subset of size N=100 out of 100 has zero scatter, which is
 * not zero error — it is the same estimate every time. The curve is
 * trustworthy for N comfortably below the solved count and DEGENERATE as N
 * approaches it. Numbers in that region are reported with the caveat attached
 * rather than quietly printed, because a suspiciously small error is exactly
 * the kind of result that gets believed.
 *
 * The analytic stratified standard error (`evtable.ts`) is the cross-check:
 * it does not resample at all, so the two agreeing at moderate N is real
 * evidence and the two disagreeing means one of them is wrong.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { allocate, enumerateClasses, stratify, stratumOfFlop } from "./build";
import { loadEvTable, type EvTable } from "../preflop/evtable";

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string): string => {
  const i = argv.indexOf(`--${name}`);
  const v = i >= 0 ? argv[i + 1] : fallback;
  if (v === undefined) {
    console.error("usage: npx tsx solver/flops/curve.ts --ev <dir> --set <set.json>");
    process.exit(2);
  }
  return v;
};

/** Deterministic RNG — a reported curve must be reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/**
 * One flop's class means.
 *
 * `comboMean(player, skipFlop)` drops ONE flop; to isolate one we need the
 * complement, so this reads the accumulator the only way the public interface
 * allows: an EvTable over a single-flop directory would be the clean answer,
 * but re-reading files per flop is wasteful. Instead the caller loads the
 * whole directory once and this recovers each flop by difference — which is
 * exact, because the accumulation is a weighted sum.
 */
function singleFlopMeans(table: EvTable, player: 0 | 1, index: number): Map<string, number> {
  const withAll = table.classMean(player);
  const without = table.classMean(player, index);
  const wTotal = table.flopWeights.reduce((a, b) => a + b, 0);
  const wi = table.flopWeights[index];
  const out = new Map<string, number>();
  for (const [cls, all] of withAll) {
    const rest = without.get(cls);
    if (rest === undefined) continue;
    // all = (wi*x_i + (W - wi)*rest) / W  =>  x_i = (all*W - rest*(W - wi)) / wi
    out.set(cls, (all * wTotal - rest * (wTotal - wi)) / wi);
  }
  return out;
}

interface CurvePoint {
  n: number;
  stratifiedSe: number;
  unstratifiedSe: number;
  /** How many times more flops an unstratified sample would need to match. */
  efficiency: number;
  degenerate: boolean;
}

function main(): void {
  const evDir = resolve(flag("ev"));
  const setPath = resolve(flag("set"));
  const draws = Number(flag("draws", "400"));

  const set = JSON.parse(readFileSync(setPath, "utf8")) as {
    flops: { flop: string; weight: number }[];
  };
  const weights = new Map(set.flops.map((f) => [f.flop, f.weight]));
  const table = loadEvTable(evDir, weights);
  const solved = table.flops;
  console.log(`\n${solved.length} of ${set.flops.length} boards solved in ${evDir}\n`);
  if (solved.length < 24) {
    console.log("Too few boards solved to say anything about a curve yet.");
    return;
  }

  // A curve computed from boards that do not span every stratum is not a
  // curve — it compares a stratified sample against itself. This fired on the
  // first real run: 46 boards solved and all 46 two-tone/unpaired, which made
  // stratifying look WORSE than not stratifying. The emission order is now
  // interleaved so a prefix is representative, and this is the guard that
  // stops the result being read if it ever is not.
  const solvedStrata = new Set(solved.map(stratumOfFlop));
  const setStrata = new Set(set.flops.map((f) => stratumOfFlop(f.flop)));
  const absent = [...setStrata].filter((s) => !solvedStrata.has(s));
  if (absent.length > 0) {
    console.log(
      `REFUSING TO REPORT — ${absent.length} stratum/strata not yet solved: ${absent.join(", ")}.\n` +
        "Subsets drawn from an incomplete stratum set compare a sample against\n" +
        "itself; the numbers would look precise and mean nothing. Wait for the\n" +
        "run to cover every stratum."
    );
    return;
  }

  const { classes, totalFlops } = enumerateClasses();
  const strata = stratify(classes, totalFlops);
  const trueWeight = new Map(strata.map((s) => [s.key, s.probability]));
  const byStratum = new Map<string, number[]>();
  solved.forEach((flop, i) => {
    const key = stratumOfFlop(flop);
    (byStratum.get(key) ?? byStratum.set(key, []).get(key)!).push(i);
  });

  // Reference: the best estimate available, using every solved board.
  const reference = [0, 1].map((p) => table.classMean(p as 0 | 1));
  const perFlop = [0, 1].map((p) =>
    solved.map((_, i) => singleFlopMeans(table, p as 0 | 1, i))
  );

  /** Weighted class means over a chosen subset of flop indices. */
  const meansOver = (
    player: 0 | 1,
    indices: number[],
    weightOf: (i: number) => number
  ): Map<string, number> => {
    const total = indices.reduce((s, i) => s + weightOf(i), 0);
    const out = new Map<string, number>();
    for (const cls of reference[player].keys()) {
      let sum = 0;
      for (const i of indices) sum += weightOf(i) * (perFlop[player][i].get(cls) ?? 0);
      out.set(cls, sum / total);
    }
    return out;
  };

  /** RMS deviation of a subset estimate from the full-sample reference. */
  const deviation = (player: 0 | 1, means: Map<string, number>): number => {
    let ss = 0;
    let n = 0;
    for (const [cls, ref] of reference[player]) {
      const d = ((means.get(cls) ?? ref) - ref) / 10; // chips -> bb
      ss += d * d;
      n++;
    }
    return Math.sqrt(ss / n);
  };

  const sizes = [12, 25, 49, 75, 100].filter((n) => n <= solved.length);
  const points: CurvePoint[] = [];

  for (const n of sizes) {
    const random = rng(1234 + n);
    const stratifiedDeviations: number[] = [];
    const unstratifiedDeviations: number[] = [];

    // How many from each stratum a size-n stratified sample takes.
    const quota = allocate(strata, n);

    for (let d = 0; d < draws; d++) {
      // --- stratified: quota per stratum, weighted by true stratum share ---
      const picked: number[] = [];
      const perStratumCount = new Map<string, number>();
      for (const s of strata) {
        const pool = byStratum.get(s.key) ?? [];
        const want = Math.min(quota.get(s.key)!, pool.length);
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        picked.push(...shuffled.slice(0, want));
        perStratumCount.set(s.key, want);
      }
      const stratWeight = (i: number) => {
        const key = stratumOfFlop(solved[i]);
        return (trueWeight.get(key) ?? 0) / (perStratumCount.get(key) || 1);
      };

      // --- unstratified: n at random, equal weights ---
      const shuffledAll = solved.map((_, i) => i);
      for (let i = shuffledAll.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffledAll[i], shuffledAll[j]] = [shuffledAll[j], shuffledAll[i]];
      }
      const flat = shuffledAll.slice(0, n);

      for (const p of [0, 1] as const) {
        stratifiedDeviations.push(deviation(p, meansOver(p, picked, stratWeight)));
        unstratifiedDeviations.push(deviation(p, meansOver(p, flat, () => 1)));
      }
    }

    const stratifiedSe = median(stratifiedDeviations);
    const unstratifiedSe = median(unstratifiedDeviations);
    points.push({
      n,
      stratifiedSe,
      unstratifiedSe,
      // Error falls as 1/sqrt(n), so an error ratio r is worth r^2 in sample.
      efficiency: stratifiedSe > 0 ? Math.pow(unstratifiedSe / stratifiedSe, 2) : 1,
      degenerate: n > solved.length * 0.7,
    });
  }

  console.log("     N   stratified   unstratified   stratifying is worth");
  for (const p of points) {
    const note = p.degenerate ? "   (degenerate — see header)" : "";
    console.log(
      `  ${String(p.n).padStart(4)}   ${p.stratifiedSe.toFixed(4)}bb     ` +
        `${p.unstratifiedSe.toFixed(4)}bb      ${p.efficiency.toFixed(2)}x the sample${note}`
    );
  }

  // Cross-check against the analytic stratified estimator, which does not
  // resample. Agreement at moderate N is real evidence; disagreement means
  // one of the two is wrong and neither should be trusted.
  const strataMap = new Map(solved.map((f) => [f, stratumOfFlop(f)]));
  const analytic = median(
    [0, 1].flatMap((p) =>
      [...table.classStandardError(p as 0 | 1, strataMap).values()].map((v) => v / 10)
    )
  );
  console.log(
    `\n  analytic stratified SE at N=${solved.length}: ${analytic.toFixed(4)}bb ` +
      "(no resampling — the independent cross-check)"
  );

  // What it would take to resolve the marginal hands.
  const usable = points.filter((p) => !p.degenerate);
  if (usable.length >= 2) {
    const anchor = usable[usable.length - 1];
    const target = 0.1; // the whole "correct" band in verdict.ts
    const needed = Math.ceil(anchor.n * Math.pow(anchor.stratifiedSe / target, 2));
    console.log(
      `\n  to reach ${target}bb (verdict.ts's entire "correct" band) needs about ` +
        `${needed} flops per subgame,\n  extrapolating 1/sqrt(n) from N=${anchor.n}.`
    );
    console.log(
      `  at 60 subgames and ~180s a solve that is ${((needed * 60 * 180) / 3600).toFixed(0)}h ` +
        "for one pass — which is the number C6 has to weigh."
    );
  }
  console.log("");
}

if (process.argv[1]?.endsWith("curve.ts")) main();
