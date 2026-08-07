/**
 * The 6-max shove-or-fold game — M8.7E.
 *
 * Below roughly 20bb the preflop tree collapses: with no room to raise and
 * then fold, the only live actions are jam and fold, and the only response is
 * call or fold. That is a two-action game whose terminals are all-in pots, and
 * an all-in pot's value IS equity — which `solver/preflop/equity-169.json`
 * already holds. So unlike the 100bb tree, this has an exact answer available
 * for the price of an afternoon rather than a batch measured in days.
 *
 * That is worth stating plainly, because the competition does not do it. The
 * reference site's push/fold ranges are hand-authored strings labelled
 * "Nash-style", and they are NON-MONOTONIC in stack depth — their 8bb UTG
 * shove range is tighter than their 10bb one, which no computation would ever
 * produce. `validateMonotonic` below is a gate on this pack precisely because
 * that is the bug hand-authored charts ship with.
 *
 * ## Units and conventions
 *
 * Everything is **big blinds**, and every EV is **net change in the player's
 * own stack over the whole hand** — blinds and antes already inside it, so a
 * big blind folding to a shove is exactly `-(1 + ante)`. Same convention as
 * the M8.7A preflop pack, deliberately: two EV conventions in one project is
 * the arithmetic bug nobody finds.
 *
 * ## The model, stated exactly
 *
 * - Uniform stacks. Every player starts with `stack` big blinds; posts come
 *   out of it, so anyone all-in is in for exactly `stack`.
 * - Blinds 0.5 / 1. The ante is a **big-blind ante**: the big blind posts it
 *   on behalf of the table, so their total post is `1 + ante` and it is dead
 *   money in the pot if they fold. This is the modern tournament structure.
 * - Jam or fold only. No limps, no min-raises, no raise-fold.
 * - **One caller.** Once someone calls the jam, the hand is heads-up and
 *   everyone behind is folded out. Real push/fold pots can go multiway; this
 *   prunes them, exactly as the 100bb tree does, and for the same reason —
 *   multiway equilibria are not something this toolchain solves. It makes
 *   shoving ranges slightly optimistic against the fields where an overcall
 *   is likely.
 * - **Chip EV, never ICM.** These numbers are correct for a cash-game or a
 *   chip-count-neutral spot and wrong on a bubble, in a way the player cannot
 *   see from the chart. Every surface has to say so.
 *
 * ## Card removal
 *
 * Exact between the two players in a pot: `availableCombos` averages, over
 * every combo of the hero's class, how many combos of the villain's class
 * remain. Holding an ace really does halve how often anyone else has one, and
 * at these depths ace-blockers move a shoving threshold.
 *
 * Between several players behind, removal is treated as INDEPENDENT — the
 * standard approximation. Modelling it jointly means summing over ordered
 * pairs of opponent hands, which is 169^2 per hero hand per pair of opponents,
 * and it moves thresholds by far less than the equity table's own sampling
 * error.
 */
import { readFileSync } from "node:fs";

import { classes, combosOf } from "../preflop/equity";

export const POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;
export type Position = (typeof POSITIONS)[number];

/** Positions that can open a jam. The big blind never shoves into a folded pot. */
export const SHOVERS: Position[] = ["UTG", "HJ", "CO", "BTN", "SB"];

export const SMALL_BLIND = 0.5;
export const BIG_BLIND = 1;

export const CLASSES = classes();
export const CLASS_INDEX = new Map(CLASSES.map((c, i) => [c, i]));

/** Total combos of a class: 6 for a pair, 4 suited, 12 offsuit. */
export const COMBO_COUNT: number[] = CLASSES.map((c) => combosOf(c).length);

/** What each player has put in before anyone acts. */
export function post(position: Position, ante: number): number {
  if (position === "SB") return SMALL_BLIND;
  if (position === "BB") return BIG_BLIND + ante;
  return 0;
}

/** Dead money on the table before the first decision. */
export const startingPot = (ante: number): number => SMALL_BLIND + BIG_BLIND + ante;

/**
 * Combos of `villain` still available when the hero holds `hero`, averaged
 * over the hero's own combos.
 *
 * Exact rather than approximated: this is a 169x169 table computed once, and
 * ace-blockers genuinely move a shoving threshold at these depths.
 */
export function availableCombos(): Float64Array {
  const n = CLASSES.length;
  const out = new Float64Array(n * n);
  const heroCombos = CLASSES.map(combosOf);
  const villainCombos = CLASSES.map(combosOf);
  for (let h = 0; h < n; h++) {
    const hc = heroCombos[h];
    for (let v = 0; v < n; v++) {
      const vc = villainCombos[v];
      let total = 0;
      for (const [h1, h2] of hc) {
        for (const [v1, v2] of vc) {
          if (v1 !== h1 && v1 !== h2 && v2 !== h1 && v2 !== h2) total += 1;
        }
      }
      out[h * n + v] = total / hc.length;
    }
  }
  return out;
}

export interface EquityTable {
  samples: number;
  /** equity[hero * n + villain], hero's share of the pot at showdown. */
  equity: Float64Array;
}

