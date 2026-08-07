/**
 * Probability-weighted, stratified flop sets — C1 of the accuracy programme.
 *
 *   npx tsx solver/flops/build.ts [--sizes 12,25,49,100] [--out solver/flops]
 *
 * ## The problem this fixes
 *
 * `solver/flops.txt` is 25 hand-picked boards, and every consumer averages
 * over them with EQUAL weight. Measured against the real distribution, that
 * sample is badly skewed:
 *
 *   two-tone   55.1% of all flops ->  16.0% of the sample
 *   rainbow    39.8%              ->  80.0%
 *   paired     16.9%              ->   8.0%
 *
 * and two strata are absent entirely — **two-tone/paired, which is 8.5% of
 * all flops**, and rainbow/trips. So the published EVs estimate an average
 * over that skewed set rather than over a flop a player will actually see.
 *
 * That is a BIAS, not noise. Reweighting the existing EVs toward the truth
 * moves suited hands +0.19bb and pairs -0.15bb — a systematic error sitting
 * underneath the 0.4bb sampling noise, and one that no number of extra flops
 * of the same kind would ever remove. Two-tone boards carry the flush draws,
 * so under-sampling them 3.4x systematically understates exactly the hands
 * that realise equity with a draw.
 *
 * ## The fix: stratified sampling with known strata weights
 *
 * This is what PioSOLVER and GTO Wizard ship as their weighted 49- and
 * 184-flop subsets, and it does two things at once:
 *
 *  - **Removes the bias.** Each stratum is represented in proportion to its
 *    true probability, and every representative carries an explicit weight.
 *  - **Reduces the variance** relative to plain random sampling, because
 *    board texture is exactly the kind of variable whose strata means differ
 *    a lot. How much is an empirical question, which C4 measures.
 *
 * ## Suit isomorphism
 *
 * 22,100 distinct flops collapse to 1,755 suit-isomorphic classes: only the
 * PATTERN of suits matters postflop, never which suit. Working in classes is
 * what makes the weights exact — a class's weight is simply how many concrete
 * flops it stands for.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";

const cardStr = (card: number): string => RANKS[card >> 2] + SUITS[card & 3];

export type Suitedness = "rainbow" | "two-tone" | "monotone";
export type Pairing = "unpaired" | "paired" | "trips";

export interface FlopClass {
  /** A representative concrete flop, e.g. "Ts9s5h". */
  flop: string;
  /** How many of the 22,100 concrete flops this class stands for. */
  count: number;
  suitedness: Suitedness;
  pairing: Pairing;
  /** Ranks, high to low. */
  ranks: [number, number, number];
}

/** The 24 permutations of the four suits. */
const SUIT_PERMUTATIONS: number[][] = (() => {
  const out: number[][] = [];
  const permute = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) return void out.push(prefix);
    rest.forEach((s, i) => permute([...prefix, s], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  permute([], [0, 1, 2, 3]);
  return out;
})();

/**
 * Canonical suit-isomorphic form: the lexicographically smallest relabelling.
 *
 * Two flops are the same postflop problem exactly when a permutation of the
 * suits maps one to the other, so the canonical form minimises over all 24
 * permutations. 22,100 x 24 is trivial and the answer is obviously right.
 *
 * The obvious cheap alternative — sort by rank, then relabel suits in order
 * of first appearance — is WRONG, and wrong in a way that looks fine. When
 * two cards share a rank their relative order is arbitrary, so {A(s) A(h) K(h)}
 * and {A(s) A(h) K(s)} canonicalise differently despite being the same board
 * under swapping hearts and spades. That split 22,100 flops into 1,911
 * classes instead of the correct 1,755, and every duplicated class would have
 * carried half its true weight into the sample.
 */
export function canonical(cards: readonly number[]): string {
  let best: string | null = null;
  for (const perm of SUIT_PERMUTATIONS) {
    const mapped = cards.map((card) => ((card >> 2) << 2) | perm[card & 3]);
    mapped.sort((a, b) => (b >> 2) - (a >> 2) || (a & 3) - (b & 3));
    const s = mapped.map((card) => RANKS[card >> 2] + SUITS[card & 3]).join("");
    if (best === null || s < best) best = s;
  }
  return best!;
}

/** Parse "Ts9s5h" into card ids. */
export const parseFlop = (s: string): number[] =>
  [0, 2, 4].map((i) => (RANKS.indexOf(s[i]) << 2) | SUITS.indexOf(s[i + 1]));

/** The stratum a concrete board belongs to, e.g. "two-tone/unpaired". */
export function stratumOfFlop(board: string): string {
  const { suitedness, pairing } = classify(parseFlop(board));
  return `${suitedness}/${pairing}`;
}

function classify(cards: readonly number[]): { suitedness: Suitedness; pairing: Pairing } {
  const suits = new Set(cards.map((c) => c & 3)).size;
  const ranks = new Set(cards.map((c) => c >> 2)).size;
  return {
    suitedness: suits === 1 ? "monotone" : suits === 2 ? "two-tone" : "rainbow",
    pairing: ranks === 1 ? "trips" : ranks === 2 ? "paired" : "unpaired",
  };
}

/** Every suit-isomorphic flop class, with the exact number of flops it covers. */
export function enumerateClasses(): { classes: FlopClass[]; totalFlops: number } {
  const byCanonical = new Map<string, FlopClass>();
  let totalFlops = 0;
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      for (let c = b + 1; c < 52; c++) {
        const cards = [a, b, c];
        totalFlops++;
        const key = canonical(cards);
        const existing = byCanonical.get(key);
        if (existing) {
          existing.count++;
          continue;
        }
        const { suitedness, pairing } = classify(cards);
        const ranks = [...cards].map((x) => x >> 2).sort((x, y) => y - x) as [number, number, number];
        byCanonical.set(key, { flop: key, count: 1, suitedness, pairing, ranks });
      }
    }
  }
  return { classes: [...byCanonical.values()], totalFlops };
}

