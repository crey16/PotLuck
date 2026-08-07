/**
 * Reading the bundled push/fold equilibrium — M8.7E.
 *
 * PotLuck was a 100bb trainer that never said it was one. Below about 20bb the
 * preflop tree collapses to jam-or-fold and call-or-fold, which is most of a
 * tournament and the depth where preflop study pays off fastest, and none of
 * it was trainable. This is the data behind fixing that.
 *
 * ## Why these numbers can be trusted more than the usual chart
 *
 * An unexploitable shove/fold equilibrium is directly computable — every
 * terminal is an all-in pot, and an all-in pot's value is equity. So this is
 * solved rather than authored. The published pack is gated on invariants that
 * hand-written charts routinely violate, the sharpest being **monotonicity in
 * stack depth**: a shoving range that narrows as the stack shortens is a bug,
 * and it is the bug the reference product ships with.
 *
 * ## What it is NOT
 *
 * **Chip EV, never ICM.** These ranges are correct in a chip-neutral spot and
 * wrong on a tournament bubble, where busting costs more than the chips say.
 * That has to be on every surface that shows them — a chip-EV chart used on a
 * bubble is wrong in a way the player cannot see.
 *
 * Also: one caller (overcalls are pruned), jam-or-fold only, and uniform
 * stacks. `MODEL.excludes` carries the full list, published with the data
 * rather than restated here, so a surface cannot disclose a stale set.
 *
 * ## Bundled, not fetched
 *
 * 152 KB raw / 85 KB gzipped, measured — the roadmap's rule is to measure
 * dataset size before expanding coverage, not after. It is bundled because
 * the drill contract is synchronous and `DrillShell` builds the first question
 * in a `useState` initialiser so SSR and the client agree; there is nowhere in
 * that flow for a fetch. `/ranges` reads the same bundle rather than fetching
 * the fuller pack, so the chart and the drill cannot disagree.
 */
import table from "./table.json";

export type PushfoldPosition = "UTG" | "HJ" | "CO" | "BTN" | "SB" | "BB";

/** Seat order — the order they act preflop. */
export const PUSHFOLD_POSITIONS: PushfoldPosition[] = [
  "UTG", "HJ", "CO", "BTN", "SB", "BB",
];

/** Positions that can open a jam. The big blind has nobody left to fold out. */
export const SHOVE_POSITIONS: PushfoldPosition[] = ["UTG", "HJ", "CO", "BTN", "SB"];

/** 0.05bb per exported step — the same unit lib/play/verdict.ts grades in. */
export const EV_STEP_BB: number = table.ev_step_bb;

export const PUSHFOLD_CLASSES: string[] = table.classes;
const CLASS_INDEX = new Map(PUSHFOLD_CLASSES.map((c, i) => [c, i]));

/** Stack depths the pack covers, shallowest first. */
export const PUSHFOLD_DEPTHS: number[] = [
  ...new Set(Object.keys(table.tables).map((key) => Number(key.split(":")[0]))),
].sort((a, b) => a - b);

/** Ante settings, in big blinds. 0 is no ante; 1 is a full big-blind ante. */
export const PUSHFOLD_ANTES: number[] = [
  ...new Set(Object.keys(table.tables).map((key) => Number(key.split(":")[1]))),
].sort((a, b) => a - b);

/** The modelled game and everything it deliberately excludes. */
export const PUSHFOLD_MODEL = table.model as {
  table_size: number;
  positions: string[];
  blinds_bb: number[];
  ante_kind: string;
  ev_model: string;
  rake: string;
  excludes: string[];
};

type Encoded = { shove: Record<string, string>; call: Record<string, string> };
const TABLES = table.tables as Record<string, Encoded>;

const decoded = new Map<string, Int8Array>();

/**
 * Signed bytes out of base64, without Buffer.
 *
 * `atob` is the one decoder available in both the browser and Node's server
 * rendering. Values are two's-complement signed, so anything at or above 128
 * is negative — a fold that costs a big blind and a jam that wins one are the
 * same magnitude with opposite signs, and reading them all as positive would
 * make every losing action look profitable.
 */
function decode(key: string): Int8Array {
  const cached = decoded.get(key);
  if (cached) return cached;
  const [tableKey, kind, strategy] = key.split("|");
  const encoded = TABLES[tableKey]?.[kind as "shove" | "call"]?.[strategy];
  if (encoded === undefined) throw new Error(`push/fold pack has no ${key}`);
  const binary = atob(encoded);
  const out = new Int8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    const byte = binary.charCodeAt(i);
    out[i] = byte >= 128 ? byte - 256 : byte;
  }
  decoded.set(key, out);
  return out;
}

