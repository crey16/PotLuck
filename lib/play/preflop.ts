/**
 * The play mode's preflop step, graded from solver EVs — M8.7A.
 *
 * This used to grade against the hand-authored reference ranges in
 * `lib/poker/ranges.ts`, picking whichever action they listed at the highest
 * frequency. That produced a verdict and no EV at all, which is why every
 * preflop decision was excluded from the GTO score (`score.ts`, "unknown is
 * not zero"). It now reads the published preflop pack, so a preflop decision
 * carries a real EV loss in big blinds and counts like any postflop one.
 *
 * ## Three things about this pack that shape the whole module
 *
 * **1. It is indexed by 169-class, not by combo.** The pack's EVs are averages
 * over a 25-flop sample, and the six suit-isomorphic combos of `22` differ by
 * up to 1.8bb purely from that sampling. Grading AsKs differently from AhKd
 * would teach a suit superstition, so the pack aggregates and so does this.
 *
 * **2. Every EV ships with a standard error, and grading must respect it.**
 * `verdictForEvLoss` grades only the part of the loss that exceeds the
 * measurement error. Roughly a third of BB's grid sits within one SE of its
 * own call/fold threshold at this sample size, and those hands grade as
 * correct either way — which is the honest answer, not a lenient one.
 *
 * **3. The solved tree has no 3-bet.** BB's actions are call and fold, full
 * stop. The reference scenario offered a 3-bet and this deliberately does not:
 * the slice prunes to a heads-up tree with a dead small blind, so there is no
 * solved 3-bet line to grade against or to continue down. Offering the button
 * anyway would be the "offered and then quietly substituted" failure that
 * `lib/play/setup.ts` exists to prevent. It is stated on screen instead.
 *
 * Because the tree is what it is, these ranges are far wider than a real
 * 6-max button range — BB cannot punish an open. `/play` must never present
 * them as "how to open the button"; see docs/14's CORRECTION 2026-08-06.
 */
import { RANK_VALUE } from "../poker/ranges";
import { verdictForEvLoss, type Verdict } from "./verdict";

/** Net stack change over the whole hand, in milli-big-blinds. */
export type Mbb = number;

export interface PreflopAction {
  code: string;
  label: string;
  kind: string;
  amount_bb: number | null;
}

export interface PreflopRole {
  position: "BTN" | "BB";
  facing: string;
  actions: PreflopAction[];
  /** 169-class notation -> per-action EV (ordered as `actions`) and its SE. */
  hands: Record<string, { ev: Mbb[]; se: Mbb }>;
}

export interface PreflopPack {
  spot: string;
  kind: "preflop-ev";
  format_version: number;
  ev_unit: "mbb";
  hand_index: "class169";
  provenance: {
    iteration: number;
    flops_averaged: number;
    [key: string]: unknown;
  };
  precision: {
    basis: string;
    median_se_mbb: number;
    p90_se_mbb: number;
    max_se_mbb: number;
    note: string;
  };
  model: {
    stack_bb: number;
    blinds_bb: number[];
    ante_bb: number;
    rake: string;
    excludes: string[];
  };
  roles: Record<string, PreflopRole>;
}

/** "7h7d" → "77", "Ad9c" → "A9o", "Ts8s" → "T8s". */
export function handNotation(hand: string): string {
  const r1 = hand[0].toUpperCase();
  const r2 = hand[2].toUpperCase();
  const suited = hand[1] === hand[3];
  if (r1 === r2) return r1 + r2;
  const [hi, lo] = RANK_VALUE[r1] >= RANK_VALUE[r2] ? [r1, r2] : [r2, r1];
  return hi + lo + (suited ? "s" : "o");
}

export interface PreflopOption {
  key: string;
  label: string;
  /** Absolute EV of this action: net big blinds over the whole hand. */
  evBb: number;
  /** Cost against the best action, in big blinds. Never negative. */
  lossBb: number;
  /** True when this action is within one SE of best — too close to call. */
  indistinguishable: boolean;
}

export interface PreflopDecision {
  position: "BTN" | "BB";
  notation: string;
  facing: string;
  options: PreflopOption[];
  /** Highest-EV action code. */
  answer: string;
  /** Standard error of this hand's EV difference, in big blinds. */
  seBb: number;
  /**
   * True when every action is within the noise — the pack genuinely cannot
   * separate them at this sample size. Worth saying out loud rather than
   * picking a winner by a hundredth of a blind.
   */
  tooCloseToCall: boolean;
  /** The action that continues the hand down the solved line. */
  continues: string;
}

/**
 * Which role the hero is playing. Hero IP is the BTN facing an unopened pot;
 * hero OOP is the BB facing the BTN open.
 */
export const preflopRoleFor = (hero: 0 | 1): "BTN" | "BB" => (hero === 1 ? "BTN" : "BB");

export function preflopDecision(
  pack: PreflopPack,
  hero: 0 | 1,
  hand: string
): PreflopDecision {
  const position = preflopRoleFor(hero);
  const role = pack.roles[position];
  if (!role) throw new Error(`preflop pack has no role ${position}`);
  const notation = handNotation(hand);
  const entry = role.hands[notation];
  // A missing hand is a corrupt pack, not a playable state: the pack is
  // published only at 1326/1326 combo coverage, so all 169 classes exist.
  if (!entry) throw new Error(`preflop pack has no ${position} entry for ${notation}`);

  const evBb = entry.ev.map((mbb) => mbb / 1000);
  const seBb = entry.se / 1000;
  const bestEv = Math.max(...evBb);
  const bestIndex = evBb.indexOf(bestEv);

  const options: PreflopOption[] = role.actions.map((action, i) => {
    const lossBb = bestEv - evBb[i];
    return {
      key: action.code,
      label: action.label,
      evBb: evBb[i],
      lossBb,
      indistinguishable: lossBb <= seBb,
    };
  });

  return {
    position,
    notation,
    facing: role.facing,
    options,
    answer: role.actions[bestIndex].code,
    seBb,
    tooCloseToCall: options.every((o) => o.indistinguishable),
    // The solved line is BTN opens, BB calls. Any other choice ends the hand
    // rather than continuing into a postflop solve that never happened.
    continues: hero === 1 ? "r" : "c",
  };
}

/** The EV loss of one choice, in big blinds. */
export function preflopLossBb(decision: PreflopDecision, key: string): number {
  const option = decision.options.find((o) => o.key === key);
  if (!option) throw new Error(`${key} is not an action at this preflop node`);
  return option.lossBb;
}

/** The verdict for one choice, with the pack's measured tolerance applied. */
export function preflopVerdict(decision: PreflopDecision, key: string): Verdict {
  return verdictForEvLoss(preflopLossBb(decision, key), decision.seBb);
}
