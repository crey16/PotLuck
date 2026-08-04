/**
 * The M8.5B placement assessment: what it asks, and what its result means.
 *
 * Pure and data-only — no React, no network, no Supabase — so every rule below
 * is unit-testable and so the API can mirror the parts it must enforce.
 *
 * Two principles the brief is explicit about:
 *
 *  1. The questions come from the existing tested generators and skill tags,
 *     not a new authored bank. Placement is then derived from exactly the same
 *     math as the drills it places into; an authored bank would drift from
 *     them and place people into difficulties that do not match what they will
 *     actually be asked.
 *  2. It is never a gate. Skipping is a first-class outcome that falls back to
 *     today's cold-start behaviour, and it can be retaken later.
 */
import { GENERATORS } from "../drill/registry";
import { mulberry32 } from "../drill/rng";
import { UNSURE, type DrillKind, type DrillLevel, type DrillQuestion } from "../drill/contract";

/**
 * Bump when the blueprint, its levels, or the score mapping change. Stored on
 * every assessment row so an old result is never reinterpreted by new rules.
 */
export const ASSESSMENT_VERSION = 1;

/**
 * The level every placement question is dealt at.
 *
 * Level 2 ("mixed sizings"), not 1 and not 3. Level 1 is answerable by anyone
 * who can multiply and separates nobody; level 3 fails almost everyone and
 * separates nobody either. The middle tier is where a single question carries
 * the most information.
 */
export const PROBE_LEVEL: DrillLevel = 2;

export interface BlueprintItem {
  kind: DrillKind;
  level: DrillLevel;
  /** The canonical skill tag, mirroring api/skills.py's SKILL_TAGS. */
  tag: string;
}

/**
 * One question per drill kind: nine questions, covering all eight canonical
 * skill tags (`potodds` and `decision` share `pot_odds` — a call/fold spot IS
 * a pot-odds question).
 *
 * Nine sits inside the brief's 8–12 target, and every extra question would
 * have to be a second probe of a tag already covered. That buys a little
 * confidence at the cost of the thing that actually matters here: a brand-new
 * player finishing the assessment instead of abandoning it.
 */
export const PLACEMENT_BLUEPRINT: readonly BlueprintItem[] = [
  { kind: "outs", level: PROBE_LEVEL, tag: "counting_outs" },
  { kind: "rule24", level: PROBE_LEVEL, tag: "equity_estimation" },
  { kind: "potodds", level: PROBE_LEVEL, tag: "pot_odds" },
  { kind: "decision", level: PROBE_LEVEL, tag: "pot_odds" },
  { kind: "implied", level: PROBE_LEVEL, tag: "implied_odds" },
  { kind: "ev", level: PROBE_LEVEL, tag: "expected_value" },
  { kind: "bluff", level: PROBE_LEVEL, tag: "bluffing" },
  { kind: "concepts", level: PROBE_LEVEL, tag: "discipline" },
  { kind: "preflop", level: PROBE_LEVEL, tag: "hand_selection" },
];

export const PLACEMENT_QUESTION_COUNT = PLACEMENT_BLUEPRINT.length;

/**
 * Deal the question at `index`, reproducibly.
 *
 * The rng is derived from `seed + index` exactly as `DrillShell` derives a
 * hand from `seed + dealCount`, so a reported bad placement question can be
 * regenerated from (assessment_version, seed, index) alone.
 *
 * Opponent mode is fixed to "unknown": face-up is a setting a player chooses
 * once they know it exists, and placing someone using a mode they have never
 * seen measures the interface rather than the skill.
 */
export function placementQuestion(seed: number, index: number): DrillQuestion {
  const item = PLACEMENT_BLUEPRINT[index];
  if (!item) throw new RangeError(`placementQuestion: no blueprint item at ${index}`);
  return GENERATORS[item.kind]({
    level: item.level,
    oppMode: "unknown",
    rng: mulberry32(seed + index),
  });
}

