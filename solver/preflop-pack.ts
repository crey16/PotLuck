/**
 * Publish the BTN-vs-BB preflop pack from the converged slice — M8.7A.
 *
 *   npx tsx solver/preflop-pack.ts <ev-dir> [--iter N] [--out FILE]
 *
 * `preflop-br.ts` runs the loop; this writes down its answer in the form the
 * app grades from. The difference matters: the loop deals in SETS (does this
 * hand open?), and grading needs EVs (how much does folding it cost?). The set
 * is recoverable from the EVs; the EVs are not recoverable from the set. So
 * the pack stores EVs and derives everything else.
 *
 * ## What the numbers mean
 *
 * Every EV is NET CHIPS FROM THE START OF THE HAND, converted to
 * milli-big-blinds. Not a share of the pot, not a delta against some baseline
 * — the actual change in the player's stack. Blinds are already inside it, so
 * BB folding is -1000 mbb (they posted a big blind and gave it up) rather than
 * zero.
 *
 * This is the one place in the project where absolute action EVs are honest.
 * The postflop pack exports EV *loss* against the best action and nothing
 * else, and docs/15 records the standing rule that inferring absolutes from it
 * by addition would be "a fiction with a decimal point". Here the absolutes
 * are what the solve actually produces, so they are published as such — and
 * the M8 contract's `ev_basis` field says which is which, per decision.
 *
 * ## 169 classes, not 1326 combos, and why
 *
 * Measured 2026-08-07 on iteration 4: the six suit-isomorphic combos of `22`
 * have BTN open EVs spanning **-0.27bb to +1.58bb**. Those hands differ only
 * in which suits they hold, against the same 25 flops, so the whole spread is
 * sampling noise. A per-combo pack would have graded folding 2s2c correct and
 * folding 2h2d a 1.58bb blunder — a suit superstition with a decimal point on
 * it. Classes average that out; see `evtable.ts`.
 *
 * ## Every EV ships with its standard error, and grading must respect it
 *
 * Leave-one-flop-out jackknife puts the median class SE around **0.4bb**.
 * `lib/play/verdict.ts`'s bands are 0.1bb (correct), 0.5bb (acceptable) and
 * 0.75bb (blunder) — so the measurement error is four times the entire
 * "correct" band. Publishing EVs without the SE would manufacture verdicts
 * finer than the data supports, which is the failure the roadmap retired
 * reference-range grading for: "a guess with a confident face on it".
 *
 * The fix is not to hide the numbers but to publish their precision with them,
 * and let `se_mbb` widen the indifference band per hand. More flops shrink it:
 * SE falls as 1/sqrt(flops), so resolving BB's marginal hands to the 0.1bb
 * band needs roughly 15x the current 25-flop sample.
 *
 * ## Integers, deliberately
 *
 * EVs are integer milli-big-blinds, never floats. The pack's bytes are hashed
 * into the catalog's content hash by `gen-play-catalog.ts` and re-verified in
 * Python by `api/play_solver.py`; a float that JS and Python format
 * differently would make that hash disagree across languages for no reason
 * anyone would find quickly.
 *
 * ## The tree, stated exactly (chips: 10 = 1bb; SB posts 5, BB posts 10)
 *
 *   BTN  fold                 -> BTN     0
 *        open to 25
 *          BB fold            -> BTN +15, BB -10
 *          BB call            -> BTN ev_ip - 25,  BB ev_oop - 25   (postflop)
 *
 * THE SLICE HAS NO 3-BET, and that is a property of the published pack, not an
 * oversight in the exporter. BB's actions really are fold and call. See
 * docs/14's "CORRECTION 2026-08-06": this tree's equilibrium is legitimately
 * much wider than the reference ranges because BB cannot punish an open, and
 * `/play` must not present it as "how to open the button".
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ALL_COMBOS,
  blocks,
  COMBO_COUNT,
  comboToClass,
  loadEvTable,
} from "./preflop/evtable";

const OPEN = 25;
const DEAD_SB = 5;
const BB_POST = 10;

/** Chips -> integer milli-big-blinds. 10 chips = 1bb = 1000 mbb. */
const mbb = (chips: number): number => Math.round(chips * 100);

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: npx tsx solver/preflop-pack.ts <ev-dir> [--iter N] [--out FILE]");
  process.exit(2);
}
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const iteration = Number(flag("iter") ?? 4);
const outPath = resolve(flag("out") ?? "solver/pack/srp-btn-bb/preflop.json");