export const hasTable = (stack: number, ante: number): boolean =>
  `${stack}:${ante}` in TABLES;

function classIndex(handClass: string): number {
  const index = CLASS_INDEX.get(handClass);
  if (index === undefined) throw new Error(`unknown hand class ${handClass}`);
  return index;
}

/**
 * How much better jamming is than folding, in big blinds.
 *
 * Positive means the jam is the equilibrium action and the number is what
 * folding costs; negative means the reverse. Expressing it as a single signed
 * edge rather than two absolute EVs is what makes grading and charting the
 * same lookup — and the sign IS the strategy, so a chart never needs a
 * separate in/out flag that could disagree with the number beside it.
 */
export function shoveEdgeBb(
  position: PushfoldPosition,
  stack: number,
  ante: number,
  handClass: string
): number {
  if (position === "BB") throw new Error("the big blind cannot open a jam");
  return decode(`${stack}:${ante}|shove|${position}`)[classIndex(handClass)] * EV_STEP_BB;
}

/** How much better calling a jam is than folding to it, in big blinds. */
export function callEdgeBb(
  caller: PushfoldPosition,
  shover: PushfoldPosition,
  stack: number,
  ante: number,
  handClass: string
): number {
  return decode(`${stack}:${ante}|call|${shover}>${caller}`)[classIndex(handClass)] * EV_STEP_BB;
}

/** Positions that act after `position`, in order. */
export const positionsBehind = (position: PushfoldPosition): PushfoldPosition[] =>
  PUSHFOLD_POSITIONS.slice(PUSHFOLD_POSITIONS.indexOf(position) + 1);

export interface PushfoldRange {
  /** Hand classes the equilibrium takes the aggressive action with. */
  taking: string[];
  /**
   * Hands within one quantization step of indifference — the action is worth
   * the same as folding to the resolution this pack publishes.
   *
   * Not a rounding artifact to hide: these are the genuinely marginal hands,
   * and a trainer that graded them wrong would be inventing a distinction its
   * own data does not carry. The same discipline the M8.7A preflop pack
   * applies with its standard error, in the form quantization gives here.
   */
  indifferent: string[];
  /** Combo-weighted share of all hands, 0..100. */
  percent: number;
}

const combosOfClass = (handClass: string): number =>
  handClass.length === 2 ? 6 : handClass.endsWith("s") ? 4 : 12;

/** The whole range for one strategy, for charting. */
export function pushfoldRange(edge: (handClass: string) => number): PushfoldRange {
  const taking: string[] = [];
  const indifferent: string[] = [];
  let combos = 0;
  for (const handClass of PUSHFOLD_CLASSES) {
    const value = edge(handClass);
    if (value > 0) {
      taking.push(handClass);
      combos += combosOfClass(handClass);
    } else if (value === 0) {
      indifferent.push(handClass);
    }
  }
  return { taking, indifferent, percent: (100 * combos) / 1326 };
}

/** True when acting and folding are worth the same to this pack's resolution. */
export const isIndifferent = (edgeBb: number): boolean => edgeBb === 0;

export const shoveRange = (
  position: PushfoldPosition,
  stack: number,
  ante: number
): PushfoldRange => pushfoldRange((h) => shoveEdgeBb(position, stack, ante, h));

export const callRange = (
  caller: PushfoldPosition,
  shover: PushfoldPosition,
  stack: number,
  ante: number
): PushfoldRange => pushfoldRange((h) => callEdgeBb(caller, shover, stack, ante, h));

/**
 * The equity a call needs to break even — pure pot odds, no fold equity.
 *
 * Published as a function rather than a table because it is the number the
 * lesson teaches and the number the drill explains, and both must agree with
 * the ranges above. `risk` is what the caller still has to put in, which is
 * their stack MINUS what they already posted: the big blind calling a jam at
 * 8bb with an ante is risking 6 of their 8, not 8, and that is the whole
 * reason their calling range is so much wider than anyone's jamming range.
 */
export function callBreakEvenEquity(
  caller: PushfoldPosition,
  shover: PushfoldPosition,
  stack: number,
  ante: number
): number {
  const post = (position: PushfoldPosition): number =>
    position === "SB" ? 0.5 : position === "BB" ? 1 + ante : 0;
  const risk = stack - post(caller);
  const dead = 0.5 + 1 + ante - post(caller) - post(shover);
  return risk / (2 * stack + dead);
}
