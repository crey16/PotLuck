import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSESSMENT_VERSION,
  MAX_ENTRY_MODULE_INDEX,
  PLACEMENT_BLUEPRINT,
  PLACEMENT_QUESTION_COUNT,
  PROBE_LEVEL,
  placementAccuracy,
  placementEntryModuleIndex,
  placementLevels,
  placementQuestion,
  placementQuestions,
  placementResult,
  tagScores,
  type PlacementResponse,
} from "./blueprint";
import { DRILL_KINDS, UNSURE } from "../drill/contract";
import { gradeAnswer } from "../drill/grade";

/** Shorthand for a response list: "c" correct, "w" wrong, "u" unsure. */
function responses(pattern: string): PlacementResponse[] {
  return [...pattern].map((c, index) => ({
    index,
    correct: c === "c",
    unsure: c === "u",
  }));
}

/* ---------- the blueprint ---------- */

test("the blueprint sits inside the brief's 8-12 question target", () => {
  assert.ok(PLACEMENT_QUESTION_COUNT >= 8 && PLACEMENT_QUESTION_COUNT <= 12);
});

test("the blueprint covers every drill kind exactly once", () => {
  const kinds = PLACEMENT_BLUEPRINT.map((item) => item.kind);
  assert.deepEqual([...kinds].sort(), [...DRILL_KINDS].sort());
});

test("the blueprint covers every canonical skill tag", () => {
  // The nine tags api/skills.py maps the ten drill kinds onto. Pinned to the
  // Python map by api/test_placement_matches_typescript.py.
  const expected = [
    "bluffing", "counting_outs", "discipline", "equity_estimation",
    "expected_value", "hand_selection", "implied_odds", "pot_odds",
    "short_stack",
  ];
  const tags = [...new Set(PLACEMENT_BLUEPRINT.map((item) => item.tag))].sort();
  assert.deepEqual(tags, expected);
});

test("every probe is dealt at the same middle difficulty", () => {
  assert.equal(PROBE_LEVEL, 2);
  for (const item of PLACEMENT_BLUEPRINT) assert.equal(item.level, PROBE_LEVEL);
});

/* ---------- determinism ---------- */

test("placementQuestions: the same seed deals the same assessment", () => {
  const a = placementQuestions(4242);
  const b = placementQuestions(4242);
  assert.equal(a.length, PLACEMENT_QUESTION_COUNT);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].kind, b[i].kind);
    assert.equal(a[i].prompt, b[i].prompt);
    assert.deepEqual(a[i].options, b[i].options);
    assert.equal(a[i].answer, b[i].answer);
    assert.deepEqual(JSON.parse(JSON.stringify(a[i].payload)), JSON.parse(JSON.stringify(b[i].payload)));
  }
});

test("placementQuestions: a different seed deals a different assessment", () => {
  const a = placementQuestions(1);
  const b = placementQuestions(2);
  const differs = a.some((q, i) => JSON.stringify(q.payload) !== JSON.stringify(b[i].payload));
  assert.ok(differs, "two seeds produced an identical assessment");
});

test("placementQuestion: each index deals its blueprint kind at its level", () => {
  for (let index = 0; index < PLACEMENT_QUESTION_COUNT; index++) {
    const q = placementQuestion(1234, index);
    assert.equal(q.kind, PLACEMENT_BLUEPRINT[index].kind);
    assert.equal(q.payload.level, PLACEMENT_BLUEPRINT[index].level);
    assert.equal(q.payload.oppMode, "unknown");
  }
});

test("placementQuestion: rejects an index outside the blueprint", () => {
  assert.throws(() => placementQuestion(1, PLACEMENT_QUESTION_COUNT), RangeError);
  assert.throws(() => placementQuestion(1, -1), RangeError);
});

test("placementQuestion: every dealt question is answerable and gradeable", () => {
  for (let seed = 1; seed <= 20; seed++) {
    for (let index = 0; index < PLACEMENT_QUESTION_COUNT; index++) {
      const q = placementQuestion(seed * 1000, index);
      assert.ok(q.options.length >= 2, `${q.kind}: too few options`);
      assert.ok(
        q.options.some((o) => o.value === q.answer),
        `${q.kind}: the answer is not among the options`,
      );
      assert.equal(gradeAnswer(q, q.answer), "correct");
      assert.equal(gradeAnswer(q, UNSURE), "unsure");
    }
  }
});

/* ---------- per-tag scores ---------- */

test("tagScores: every blueprint tag is present even with no responses", () => {
  const scores = tagScores([]);
  for (const item of PLACEMENT_BLUEPRINT) {
    assert.ok(scores[item.tag], `${item.tag} missing`);
    assert.equal(scores[item.tag].asked, 0);
  }
});

test("tagScores: pot_odds accumulates both of its drill kinds", () => {
  // potodds (index 2) and decision (index 3) share the pot_odds tag.
  const scores = tagScores([
    { index: 2, correct: true, unsure: false },
    { index: 3, correct: false, unsure: false },
  ]);
  assert.equal(scores.pot_odds.asked, 2);
  assert.equal(scores.pot_odds.correct, 1);
});

