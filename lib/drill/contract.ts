/**
 * The frozen contract every drill generator implements. Data only: no React,
 * no HTML strings, no DOM. That is what lets each generator be unit tested
 * with a seeded Rng and written independently of the renderer.
 */
import type { Card, Rng } from "../poker/engine";

export type DrillKind =
  | "outs" | "rule24" | "potodds" | "decision" | "implied"
  | "ev" | "bluff" | "concepts" | "preflop";

export const DRILL_KINDS: DrillKind[] = [
  "outs", "rule24", "potodds", "decision", "implied",
  "ev", "bluff", "concepts", "preflop",
];

/** "unknown" = you see only your cards and the board. "shown" = villain is face-up. */
export type OppMode = "unknown" | "shown";

export type DrillLevel = 1 | 2 | 3;

export interface DrillContext {
  level: DrillLevel;
  oppMode: OppMode;
  rng: Rng;
}

/** Everything a question is allowed to put on screen. */
export type ViewBlock =
  | { type: "felt"; hero: Card[]; board: Card[]; street: "flop" | "turn"; villain?: Card[] }
  | { type: "hand"; label: string; cards: Card[] }
  | { type: "money"; items: { label: string; value: string }[] }
  | { type: "grid"; scenarioId: string; highlight?: string }
  | { type: "text"; text: string; tone?: "plain" | "warn"; center?: boolean };

export interface ExplainRow { label: string; value: string }
export interface ExplainNote {
  tone: "plain" | "warn" | "good";
  title?: string;
  text: string;
}
export interface Explain {
  rows: ExplainRow[];
  notes: ExplainNote[];
  blocks?: ViewBlock[];
}

export type OptionValue = string | number;
export interface DrillOption { label: string; value: OptionValue }

export interface DrillQuestion {
  kind: DrillKind;
  /** Small caps label, e.g. "Counting outs". */
  kicker: string;
  /** Optional chip beside the kicker, e.g. "Flop". */
  chip?: string;
  prompt: string;
  sub?: string;
  body: ViewBlock[];
  options: DrillOption[];
  /** The canonical correct value. Must appear in `options`. */
  answer: OptionValue;
  /**
   * Additional values that are also defensible — preflop mixed strategies.
   * `answer` need not be repeated here.
   */
  acceptable?: OptionValue[];
  layout: "one" | "two" | "grid3";
  explain: (chosen: OptionValue) => Explain;
  /** Written to attempts.drill_payload. Must be JSON-serialisable and
   *  sufficient to re-derive `answer`. Always carries level and oppMode. */
  payload: Record<string, unknown>;
}

export type Generator = (ctx: DrillContext) => DrillQuestion;
