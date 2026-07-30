import type { DrillQuestion, OptionValue } from "./contract.js";

export type Grade = "correct" | "acceptable" | "wrong";

/**
 * The ONE grader. Nine generators cannot disagree about what "right" means,
 * and DrillPlayer derives every button state from this single function.
 *
 * `acceptable` exists for preflop mixed strategies: a hand the solver plays
 * as 60% raise / 40% call has one canonical answer and one defensible
 * alternative. It is data rather than a predicate so it can be serialised
 * into drill_payload and re-graded server-side in M3.
 */
export function gradeAnswer(question: DrillQuestion, chosen: OptionValue): Grade {
  if (chosen === question.answer) return "correct";
  if (question.acceptable?.includes(chosen)) return "acceptable";
  return "wrong";
}

/** Scoring, streaks and the difficulty window all treat "also fine" as right. */
export function isRight(question: DrillQuestion, chosen: OptionValue): boolean {
  return gradeAnswer(question, chosen) !== "wrong";
}
