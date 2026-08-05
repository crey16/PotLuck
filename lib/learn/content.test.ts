import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLessonTime, lessonFromRow, parseLessonContent, recommendationDifficulty, spellCount } from "./content";

const content = {
  screens: [
    { type: "info", content: "Read" },
    {
      type: "question",
      content: "Pick",
      choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      correct_choice_id: "b",
    },
  ],
  skill_tags: ["position"],
  xp_reward: 10,
};

test("parseLessonContent accepts all required authored fields", () => {
  assert.deepEqual(parseLessonContent(content), content);
});

test("parseLessonContent rejects an interactive screen with no valid answer", () => {
  assert.equal(
    parseLessonContent({
      ...content,
      screens: [{ type: "question", content: "Pick", choices: [{ id: "a", label: "A" }], correct_choice_id: "z" }],
    }),
    null
  );
});

test("lessonFromRow normalizes database field names", () => {
  const lesson = lessonFromRow({
    id: 3,
    module_id: 1,
    lesson_type: "concept",
    title: "Position",
    order_index: 2,
    content_json: content,
    estimated_time_seconds: 300,
    difficulty: 1,
    version: 1,
  });
  assert.equal(lesson?.moduleId, 1);
  assert.equal(lesson?.content.screens.length, 2);
});

test("formatLessonTime uses compact course metadata", () => {
  assert.equal(formatLessonTime(300), "5 min");
  assert.equal(formatLessonTime(null), "< 1 min");
});

test("recommendation difficulty matches the backend thresholds", () => {
  assert.equal(recommendationDifficulty(1, 5), 1);
  assert.equal(recommendationDifficulty(2, 5), 2);
  assert.equal(recommendationDifficulty(3, 4), 3);
});

test("spellCount spells the small counts /learn puts in prose", () => {
  assert.equal(spellCount(5), "five");
  assert.equal(spellCount(6), "six");
  assert.equal(spellCount(1), "one");
  assert.equal(spellCount(12), "twelve");
});

test("spellCount falls back to digits rather than printing undefined", () => {
  // The eyebrow reads "{n}-module course". An out-of-range count must degrade
  // to "13-module course", never "undefined-module course".
  assert.equal(spellCount(13), "13");
  assert.equal(spellCount(0), "zero");
});