test("tagScores: an unsure answer is counted apart from a wrong one", () => {
  const scores = tagScores([{ index: 0, correct: false, unsure: true }]);
  assert.deepEqual(scores.counting_outs, {
    tag: "counting_outs", asked: 1, correct: 0, unsure: 1,
  });
});

test("tagScores: an unsure answer can never also count as correct", () => {
  const scores = tagScores([{ index: 0, correct: true, unsure: true }]);
  assert.equal(scores.counting_outs.correct, 0);
  assert.equal(scores.counting_outs.unsure, 1);
});

test("tagScores: ignores a response pointing outside the blueprint", () => {
  const scores = tagScores([{ index: 99, correct: true, unsure: false }]);
  for (const score of Object.values(scores)) assert.equal(score.asked, 0);
});

/* ---------- starting difficulty ---------- */

test("placementLevels: a correct answer starts that drill at level 2", () => {
  assert.equal(placementLevels([{ index: 0, correct: true, unsure: false }]).outs, 2);
});

test("placementLevels: a wrong answer starts that drill at level 1", () => {
  assert.equal(placementLevels([{ index: 0, correct: false, unsure: false }]).outs, 1);
});

test("placementLevels: an unsure answer starts at level 1, like a miss", () => {
  // Saying "Not sure" must never be the profitable answer — including here,
  // where the reward for a miss is easier questions.
  assert.equal(placementLevels([{ index: 0, correct: false, unsure: true }]).outs, 1);
});

test("placementLevels: placement can never award level 3", () => {
  const all = placementLevels(responses("c".repeat(PLACEMENT_QUESTION_COUNT)));
  for (const level of Object.values(all)) assert.ok(level <= 2, `awarded level ${level}`);
});

test("placementLevels: an unanswered kind is absent, not defaulted", () => {
  const levels = placementLevels([{ index: 0, correct: true, unsure: false }]);
  assert.equal(Object.keys(levels).length, 1);
  assert.equal(levels.rule24, undefined);
});

test("placementLevels: a perfect assessment places every drill at level 2", () => {
  const levels = placementLevels(responses("c".repeat(PLACEMENT_QUESTION_COUNT)));
  for (const kind of DRILL_KINDS) assert.equal(levels[kind], 2, `${kind}`);
});

/* ---------- entry module ---------- */

test("placementAccuracy: unsure answers count against, like misses", () => {
  assert.equal(placementAccuracy(responses("cccc")), 1);
  assert.equal(placementAccuracy(responses("ccww")), 0.5);
  assert.equal(placementAccuracy(responses("ccuu")), 0.5);
  assert.equal(placementAccuracy([]), 0);
});

test("placementEntryModuleIndex: below 40% starts at the first module", () => {
  assert.equal(placementEntryModuleIndex(responses("cwwwwwwww")), 0); // 1/9
  assert.equal(placementEntryModuleIndex(responses("cccwwwwww")), 0); // 3/9 = 33%
});

test("placementEntryModuleIndex: 40% to 75% starts one module in", () => {
  assert.equal(placementEntryModuleIndex(responses("ccccwwwww")), 1); // 4/9 = 44%
  assert.equal(placementEntryModuleIndex(responses("ccccccwww")), 1); // 6/9 = 67%
});

test("placementEntryModuleIndex: 75% and above starts at the cap", () => {
  assert.equal(placementEntryModuleIndex(responses("cccccccww")), MAX_ENTRY_MODULE_INDEX); // 7/9 = 78%
  assert.equal(placementEntryModuleIndex(responses("ccccccccc")), MAX_ENTRY_MODULE_INDEX);
});

test("placementEntryModuleIndex: never places past the cap, however perfect", () => {
  assert.equal(MAX_ENTRY_MODULE_INDEX, 2);
  assert.equal(placementEntryModuleIndex(responses("c".repeat(20))), 2);
});

test("placementEntryModuleIndex: an abandoned assessment places nobody", () => {
  assert.equal(placementEntryModuleIndex([]), 0);
});

test("placementEntryModuleIndex: a run of unsure answers cannot skip modules", () => {
  assert.equal(placementEntryModuleIndex(responses("uuuuuuuuu")), 0);
});

/* ---------- the whole result ---------- */

test("placementResult: bundles scores, levels, entry module and accuracy", () => {
  const result = placementResult(responses("ccccccccc"));
  assert.equal(result.accuracy, 1);
  assert.equal(result.entryModuleIndex, MAX_ENTRY_MODULE_INDEX);
  assert.equal(result.levels.outs, 2);
  assert.equal(result.scores.pot_odds.asked, 2);
});

test("placementResult: a skipped assessment (no responses) changes nothing", () => {
  // The skip path must land exactly on today's cold start: module 0, and no
  // drill given a level at all.
  const result = placementResult([]);
  assert.equal(result.entryModuleIndex, 0);
  assert.deepEqual(result.levels, {});
  assert.equal(result.accuracy, 0);
  for (const score of Object.values(result.scores)) assert.equal(score.asked, 0);
});

test("the assessment version is a positive integer", () => {
  assert.ok(Number.isInteger(ASSESSMENT_VERSION) && ASSESSMENT_VERSION > 0);
});