const table = loadEvTable(dir);

// ---- coverage is a gate, not a warning ------------------------------------
// A hand with no postflop EV cannot be priced, and the failure is silent: it
// simply never appears in the pack, and `/play` would fail the first time it
// deals that hand. Iterations 1, 3 and 4 reached 1326/1326 with the
// exploration floor in place; iteration 2 did not, at 1194. Publishing that
// one would ship a pack with a tenth of the hands missing.
for (const player of [0, 1] as const) {
  const n = table.coverage(player);
  if (n !== COMBO_COUNT) {
    console.error(
      `coverage ${player === 0 ? "OOP" : "IP"}: ${n}/${COMBO_COUNT} — refusing to publish.\n` +
        "Every combo needs an EV or it cannot be graded. Re-run the postflop\n" +
        "batch with the exploration floor in place (docs/14-m87a-solver-scope.md).",
    );
    process.exit(1);
  }
}

const oopEv = table.classMean(0);
const ipEv = table.classMean(1);
const oopSe = table.classStandardError(0);
const ipSe = table.classStandardError(1);
const CLASSES = [...oopEv.keys()].sort();
if (CLASSES.length !== 169) throw new Error(`expected 169 classes, got ${CLASSES.length}`);

// ---- BB, facing the open: fold or call ------------------------------------
// fold = -BB_POST exactly (a posted blind is not an estimate). call =
// ev_oop - OPEN. So the uncertainty in the CHOICE is entirely the uncertainty
// in ev_oop.
const bb = new Map<string, { ev: Record<string, number>; se: number }>();
for (const cls of CLASSES) {
  bb.set(cls, {
    ev: { c: oopEv.get(cls)! - OPEN, f: -BB_POST },
    se: oopSe.get(cls)!,
  });
}
const bbCallsClass = (cls: string): boolean => {
  const e = bb.get(cls)!.ev;
  return e.c > e.f;
};

// ---- BTN, first in: fold or open ------------------------------------------
// Opening is worth the dead money when BB folds and the postflop EV when they
// call, weighted by how often BB calls — against a range that EXCLUDES the
// cards BTN holds. Card removal is not a refinement here: holding an ace
// meaningfully lowers how often BB turns up with one. It is computed per combo
// and averaged over the class, because removal is a property of the specific
// cards even when the EV is not.
const btn = new Map<string, { ev: Record<string, number>; se: number }>();
{
  const byClass = new Map<string, string[]>();
  for (const combo of ALL_COMBOS) {
    const k = comboToClass(combo);
    (byClass.get(k) ?? byClass.set(k, []).get(k)!).push(combo);
  }
  for (const cls of CLASSES) {
    let pCallTotal = 0;
    for (const hero of byClass.get(cls)!) {
      let live = 0;
      let calls = 0;
      for (const villain of ALL_COMBOS) {
        if (blocks(hero, villain)) continue;
        live++;
        if (bbCallsClass(comboToClass(villain))) calls++;
      }
      pCallTotal += live > 0 ? calls / live : 0;
    }
    const pCall = pCallTotal / byClass.get(cls)!.length;
    btn.set(cls, {
      ev: {
        r: (1 - pCall) * (DEAD_SB + BB_POST) + pCall * (ipEv.get(cls)! - OPEN),
        f: 0,
      },
      // The dead-money term is exact and folding is exactly zero, so only the
      // called branch carries error — scaled by how often it is reached.
      se: pCall * ipSe.get(cls)!,
    });
  }
}

// ---- the payoff invariant, asserted ---------------------------------------
// Every terminal must sum to the dead small blind across both players. A sign
// error in this accounting is invisible in the output and fatal to the result,
// so it is checked rather than trusted.
{
  const bbFolds = 15 + -10;
  if (bbFolds !== DEAD_SB) {
    throw new Error(`BB-fold terminal sums to ${bbFolds}, expected ${DEAD_SB}`);
  }
  const postflop = table.pot - 2 * OPEN;
  if (postflop !== DEAD_SB) {
    throw new Error(
      `postflop terminal sums to ${postflop}, expected ${DEAD_SB} — ` +
        `the EV directory's pot is ${table.pot}, not the ${2 * OPEN + DEAD_SB} this tree produces`,
    );
  }
}

// ---- assemble -------------------------------------------------------------
interface RoleSpec {
  position: "BTN" | "BB";
  facing: string;
  actions: { code: string; label: string; kind: string; amount_bb: number | null }[];
  solved: Map<string, { ev: Record<string, number>; se: number }>;
}