/**
 * The strata.
 *
 * Suitedness x pairing, and nothing finer. Six combinations are reachable —
 * monotone implies unpaired (three cards of one suit cannot share a rank) and
 * trips implies rainbow (three cards of one rank cannot share a suit).
 *
 * Deliberately coarse. Adding connectedness and a high-card bucket would give
 * 90 strata, which at N=25 means one representative each and no sampling
 * within a stratum at all — the allocation would be doing all the work and
 * the systematic sampling below none of it. Rank structure is instead handled
 * WITHIN each stratum by sampling across the whole cumulative-weight range.
 */
export const stratumOf = (c: FlopClass): string => `${c.suitedness}/${c.pairing}`;

interface Stratum {
  key: string;
  classes: FlopClass[];
  /** Share of all 22,100 flops. */
  probability: number;
}

export function stratify(classes: FlopClass[], totalFlops: number): Stratum[] {
  const groups = new Map<string, FlopClass[]>();
  for (const c of classes) {
    const key = stratumOf(c);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }
  return [...groups]
    .map(([key, list]) => ({
      key,
      // Sorted so the systematic sample below is reproducible and spans the
      // rank space in a sensible order: high boards to low.
      classes: list.sort(
        (a, b) => b.ranks[0] - a.ranks[0] || b.ranks[1] - a.ranks[1] || b.ranks[2] - a.ranks[2]
      ),
      probability: list.reduce((sum, c) => sum + c.count, 0) / totalFlops,
    }))
    .sort((a, b) => b.probability - a.probability);
}

/**
 * Largest-remainder allocation with a floor of one per stratum.
 *
 * The floor costs a little efficiency — rainbow/trips is 0.24% of flops and
 * still gets a solve — and buys the removal of a whole category of bias. A
 * stratum with zero representatives contributes zero to the estimate while
 * its probability mass sits unaccounted for, which is exactly the defect in
 * the current 25-flop set.
 */
export function allocate(strata: Stratum[], n: number): Map<string, number> {
  if (n < strata.length) {
    throw new Error(
      `cannot build a ${n}-flop set: ${strata.length} strata each need at least one representative`
    );
  }
  const out = new Map<string, number>();
  const remainders: { key: string; frac: number }[] = [];
  let assigned = 0;
  for (const s of strata) {
    const exact = s.probability * n;
    const floor = Math.max(1, Math.floor(exact));
    out.set(s.key, floor);
    assigned += floor;
    remainders.push({ key: s.key, frac: exact - Math.floor(exact) });
  }
  // Hand out what is left to the largest remainders; claw back from the
  // largest strata if the floor over-committed.
  remainders.sort((a, b) => b.frac - a.frac);
  let i = 0;
  while (assigned < n) {
    out.set(remainders[i % remainders.length].key, out.get(remainders[i % remainders.length].key)! + 1);
    assigned++;
    i++;
  }
  const bySize = [...strata].sort((a, b) => b.probability - a.probability);
  i = 0;
  while (assigned > n) {
    const key = bySize[i % bySize.length].key;
    if (out.get(key)! > 1) {
      out.set(key, out.get(key)! - 1);
      assigned--;
    }
    i++;
  }
  return out;
}

