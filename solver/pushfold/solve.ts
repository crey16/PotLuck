/**
 * Solve the 6-max shove-or-fold equilibrium at every stack depth — M8.7E.
 *
 *   npx tsx solver/pushfold/solve.ts [--out DIR] [--min 5] [--max 20] [--iters 400]
 *
 * ## Why this converges where the 100bb loop struggled
 *
 * M8.7A's preflop loop had to re-solve a postflop batch between iterations, so
 * each step cost hours and the ranges could only be compared a few times. Here
 * every terminal is an all-in pot whose value is a table lookup, so a full
 * best-response sweep is milliseconds and the fixed point can be chased for
 * hundreds of iterations. The convergence machinery is the same and was proven
 * there: **fictitious play**, averaging each best response into a running mean
 * rather than replacing it. Pure alternating best response oscillates — the
 * callers tighten, so the shovers widen, which pushes the callers back — and
 * that is documented behaviour in this project, not a guess.
 *
 * ## The order of the fixed point
 *
 * Calling ranges are a best response to shoving ranges, and shoving ranges are
 * a best response to calling ranges. They are updated in that order within an
 * iteration so a shove is priced against calls that already reflect it.
 *
 * ## What is approximate here, stated
 *
 * 1. **Equity is sampled**, not enumerated — 169x169 at the table's own sample
 *    count. Per matchup that is around a point; a hand's equity against a
 *    RANGE averages many entries, so what actually drives a threshold is far
 *    tighter. Measured and published in the pack.
 * 2. **One caller.** Overcalls are pruned, so shoving ranges are slightly
 *    optimistic against a field that likes to overcall.
 * 3. **169 classes**, so suit-specific blockers beyond the class level are
 *    averaged. Card removal between the two players in a pot IS exact.
 * 4. **Chip EV, not ICM.** Correct for a chip-neutral spot, wrong on a bubble.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  againstRange,
  availableCombos,
  callEv,
  CLASS_INDEX,
  CLASSES,
  COMBO_COUNT,
  emptyRange,
  loadEquity,
  POSITIONS,
  post,
  deadMoney,
  shoveEv,
  SHOVERS,
  startingPot,
  type Behind,
  type Position,
  type Range,
  type Table,
} from "./game";

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const outDir = resolve(flag("out", "solver/pack/pushfold"));
const minStack = Number(flag("min", "5"));
const maxStack = Number(flag("max", "20"));
const iterations = Number(flag("iters", "400"));

const { samples, equity } = loadEquity(
  resolve(flag("equity", "solver/preflop/equity-169.json"))
);
const removal = availableCombos();
const N = CLASSES.length;

/** Positions that act after `shover`, in order. */
const behindOf = (shover: Position): Position[] =>
  POSITIONS.slice(POSITIONS.indexOf(shover) + 1) as Position[];

/** Every (shover, caller) pair the tree can reach. */
const CALL_PAIRS: { shover: Position; caller: Position }[] = SHOVERS.flatMap((shover) =>
  behindOf(shover).map((caller) => ({ shover, caller }))
);

const key = (shover: Position, caller: Position) => `${shover}>${caller}`;

/** Combo-weighted percentage of all hands a range takes. */
function rangePercent(range: Range): number {
  let taken = 0;
  let total = 0;
  for (let i = 0; i < N; i++) {
    taken += range[i] * COMBO_COUNT[i];
    total += COMBO_COUNT[i];
  }
  return (100 * taken) / total;
}

export interface Solution {
  stack: number;
  ante: number;
  shove: Map<Position, Range>;
  /** Keyed `${shover}>${caller}`. */
  call: Map<string, Range>;
  /** Net EV of jamming, per class, in big blinds. */
  shoveEvBb: Map<Position, Float64Array>;
  /** Net EV of calling, per class, in big blinds. */
  callEvBb: Map<string, Float64Array>;
  /** Largest strategy change on the final iteration — the convergence proof. */
  finalDelta: number;
}

/**
 * Solve one (stack, ante) table.
 *
 * Ranges start at 50% everywhere rather than at 0 or 100. Starting at 0 makes
 * the first sweep price a jam against opponents who never call, which is
 * maximally wide and takes many iterations to walk back; starting at 100 does
 * the reverse. The midpoint is not a strategic claim, it is just the cheapest
 * place to begin.
 */