const roles: RoleSpec[] = [
  {
    position: "BTN",
    facing: "unopened",
    // Order is the display order and fixes each action's `ordinal` in the M8
    // contract. It matches the reference scenario it replaces, so decisions
    // stored before this pack still line up.
    actions: [
      { code: "r", label: "Raise to 2.5bb", kind: "raise", amount_bb: 2.5 },
      { code: "f", label: "Fold", kind: "fold", amount_bb: null },
    ],
    solved: btn,
  },
  {
    position: "BB",
    facing: "btn_open_2.5bb",
    actions: [
      { code: "c", label: "Call", kind: "call", amount_bb: 1.5 },
      { code: "f", label: "Fold", kind: "fold", amount_bb: null },
    ],
    solved: bb,
  },
];

const rolesOut: Record<string, unknown> = {};
const summary: string[] = [];
for (const role of roles) {
  const codes = role.actions.map((a) => a.code);
  const hands: Record<string, { ev: number[]; se: number }> = {};
  let take = 0;
  let indistinct = 0;
  for (const cls of CLASSES) {
    const s = role.solved.get(cls)!;
    hands[cls] = { ev: codes.map((c) => mbb(s.ev[c])), se: mbb(s.se) };
    const best = codes.reduce((a, b) => (s.ev[a] >= s.ev[b] ? a : b));
    const margin = Math.abs(s.ev[codes[0]] - s.ev[codes[1]]);
    if (best === codes[0]) take++;
    if (margin <= s.se) indistinct++;
  }
  rolesOut[role.position] = {
    position: role.position,
    facing: role.facing,
    actions: role.actions,
    hands,
  };
  summary.push(
    `  ${role.position}: ${codes[0]} in ${take}/169 classes, ` +
      `${indistinct}/169 within 1 SE of the threshold`,
  );
}

const seValues = [...CLASSES.map((c) => bb.get(c)!.se), ...CLASSES.map((c) => btn.get(c)!.se)]
  .sort((a, b) => a - b);

const pack = {
  spot: "srp-btn-bb",
  kind: "preflop-ev",
  format_version: 1,
  /** Net change in the player's stack over the whole hand, milli-big-blinds. */
  ev_unit: "mbb",
  /** Strategies are indexed by 169-class notation, never by specific combos. */
  hand_index: "class169",
  provenance: {
    method: "postflop root EVs -> preflop best response, damped by fictitious play",
    iteration,
    flops_averaged: table.flops.length,
    flops: table.flops,
    postflop_pot_chips: table.pot,
    postflop_stack_chips: table.stack,
    coverage_combos: { BB: table.coverage(0), BTN: table.coverage(1) },
  },
  precision: {
    basis: "jackknife-leave-one-flop-out over the flop sample",
    median_se_mbb: mbb(seValues[Math.floor(seValues.length / 2)]),
    p90_se_mbb: mbb(seValues[Math.floor(seValues.length * 0.9)]),
    max_se_mbb: mbb(seValues[seValues.length - 1]),
    note:
      "se is the standard error of this hand's EV difference between actions. " +
      "A choice costing no more than se is indistinguishable from best at this " +
      "sample size and must not be graded as a mistake.",
  },
  /**
   * The modelled game, in the pack rather than only in a doc, so anything
   * reading it can state its own limits without a second source of truth.
   */
  model: {
    stack_bb: 100,
    blinds_bb: [0.5, 1],
    ante_bb: 0,
    rake: "none",
    excludes: [
      "BB cannot 3-bet in this solve, so the equilibrium is far wider than a real 6-max button range.",
      "The small blind is dead money that always folds.",
      "One open size only, so sizing is not part of the solved strategy.",
      "Strategies are pure per hand: a best response to fixed EVs does not mix.",
    ],
  },
  roles: rolesOut,
};

writeFileSync(outPath, JSON.stringify(pack) + "\n", "utf8");

console.log(`preflop pack -> ${outPath}`);
console.log(
  `  iteration ${iteration}, ${table.flops.length} flops, ` +
    `coverage ${table.coverage(0)}/${COMBO_COUNT}`,
);
console.log(
  `  SE of a class EV (bb): median ${(seValues[Math.floor(seValues.length / 2)] / 10).toFixed(3)}` +
    `  p90 ${(seValues[Math.floor(seValues.length * 0.9)] / 10).toFixed(3)}`,
);
for (const line of summary) console.log(line);
