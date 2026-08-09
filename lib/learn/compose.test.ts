import assert from "node:assert/strict";
import test from "node:test";

import type { PublicContent } from "../content/publicContent";
import { composeLearningPath } from "./compose";
import type { Lesson, LearningModule, LessonProgress } from "./types";

/**
 * Guards M8.8C: two readers, one shared course, no bleed.
 *
 * `composeLearningPath` is the join between a cache shared by every account
 * and one account's freshly-read progress. If the shared half were ever
 * mutated — a `completedCount` written onto the cached module, a lesson array
 * reused and sorted in place — the next request would inherit it, and the
 * symptom would be one player seeing another's ticks. That is invisible in a
 * single-user test, so every case here runs **two** readers.
 *
 * The content object is deep-frozen. A mutation is then not merely detected
 * after the fact; it throws at the point of the write, which names the line.
 */

const MODULES: LearningModule[] = [
  { id: 1, title: "Foundations", description: "", order: 1 },
  { id: 2, title: "Pot odds", description: "", order: 2 },
];

const lesson = (id: number, moduleId: number, order: number): Lesson => ({
  id,
  moduleId,
  type: "concept",
  title: `Lesson ${id}`,
  order,
  content: { screens: [{ type: "info", content: "x" }], skill_tags: [], xp_reward: 10 },
  estimatedSeconds: 300,
  difficulty: 1,
  version: 1,
});

const LESSONS: Lesson[] = [
  lesson(10, 1, 1),
  lesson(11, 1, 2),
  lesson(20, 2, 1),
  lesson(21, 2, 2),
];

/** Deep-freeze so any write into the shared half throws where it happens. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

const CONTENT: PublicContent = deepFreeze({
  modules: MODULES,
  lessons: LESSONS,
  scenarios: [],
});

const progress = (lessonId: number, status: string): LessonProgress => ({
  lessonId,
  status,
  completedAt: null,
  attemptsCount: 1,
  bestScore: 100,
});

/** Anna has finished the first module. Ben has done nothing. */
const ANNA: LessonProgress[] = [progress(10, "completed"), progress(11, "completed")];
const BEN: LessonProgress[] = [];

test("two readers of the same content object get their own progress", () => {
  const anna = composeLearningPath(CONTENT, ANNA);
  const ben = composeLearningPath(CONTENT, BEN);

  assert.deepEqual([...anna.completedLessonIds].sort(), [10, 11]);
  assert.deepEqual([...ben.completedLessonIds], []);

  assert.equal(anna.modules[0].completedCount, 2);
  assert.equal(ben.modules[0].completedCount, 0);

  // The next step differs, which is the visible consequence of the above.
  assert.equal(anna.modules[0].nextLessonId, 10, "a finished module points back at its first lesson");
  assert.equal(ben.modules[0].nextLessonId, 10);
  assert.equal(anna.modules[1].completedCount, 0);
});

test("order of composition cannot matter", () => {
  // Ben first, then Anna, then Ben again: if the first call left anything
  // behind on the shared content, the third result would differ from the first.
  const benFirst = composeLearningPath(CONTENT, BEN);
  composeLearningPath(CONTENT, ANNA);
  const benAgain = composeLearningPath(CONTENT, BEN);
  assert.deepEqual(
    benAgain.modules.map((m) => m.completedCount),
    benFirst.modules.map((m) => m.completedCount)
  );
  assert.deepEqual([...benAgain.completedLessonIds], [...benFirst.completedLessonIds]);
});

test("the shared content object is never mutated", () => {
  const before = JSON.stringify(CONTENT);
  composeLearningPath(CONTENT, ANNA);
  composeLearningPath(CONTENT, BEN);
  assert.equal(JSON.stringify(CONTENT), before);
  // Frozen input means a write would already have thrown; this also asserts
  // the results are genuinely new objects rather than aliases of the cache.
  const anna = composeLearningPath(CONTENT, ANNA);
  assert.notEqual(anna.modules[0], CONTENT.modules[0]);
  assert.ok(!Object.isFrozen(anna.modules[0]));
});

test("one reader's result cannot be edited into another's view", () => {
  const anna = composeLearningPath(CONTENT, ANNA);
  anna.completedLessonIds.add(20);
  anna.modules[1].completedCount = 99;
  const ben = composeLearningPath(CONTENT, BEN);
  assert.deepEqual([...ben.completedLessonIds], []);
  assert.equal(ben.modules[1].completedCount, 0);
});

test("placed_out counts as satisfied, and only for the reader who has it", () => {
  const placed = composeLearningPath(CONTENT, [progress(10, "placed_out")]);
  const other = composeLearningPath(CONTENT, [progress(10, "in_progress")]);
  assert.ok(placed.completedLessonIds.has(10));
  assert.ok(!other.completedLessonIds.has(10));
  assert.equal(placed.modules[0].nextLessonId, 11);
  assert.equal(other.modules[0].nextLessonId, 10);
});

test("an empty course composes to an empty path for either reader", () => {
  const empty: PublicContent = deepFreeze({ modules: [], lessons: [], scenarios: [] });
  for (const rows of [ANNA, BEN]) {
    const result = composeLearningPath(empty, rows);
    assert.deepEqual(result.modules, []);
    assert.equal(result.error, null);
  }
});