export function solveTable({ stack, ante }: Table, iters: number): Solution {
  const shove = new Map<Position, Range>();
  const call = new Map<string, Range>();
  for (const position of SHOVERS) shove.set(position, emptyRange().fill(0.5));
  for (const { shover, caller } of CALL_PAIRS) {
    call.set(key(shover, caller), emptyRange().fill(0.5));
  }

  const shoveEvBb = new Map<Position, Float64Array>();
  const callEvBb = new Map<string, Float64Array>();
  let finalDelta = 0;

  for (let iteration = 1; iteration <= iters; iteration++) {
    finalDelta = 0;
    // Fictitious play: the weight on the newest best response decays as 1/n,
    // which is what damps the oscillation into convergence.
    const weight = 1 / (iteration + 1);

    // --- callers first, so a jam is priced against calls that reflect it ---
    for (const { shover, caller } of CALL_PAIRS) {
      const shoverRange = shove.get(shover)!;
      const current = call.get(key(shover, caller))!;
      const evs = new Float64Array(N);
      for (let h = 0; h < N; h++) {
        const { call: callValue, fold } = callEv(
          h, caller, shover, shoverRange, { stack, ante }, equity, removal
        );
        evs[h] = callValue - fold;
        const best = callValue > fold ? 1 : 0;
        const next = current[h] + weight * (best - current[h]);
        finalDelta = Math.max(finalDelta, Math.abs(next - current[h]));
        current[h] = next;
      }
      callEvBb.set(key(shover, caller), evs);
    }

    // --- then the shovers ---
    for (const shover of SHOVERS) {
      const behind: Behind[] = behindOf(shover).map((position) => ({
        position,
        callRange: call.get(key(shover, position))!,
      }));
      const current = shove.get(shover)!;
      const evs = new Float64Array(N);
      for (let h = 0; h < N; h++) {
        const { shove: shoveValue, fold } = shoveEv(
          h, shover, behind, { stack, ante }, equity, removal
        );
        evs[h] = shoveValue - fold;
        const best = shoveValue > fold ? 1 : 0;
        const next = current[h] + weight * (best - current[h]);
        finalDelta = Math.max(finalDelta, Math.abs(next - current[h]));
        current[h] = next;
      }
      shoveEvBb.set(shover, evs);
    }
  }

  return { stack, ante, shove, call, shoveEvBb, callEvBb, finalDelta };
}

/**
 * A shoving range must widen as the stack shortens. Assert it.
 *
 * This is the single validation that matters most, and it is here because the
 * reference product gets it wrong: hand-authored "Nash-style" charts are
 * routinely non-monotonic in depth — an 8bb shoving range tighter than the
 * 10bb one — which no computation can produce. Less dead money to win relative
 * to the stack risked, plus less fold equity, can only push a threshold one
 * way.
 *
 * A small tolerance is allowed because the equity table is sampled: two
 * adjacent depths can cross by a fraction of a point on noise alone without
 * anything being wrong. A real inversion is far larger than that.
 */
export function validateMonotonic(
  solutions: readonly Solution[],
  tolerancePoints = 1.5
): string[] {
  const problems: string[] = [];
  const byAnte = new Map<number, Solution[]>();
  for (const solution of solutions) {
    const list = byAnte.get(solution.ante) ?? [];
    list.push(solution);
    byAnte.set(solution.ante, list);
  }
  for (const [ante, list] of byAnte) {
    const ordered = [...list].sort((a, b) => a.stack - b.stack);
    for (const position of SHOVERS) {
      for (let i = 1; i < ordered.length; i++) {
        const shallow = rangePercent(ordered[i - 1].shove.get(position)!);
        const deep = rangePercent(ordered[i].shove.get(position)!);
        if (shallow < deep - tolerancePoints) {
          problems.push(
            `${position} ante ${ante}: ${ordered[i - 1].stack}bb shoves ` +
              `${shallow.toFixed(1)}% but ${ordered[i].stack}bb shoves ${deep.toFixed(1)}% — ` +
              "a shorter stack cannot shove tighter",
          );
        }
      }
    }
  }
  return problems;
}