/**
 * Load the 169x169 all-in equity table.
 *
 * Its sampling error is the dominant source of imprecision in this pack and
 * is published with it — see `solve.ts`. A hand's equity against a RANGE
 * averages many entries, so the error on what actually drives a threshold is
 * far smaller than the per-matchup figure.
 */
export function loadEquity(path: string): EquityTable {
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    samples: number;
    classes: string[];
    table: Record<string, Record<string, number>>;
  };
  const n = CLASSES.length;
  if (raw.classes.length !== n) {
    throw new Error(`equity table has ${raw.classes.length} classes, expected ${n}`);
  }
  const equity = new Float64Array(n * n);
  for (let h = 0; h < n; h++) {
    const row = raw.table[CLASSES[h]];
    if (!row) throw new Error(`equity table has no row for ${CLASSES[h]}`);
    for (let v = 0; v < n; v++) {
      const value = row[CLASSES[v]];
      // A missing entry means the pair had no valid configuration at all,
      // which cannot happen for two distinct classes. Defaulting it to 0.5
      // would hide a corrupt table behind a plausible number.
      if (value === undefined) throw new Error(`equity table has no ${CLASSES[h]} vs ${CLASSES[v]}`);
      equity[h * n + v] = value;
    }
  }
  return { samples: raw.samples, equity };
}

/** A strategy over the 169 classes: the frequency each one takes the action. */
export type Range = Float64Array;

export const emptyRange = (): Range => new Float64Array(CLASSES.length);

/**
 * How often a villain with this range turns up, given the hero's own cards.
 *
 * Returns both the probability and the hero's equity when it happens, because
 * every caller needs the two together and computing them in one pass over the
 * villain's range is what keeps the solve loop cheap.
 */
export function againstRange(
  heroIndex: number,
  villain: Range,
  equity: Float64Array,
  removal: Float64Array
): { probability: number; equity: number } {
  const n = CLASSES.length;
  let weighted = 0;
  let total = 0;
  let equitySum = 0;
  for (let v = 0; v < n; v++) {
    const combos = removal[heroIndex * n + v];
    total += combos;
    const taken = combos * villain[v];
    if (taken === 0) continue;
    weighted += taken;
    equitySum += taken * equity[heroIndex * n + v];
  }
  return {
    probability: total > 0 ? weighted / total : 0,
    equity: weighted > 0 ? equitySum / weighted : 0,
  };
}

export interface Table {
  stack: number;
  ante: number;
}

/**
 * Money in an all-in pot besides the two players' stacks.
 *
 * Every non-participant's blind or ante stays in the pot whether they folded
 * before the jam or after it, so this depends only on WHO is in the pot — not
 * on the order anyone folded. Accumulating it as players fold in turn is the
 * natural-looking mistake, and it double-counts a blind that is behind the
 * shover.
 */
export const deadMoney = (hero: Position, villain: Position, ante: number): number =>
  startingPot(ante) - post(hero, ante) - post(villain, ante);

/**
 * EV of CALLING an all-in, in net big blinds.
 *
 * The dead money is what makes calling a shove correct with hands that are
 * behind the shoving range: the caller is not risking a stack to win a stack,
 * they are risking a stack to win a stack plus the blinds.
 */
export function callEv(
  heroIndex: number,
  caller: Position,
  shover: Position,
  shoverRange: Range,
  { stack, ante }: Table,
  equity: Float64Array,
  removal: Float64Array
): { call: number; fold: number } {
  const { equity: share } = againstRange(heroIndex, shoverRange, equity, removal);
  const pot = 2 * stack + deadMoney(caller, shover, ante);
  return { call: -stack + share * pot, fold: -post(caller, ante) };
}

export interface Behind {
  position: Position;
  /** How this player responds to a jam from the hero's seat. */
  callRange: Range;
}

/**
 * EV of SHOVING, in net big blinds.
 *
 * The jam wins the dead money outright whenever everyone folds, and otherwise
 * plays a single all-in pot against the first caller. Those two terms are the
 * whole of push/fold strategy: as the stack shortens the first term grows
 * relative to the second, which is why every shoving range must widen as the
 * stack shortens — the property `validateMonotonic` enforces.
 */
export function shoveEv(
  heroIndex: number,
  hero: Position,
  behind: readonly Behind[],
  table: Table,
  equity: Float64Array,
  removal: Float64Array
): { shove: number; fold: number } {
  const { stack, ante } = table;
  const heroPost = post(hero, ante);

  // Walk the players behind in order: each either folds or becomes the first
  // — and, under the one-caller pruning, the only — caller.
  let reachProbability = 1;
  let value = 0;
  for (const opponent of behind) {
    const { probability, equity: share } = againstRange(
      heroIndex,
      opponent.callRange,
      equity,
      removal
    );
    if (probability > 0) {
      const pot = 2 * stack + deadMoney(hero, opponent.position, ante);
      value += reachProbability * probability * (-stack + share * pot);
    }
    reachProbability *= 1 - probability;
  }
  // Everyone folded: the jam takes the dead money uncontested.
  value += reachProbability * (startingPot(ante) - heroPost);

  return { shove: value, fold: -heroPost };
}