/** Every question of an assessment, in order. */
export function placementQuestions(seed: number): DrillQuestion[] {
  return PLACEMENT_BLUEPRINT.map((_, index) => placementQuestion(seed, index));
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

export interface PlacementResponse {
  index: number;
  correct: boolean;
  /** True when the player answered "Not sure" (M8.5C). Never also `correct`. */
  unsure: boolean;
}

export interface TagScore {
  tag: string;
  asked: number;
  correct: number;
  /**
   * How many of `asked` were answered "Not sure". Kept separate from wrong
   * answers because M11 measures a knowledge gap differently from a confident
   * error, and placement is the baseline it compares later trends against.
   */
  unsure: number;
}

export const isUnsureAnswer = (chosen: unknown): boolean => chosen === UNSURE;

/** Per-skill-tag scores. Every blueprint tag appears, even at zero asked. */
export function tagScores(responses: readonly PlacementResponse[]): Record<string, TagScore> {
  const scores: Record<string, TagScore> = {};
  for (const item of PLACEMENT_BLUEPRINT) {
    scores[item.tag] ??= { tag: item.tag, asked: 0, correct: 0, unsure: 0 };
  }
  for (const response of responses) {
    const item = PLACEMENT_BLUEPRINT[response.index];
    if (!item) continue;
    const score = scores[item.tag];
    score.asked += 1;
    if (response.unsure) score.unsure += 1;
    else if (response.correct) score.correct += 1;
  }
  return scores;
}

/**
 * The starting difficulty each drill kind gets from this result.
 *
 * One question answered correctly justifies starting at level 2 and nothing
 * more. Level 3 is deliberately unreachable from placement: a single question
 * is not evidence of mastery, and the adaptive window promotes to 3 after six
 * answers at 80% anyway — the assessment only needs to save the player from
 * grinding through material that is beneath them, not to certify them.
 *
 * An unsure answer places at level 1 like a wrong one. It is not a confident
 * error, but it is also not a demonstration, and the whole point of the
 * affordance is that it should never be the profitable answer.
 *
 * Unanswered kinds are absent from the result rather than defaulted, so a
 * partial assessment leaves them to the normal cold start.
 */
export function placementLevels(
  responses: readonly PlacementResponse[],
): Partial<Record<DrillKind, DrillLevel>> {
  const levels: Partial<Record<DrillKind, DrillLevel>> = {};
  for (const response of responses) {
    const item = PLACEMENT_BLUEPRINT[response.index];
    if (!item) continue;
    const earned: DrillLevel = !response.unsure && response.correct ? 2 : 1;
    // A kind can appear once in the blueprint today, but take the best of any
    // duplicates rather than letting order decide.
    const current = levels[item.kind] ?? 1;
    levels[item.kind] = Math.max(current, earned) as DrillLevel;
  }
  return levels;
}

/** Overall correct fraction. Unsure answers count against, as misses do. */
export function placementAccuracy(responses: readonly PlacementResponse[]): number {
  if (responses.length === 0) return 0;
  const correct = responses.filter((r) => !r.unsure && r.correct).length;
  return correct / responses.length;
}

/**
 * The 0-based module index the path should start at.
 *
 * Thresholds are the settled StackSchool ones already used by
 * `difficulty_for_accuracy` (api/learning.py): below 40%, below 75%, above.
 * Reusing them keeps one accuracy vocabulary across placement, recommendations
 * and drill difficulty instead of inventing a third set of cut-offs.
 *
 * Capped at index 2 on purpose. Nine questions of poker math say nothing about
 * bankroll discipline or table selection, so placement may skip the
 * foundations a player has demonstrably outgrown and no further — being placed
 * past material you have not shown is worse than being placed under it.
 */
export const MAX_ENTRY_MODULE_INDEX = 2;

export function placementEntryModuleIndex(responses: readonly PlacementResponse[]): number {
  // An abandoned assessment places nobody: no responses means no evidence.
  if (responses.length === 0) return 0;
  const accuracy = placementAccuracy(responses);
  if (accuracy < 0.4) return 0;
  if (accuracy < 0.75) return 1;
  return MAX_ENTRY_MODULE_INDEX;
}

export interface PlacementResult {
  scores: Record<string, TagScore>;
  levels: Partial<Record<DrillKind, DrillLevel>>;
  entryModuleIndex: number;
  accuracy: number;
}

/** Everything a completed assessment persists, from its responses alone. */
export function placementResult(responses: readonly PlacementResponse[]): PlacementResult {
  return {
    scores: tagScores(responses),
    levels: placementLevels(responses),
    entryModuleIndex: placementEntryModuleIndex(responses),
    accuracy: placementAccuracy(responses),
  };
}
