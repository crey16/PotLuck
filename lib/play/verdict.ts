/**
 * Per-decision grading for the play mode, GTO-Wizard style: the verdict is
 * driven by EV loss (how much the choice costs against the solver's best
 * action), with solver frequency as a secondary signal.
 *
 * Units: `loss` is the exported u8 (0.05bb per step); `freq` the exported
 * u8 (255 = always). Thresholds:
 *   correct     — within 0.1bb of the best action (includes every action a
 *                 solver actually mixes at meaningful frequency; near-
 *                 indifferent options grade as right, like the preflop
 *                 drill's MIX_THRESHOLD does)
 *   acceptable  — the solver plays it at least ~20% and it costs < 0.5bb
 *   inaccuracy  — costs < 0.75bb
 *   blunder     — 0.75bb or worse
 */
import type { PlayNode } from "./types";

export type Verdict = "correct" | "acceptable" | "inaccuracy" | "blunder";

/** 0.05bb per exported EV-loss step. */
export const EV_STEP_BB = 0.05;
/** $0.50 per step at the drills' $1-per-chip, 10-chip-blind convention. */
export const EV_STEP_DOLLARS = 0.5;

const CORRECT_MAX = 2; // 0.1bb
const MIX_FREQ_MIN = 51; // ~20%
const ACCEPTABLE_MAX = 10; // 0.5bb
const INACCURACY_MAX = 14; // < 0.75bb

export function verdictFor(freq: number, loss: number): Verdict {
  if (loss <= CORRECT_MAX) return "correct";
  if (freq >= MIX_FREQ_MIN && loss <= ACCEPTABLE_MAX) return "acceptable";
  if (loss <= INACCURACY_MAX) return "inaccuracy";
  return "blunder";
}

export function verdictAt(node: PlayNode, action: number): Verdict {
  return verdictFor(node.f[action], node.l[action]);
}

/** Scoring and attempts treat correct + acceptable as right. */
export const isRightVerdict = (v: Verdict): boolean =>
  v === "correct" || v === "acceptable";

export const lossBb = (loss: number): number => loss * EV_STEP_BB;
export const lossDollars = (loss: number): number => loss * EV_STEP_DOLLARS;
