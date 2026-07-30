import type { DrillKind, Generator } from "./contract";
import type { Rng } from "../poker/engine";
import { DRILL_KINDS } from "./contract";
import { generateOuts } from "./kinds/outs";
import { generateRule24 } from "./kinds/rule24";
import { generatePotodds } from "./kinds/potodds";
import { generateDecision } from "./kinds/decision";
import { generateConcepts } from "./kinds/concepts";
import { generateImplied } from "./kinds/implied";
import { generateEv } from "./kinds/ev";
import { generateBluff } from "./kinds/bluff";
import { generatePreflop } from "./kinds/preflop";
import { rnd } from "./opts";

export type TabId = "mixed" | DrillKind | "reference";

/** Tab order, matching the reference trainer's MODULES list (line 1141). */
export const TAB_ORDER: TabId[] = [
  "mixed", "outs", "rule24", "potodds", "decision", "implied",
  "ev", "bluff", "concepts", "preflop", "reference",
];

export const KIND_LABELS: Record<DrillKind, string> = {
  outs: "Count outs",
  rule24: "Rule of 2 & 4",
  potodds: "Pot odds",
  decision: "Call or fold",
  implied: "Implied odds",
  ev: "Expected value",
  bluff: "Bluff math",
  concepts: "OMC mistakes",
  preflop: "Preflop drill",
};

export const TAB_LABELS: Record<TabId, string> = {
  mixed: "Mixed drill",
  reference: "Reference",
  ...KIND_LABELS,
};

/**
 * Every drill kind, all nine implemented. Typed as a total `Record`, so adding
 * a tenth `DrillKind` without a generator is a compile error rather than a tab
 * that deals nothing.
 */
export const GENERATORS: Record<DrillKind, Generator> = {
  outs: generateOuts,
  rule24: generateRule24,
  potodds: generatePotodds,
  decision: generateDecision,
  implied: generateImplied,
  ev: generateEv,
  bluff: generateBluff,
  concepts: generateConcepts,
  preflop: generatePreflop,
};

export const REGISTERED_KINDS = (): DrillKind[] => DRILL_KINDS.filter((k) => GENERATORS[k]);

export const pickMixedKind = (rng: Rng): DrillKind => {
  const kinds = REGISTERED_KINDS();
  return kinds[rnd(kinds.length, rng)];
};
