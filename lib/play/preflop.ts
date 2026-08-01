/**
 * The play mode's preflop step. Every instance starts from "BTN opens 2.5bb,
 * BB calls" — but the hero still has to *make* their side of that decision,
 * graded against the same reference ranges as the preflop drill
 * (lib/poker/ranges.ts). Whatever they pick, the hand then proceeds down the
 * solved line, with a note when their pick left it.
 */
import { cellFrequency, getScenario, RANK_VALUE, type Scenario } from "../poker/ranges";
import { MIX_THRESHOLD } from "../drill/kinds/preflop";

/** "7h7d" → "77", "Ad9c" → "A9o", "Ts8s" → "T8s". */
export function handNotation(hand: string): string {
  const r1 = hand[0].toUpperCase();
  const r2 = hand[2].toUpperCase();
  const suited = hand[1] === hand[3];
  if (r1 === r2) return r1 + r2;
  const [hi, lo] = RANK_VALUE[r1] >= RANK_VALUE[r2] ? [r1, r2] : [r2, r1];
  return hi + lo + (suited ? "s" : "o");
}

export interface PreflopDecision {
  scenario: Scenario;
  notation: string;
  /** Action key + button label, in the scenario's display order. */
  options: { key: string; label: string }[];
  /** Highest-frequency action. */
  answer: string;
  /** Other actions at >= MIX_THRESHOLD frequency. */
  acceptable: string[];
  /** The action key that continues the hand down the solved line. */
  continues: string;
}

/**
 * The hero's preflop decision for an instance. Hero IP is the BTN facing an
 * unopened pot (scenario "btn"); hero OOP is the BB facing the BTN open
 * (scenario "bb-btn"). The solved line continues via raise / call
 * respectively.
 */
export function preflopDecision(hero: 0 | 1, hand: string): PreflopDecision {
  const scenario = getScenario(hero === 1 ? "btn" : "bb-btn");
  if (!scenario) throw new Error("preflop scenarios missing");
  const notation = handNotation(hand);
  const f = cellFrequency(scenario, notation);
  const keys = scenario.actions.map(([key]) => key);
  let answer: string = keys[0];
  for (const key of keys) if (f[key as keyof typeof f] > f[answer as keyof typeof f]) answer = key;
  const acceptable = keys.filter(
    (key) => key !== answer && f[key as keyof typeof f] >= MIX_THRESHOLD
  );
  return {
    scenario,
    notation,
    options: scenario.actions.map(([key, label]) => ({ key, label })),
    answer,
    acceptable,
    continues: hero === 1 ? "r" : "c",
  };
}
