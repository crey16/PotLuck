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
import { generatePushfold } from "./kinds/pushfold";
import { rnd } from "./opts";

export type TabId = "mixed" | DrillKind | "reference";

/** Tab order, matching the reference trainer's MODULES list (line 1141). */
export const TAB_ORDER: TabId[] = [
  "mixed", "outs", "rule24", "potodds", "decision", "implied",
  "ev", "bluff", "concepts", "preflop", "pushfold", "reference",
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
  pushfold: "Short stack",
};

export const TAB_LABELS: Record<TabId, string> = {
  mixed: "Mixed drill",
  reference: "Reference",
  ...KIND_LABELS,
};

/**
 * Every drill kind, all ten implemented. Typed as a total `Record`, so adding
 * an eleventh `DrillKind` without a generator is a compile error rather than a
 * tab that deals nothing. That forcing function is what M8.7E registered
 * `pushfold` through.
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
  pushfold: generatePushfold,
};

export const REGISTERED_KINDS = (): DrillKind[] => DRILL_KINDS.filter((k) => GENERATORS[k]);

export const pickMixedKind = (rng: Rng): DrillKind => {
  const kinds = REGISTERED_KINDS();
  return kinds[rnd(kinds.length, rng)];
};

/**
 * The canonical URL for a drill tab.
 *
 * Shared by the home page's drill cards and by the drill switcher, which
 * rewrites the address bar as you move between drills. Both must agree with
 * app/drill/page.tsx, which keeps `?tab=` only for values in TAB_ORDER and
 * otherwise falls back to "mixed" without complaint — so a drifted string
 * would not error, it would just quietly always open the mixed drill.
 */
export const drillHref = (tab: TabId): string => `/drill?tab=${tab}`;
