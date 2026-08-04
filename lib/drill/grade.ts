import { UNSURE, type DrillQuestion, type OptionValue } from "./contract";

export type Grade = "correct" | "acceptable" | "wrong" | "unsure";

/**
 * The ONE grader. Nine generators cannot disagree about what "right" means,
 * and DrillPlayer derives every button state from this single function.
 *
 * `acceptable` exists for preflop mixed strategies: a hand the solver plays
 * as 60% raise / 40% call has one canonical answer and one defensible
 * alternative. It is data rather than a predicate so it can be serialised
 * into drill_payload and re-graded server-side in M3.
 *
 * `unsure` (M8.5C) is NOT right — it scores, streaks and reads as a miss.
 * It is a separate grade rather than a flavour of "wrong" because the two
 * mean opposite things to a coach: "wrong" is a belief to correct, "unsure"
 * is a gap to fill, and M11's weakness detection has to tell them apart.
 * Everything downstream that asks "was this right?" must go through
 * `isRight`, never through `grade !== "wrong"`.
 */
export function gradeAnswer(question: DrillQuestion, chosen: OptionValue): Grade {
  if (chosen === UNSURE) return "unsure";
  if (chosen === question.answer) return "correct";
  if (question.acceptable?.includes(chosen)) return "acceptable";
  return "wrong";
}

/** Scoring, streaks and the difficulty window all treat "also fine" as right. */
export function isRight(question: DrillQuestion, chosen: OptionValue): boolean {
  const grade = gradeAnswer(question, chosen);
  return grade === "correct" || grade === "acceptable";
}