/**
 * Systematic sampling within a stratum, by cumulative class weight.
 *
 * Walks the stratum's classes in rank order accumulating their probability
 * and takes the class sitting at each of k evenly spaced quantiles. Every
 * class is eligible in proportion to how many concrete flops it represents,
 * and the picks are spread across the whole range rather than clustered —
 * a low-discrepancy sample, and deterministic, so a set is reproducible from
 * its size alone.
 */
export function systematicSample(stratum: Stratum, k: number): FlopClass[] {
  const total = stratum.classes.reduce((sum, c) => sum + c.count, 0);
  const picked: FlopClass[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < k; i++) {
    const target = ((i + 0.5) / k) * total;
    let running = 0;
    let chosen = stratum.classes[stratum.classes.length - 1];
    for (const c of stratum.classes) {
      running += c.count;
      if (running >= target) {
        chosen = c;
        break;
      }
    }
    // A stratum with fewer distinct classes than requested picks (only
    // possible for tiny strata) must not emit the same board twice — a
    // duplicate would silently double that board's weight.
    if (seen.has(chosen.flop)) {
      const alternative = stratum.classes.find((c) => !seen.has(c.flop));
      if (!alternative) break;
      chosen = alternative;
    }
    seen.add(chosen.flop);
    picked.push(chosen);
  }
  return picked;
}

export interface WeightedFlop {
  flop: string;
  /** Sums to 1 across the set. */
  weight: number;
  stratum: string;
}

export function buildSet(n: number): { flops: WeightedFlop[]; strata: Stratum[] } {
  const { classes, totalFlops } = enumerateClasses();
  const strata = stratify(classes, totalFlops);
  const counts = allocate(strata, n);

  const flops: WeightedFlop[] = [];
  for (const stratum of strata) {
    const k = counts.get(stratum.key)!;
    const picked = systematicSample(stratum, k);
    // Each representative carries an equal share of its stratum's total
    // probability. Summed over every stratum this is exactly 1, which is what
    // makes the weighted average an unbiased estimate over real flops.
    for (const c of picked) {
      flops.push({
        flop: c.flop,
        weight: stratum.probability / picked.length,
        stratum: stratum.key,
      });
    }
  }
  return { flops, strata };
}

function main(): void {
  const argv = process.argv.slice(2);
  const flag = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const sizes = flag("sizes", "12,25,49,100").split(",").map(Number);
  const outDir = resolve(flag("out", "solver/flops"));
  mkdirSync(outDir, { recursive: true });

  const { classes, totalFlops } = enumerateClasses();
  const strata = stratify(classes, totalFlops);
  console.log(`${totalFlops.toLocaleString()} flops -> ${classes.length} suit-isomorphic classes\n`);
  console.log("  stratum                 classes    share of all flops");
  for (const s of strata) {
    console.log(`  ${s.key.padEnd(22)} ${String(s.classes.length).padStart(5)}    ${(100 * s.probability).toFixed(2)}%`);
  }

  for (const n of sizes) {
    const { flops } = buildSet(n);
    const sum = flops.reduce((t, f) => t + f.weight, 0);
    if (Math.abs(sum - 1) > 1e-9) throw new Error(`set-${n} weights sum to ${sum}, not 1`);
    if (new Set(flops.map((f) => f.flop)).size !== flops.length) {
      throw new Error(`set-${n} contains a duplicate board`);
    }
    const path = resolve(outDir, `set-${flops.length}.json`);
    writeFileSync(
      path,
      JSON.stringify(
        {
          kind: "weighted-flop-set",
          format_version: 1,
          requested: n,
          count: flops.length,
          total_flops: totalFlops,
          classes: classes.length,
          method: "stratified by suitedness x pairing, systematic sampling within each stratum by class weight",
          flops,
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
    const byStratum = new Map<string, number>();
    for (const f of flops) byStratum.set(f.stratum, (byStratum.get(f.stratum) ?? 0) + 1);
    console.log(
      `\nset-${flops.length}.json  ${[...byStratum].map(([k, v]) => `${k.split("/")[0][0]}${k.split("/")[1][0]}:${v}`).join(" ")}`
    );
  }
  console.log(`\nwrote ${sizes.length} sets to ${outDir}/`);
}

if (process.argv[1]?.endsWith("build.ts")) main();