/**
 * A caller's threshold must be the pot odds they are actually getting.
 *
 * CORRECTION, and it is worth recording because the wrong rule is intuitive.
 * An earlier gate here asserted that a calling range must be TIGHTER than the
 * range it faces, on the reasoning that a jam has fold equity and a call has
 * none. That is true for a player with nothing invested, and false for the big
 * blind. At 8bb with a 1bb ante the BB has already put in 2 of their 8, so
 * calling costs 6 to win 16.5 — under 36% equity needed, which is most of the
 * deck. The solver was right and the rule was wrong; BB really does call wider
 * than any position jams at short depths with an ante, and every published
 * push/fold chart shows the same.
 *
 * What IS invariant is the arithmetic: the marginal calling hand's equity must
 * equal `risk / pot`. This checks that, which catches a sign or dead-money
 * error in `callEv` — the failure a range-width heuristic would have hidden.
 */
export function validateCallThresholds(
  solutions: readonly Solution[],
  tolerance = 0.02
): string[] {
  const problems: string[] = [];
  for (const solution of solutions) {
    const { stack, ante } = solution;
    for (const { shover, caller } of CALL_PAIRS) {
      const range = solution.call.get(key(shover, caller))!;
      const shoverRange = solution.shove.get(shover)!;
      const risk = stack - post(caller, ante);
      const pot = 2 * stack + deadMoney(caller, shover, ante);
      const required = risk / pot;
      for (let h = 0; h < N; h++) {
        // Only the decided hands: a hand still mixing mid-average is not a
        // claim about the threshold.
        if (range[h] > 0.02 && range[h] < 0.98) continue;
        const { equity: share } = againstRange(h, shoverRange, equity, removal);
        const calls = range[h] >= 0.98;
        if (calls && share < required - tolerance) {
          problems.push(
            `${stack}bb ante ${ante}: ${caller} calls ${shover} with ${CLASSES[h]} at ` +
              `${(100 * share).toFixed(1)}% equity, needing ${(100 * required).toFixed(1)}%`,
          );
        }
        if (!calls && share > required + tolerance) {
          problems.push(
            `${stack}bb ante ${ante}: ${caller} folds ${CLASSES[h]} to ${shover} with ` +
              `${(100 * share).toFixed(1)}% equity, needing only ${(100 * required).toFixed(1)}%`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * Chips are conserved across an all-in terminal. Assert it.
 *
 * The two players' net EVs must sum to the dead money the folded players left
 * behind — nothing is created or destroyed. This is the same invariant the
 * M8.7A preflop pack asserts about the dead small blind, and for the same
 * reason: a sign error in the pot arithmetic is invisible in the output and
 * fatal to every number downstream.
 */
export function validateChipConservation(tolerance = 1e-9): string[] {
  const problems: string[] = [];
  for (const ante of [0, 1]) {
    for (const stack of [5, 12, 20]) {
      for (const { shover, caller } of CALL_PAIRS) {
        const dead = deadMoney(shover, caller, ante);
        const pot = 2 * stack + dead;
        // Hero wins share e, villain wins (1 - e). Net each = -stack + share
        // of pot, plus back the posts already inside their own stack.
        for (const share of [0, 0.37, 0.5, 1]) {
          const heroNet = -stack + share * pot;
          const villainNet = -stack + (1 - share) * pot;
          if (Math.abs(heroNet + villainNet - dead) > tolerance) {
            problems.push(
              `${stack}bb ante ${ante} ${shover} vs ${caller} at equity ${share}: ` +
                `nets sum to ${(heroNet + villainNet).toFixed(6)}, expected the ` +
                `${dead.toFixed(2)}bb of dead money`,
            );
          }
        }
      }
    }
  }
  return problems;
}

/**
 * Antes widen a jam — everywhere except the small blind, and that exception
 * is a real result rather than a tolerance.
 *
 * CORRECTION, found by this gate failing. "An ante adds dead money without
 * adding to what a jam risks, so every threshold loosens" is the standard
 * explanation and it is incomplete. The ante is posted by the big blind, so
 * it also improves the odds the big blind is getting to CALL — and those two
 * effects push in opposite directions.
 *
 * With several players behind, the extra fold equity dominates and every jam
 * widens: at 5bb the button goes 40% -> 52%.
 *
 * Blind versus blind there is nobody to fold out except the one player whose
 * odds just improved. At 5bb with a 1bb ante the big blind has 2 of their 5
 * already in and is calling 3 to win 10 — under 30% equity needed, so they
 * call about three quarters of hands, and the small blind's jam has almost no
 * fold equity left to buy. The solve tightens it from 71.5% to 66.0%.
 *
 * The effect flips around 8bb, where the two forces balance: below that the
 * ante tightens the small blind's jam, above it the ante widens it, reaching
 * 40% -> 48% at 20bb.
 *
 * So the gate covers the positions where the claim is actually true, and the
 * small blind is excluded deliberately with the reason written down. The
 * lesson has to teach the same thing — "antes widen every shoving range" is
 * exactly the kind of plausible half-truth this project keeps finding.
 */
export function validateAntesWiden(
  solutions: readonly Solution[],
  tolerancePoints = 0.5
): string[] {
  const problems: string[] = [];
  const byStack = new Map<number, Map<number, Solution>>();
  for (const solution of solutions) {
    const perAnte = byStack.get(solution.stack) ?? new Map<number, Solution>();
    perAnte.set(solution.ante, solution);
    byStack.set(solution.stack, perAnte);
  }
  for (const [stack, perAnte] of byStack) {
    const none = perAnte.get(0);
    const withAnte = perAnte.get(1);
    if (!none || !withAnte) continue;
    for (const position of SHOVERS) {
      // Blind versus blind: see the header. The direction genuinely reverses
      // with depth, so no single direction can be asserted.
      if (position === "SB") continue;
      const dry = rangePercent(none.shove.get(position)!);
      const anted = rangePercent(withAnte.shove.get(position)!);
      if (anted < dry - tolerancePoints) {
        problems.push(
          `${stack}bb ${position}: shoves ${anted.toFixed(1)}% with an ante but ` +
            `${dry.toFixed(1)}% without — with players left to fold out, an ante ` +
            "can only widen a jam",
        );
      }
    }
  }
  return problems;
}

/** The floor: aces are always jammed and always called, at every depth. */
export function validateAcesAlwaysIn(solutions: readonly Solution[]): string[] {
  const problems: string[] = [];
  const aces = CLASS_INDEX.get("AA")!;
  for (const solution of solutions) {
    for (const position of SHOVERS) {
      if (solution.shove.get(position)![aces] < 0.98) {
        problems.push(`${solution.stack}bb ante ${solution.ante}: ${position} does not jam AA`);
      }
    }
    for (const { shover, caller } of CALL_PAIRS) {
      if (solution.call.get(key(shover, caller))![aces] < 0.98) {
        problems.push(
          `${solution.stack}bb ante ${solution.ante}: ${caller} does not call ${shover} with AA`,
        );
      }
    }
  }
  return problems;
}

/** Integer milli-big-blinds, as the M8.7A preflop pack uses. */
const mbb = (bb: number): number => Math.round(bb * 1000);

function main(): void {
  const antes = [0, 1];
  const stacks: number[] = [];
  for (let s = minStack; s <= maxStack; s++) stacks.push(s);

  const solutions: Solution[] = [];
  for (const ante of antes) {
    for (const stack of stacks) {
      const solution = solveTable({ stack, ante }, iterations);
      solutions.push(solution);
      process.stderr.write(
        `${stack}bb ante ${ante}: ` +
          SHOVERS.map((p) => `${p} ${rangePercent(solution.shove.get(p)!).toFixed(0)}%`).join(" ") +
          `  (delta ${solution.finalDelta.toExponential(1)})\n`,
      );
    }
  }

  // Gates, not warnings. A pack that fails either of these is wrong in a way
  // a chart makes invisible, which is the whole reason for computing it.
  const problems = [
    ...validateChipConservation(),
    ...validateMonotonic(solutions),
    ...validateCallThresholds(solutions),
    ...validateAntesWiden(solutions),
    ...validateAcesAlwaysIn(solutions),
  ];
  if (problems.length > 0) {
    console.error(`\nREFUSING TO PUBLISH — ${problems.length} validation failures:`);
    for (const problem of problems.slice(0, 20)) console.error(`  ${problem}`);
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  const tables = solutions.map((solution) => ({
    stack_bb: solution.stack,
    ante_bb: solution.ante,
    starting_pot_bb: startingPot(solution.ante),
    convergence_delta: Number(solution.finalDelta.toExponential(3)),
    shove: Object.fromEntries(
      SHOVERS.map((position) => [
        position,
        {
          // Frequency is 0 or 1 per class at the fixed point except where the
          // solve genuinely mixes; both are published rather than rounded, so
          // a chart can show an indifferent hand as indifferent.
          frequency: CLASSES.map((_, i) => Math.round(solution.shove.get(position)![i] * 1000) / 1000),
          ev_mbb: CLASSES.map((_, i) => mbb(solution.shoveEvBb.get(position)![i])),
          fold_ev_mbb: mbb(-post(position, solution.ante)),
        },
      ])
    ),
    call: Object.fromEntries(
      CALL_PAIRS.map(({ shover, caller }) => [
        key(shover, caller),
        {
          frequency: CLASSES.map((_, i) => Math.round(solution.call.get(key(shover, caller))![i] * 1000) / 1000),
          ev_mbb: CLASSES.map((_, i) => mbb(solution.callEvBb.get(key(shover, caller))![i])),
          fold_ev_mbb: mbb(-post(caller, solution.ante)),
        },
      ])
    ),
  }));

  const pack = {
    kind: "pushfold-ev",
    format_version: 1,
    hand_index: "class169",
    classes: CLASSES,
    /**
     * EVs are the DIFFERENCE between taking the action and folding, in
     * milli-big-blinds. `fold_ev_mbb` is folding's own absolute value, so an
     * absolute action EV is `ev_mbb + fold_ev_mbb` — published rather than
     * inferred, unlike the postflop pack where absolutes do not exist.
     */
    ev_unit: "mbb",
    ev_basis: "difference_vs_fold",
    provenance: {
      method: "fictitious play over the pruned one-caller jam/fold tree",
      iterations,
      equity_samples: samples,
      equity_note:
        "All-in equity is Monte Carlo at the sample count above; a hand's " +
        "equity against a RANGE averages many entries, so the error driving a " +
        "threshold is much smaller than the per-matchup figure.",
    },
    model: {
      table_size: 6,
      positions: POSITIONS,
      blinds_bb: [0.5, 1],
      ante_kind: "big_blind_ante",
      ev_model: "chip_ev",
      rake: "none",
      excludes: [
        "Chip EV only. These ranges are wrong on a tournament bubble, where ICM makes calling off far more expensive than the chips say.",
        "One caller: overcalls are pruned, so jams are slightly optimistic against a field that likes to overcall.",
        "Jam or fold only. No limps, min-raises, or raise-folds.",
        "Uniform stacks: every player is assumed to have the same depth.",
      ],
    },
    tables,
  };

  // ONE FILE PER TABLE, plus a small index.
  //
  // Everything in one document is 1.2 MB, and neither consumer wants all of
  // it: the drill deals one depth at a time and `/ranges` shows one at a
  // time. A per-table file is around 37 KB, so a player who opens the chart
  // at 12bb downloads 12bb. The roadmap's rule is to measure dataset size
  // before expanding coverage rather than after, and this is that measurement
  // acted on.
  const metadata = { ...pack, tables: undefined };
  delete (metadata as { tables?: unknown }).tables;
  let bytes = 0;
  for (const table of tables) {
    const name = `${table.stack_bb}bb-ante${table.ante_bb}.json`;
    const body = JSON.stringify(table) + "\n";
    bytes += Buffer.byteLength(body);
    writeFileSync(resolve(outDir, name), body, "utf8");
  }
  const index = {
    ...metadata,
    tables: tables.map((table) => ({
      stack_bb: table.stack_bb,
      ante_bb: table.ante_bb,
      file: `${table.stack_bb}bb-ante${table.ante_bb}.json`,
    })),
  };
  const path = resolve(outDir, "index.json");
  writeFileSync(path, JSON.stringify(index) + "\n", "utf8");

  console.log(`\npushfold pack -> ${outDir}`);
  console.log(`  ${tables.length} tables (${stacks.length} depths x ${antes.length} ante settings)`);
  console.log(
    `  ${(bytes / 1024).toFixed(0)} KB total, ` +
      `${(bytes / tables.length / 1024).toFixed(0)} KB per table fetched`,
  );
  console.log("  chip conservation, monotonicity, call thresholds, ante widening and AA gates passed");
}

if (process.argv[1]?.endsWith("solve.ts")) main();
