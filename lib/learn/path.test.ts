import test from "node:test";
import assert from "node:assert/strict";
import { lessonHref, nextPathStep, pathProgress, recommendationHref } from "./path";
import type { LearningPathData, Lesson, ModuleWithProgress, Recommendation } from "./types";

function lesson(id: number, moduleId: number): Lesson {
  return {
    id,
    moduleId,
    type: "concept",
    title: `Lesson ${id}`,
    order: id,
    content: { screens: [{ type: "info", content: "x" }], skill_tags: [], xp_reward: 10 },
    estimatedSeconds: 120,
    difficulty: 1,
    version: 1,
  };
}

function module_(id: number, lessonIds: number[], completed: Set<number>): ModuleWithProgress {
  const lessons = lessonIds.map((lessonId) => lesson(lessonId, id));
  return {
    id,
    title: `Module ${id}`,
    description: "d",
    order: id,
    lessons,
    completedCount: lessons.filter((l) => completed.has(l.id)).length,
    // Mirrors fetchLearningPath, INCLUDING its fallback to the first lesson
    // once the module is complete — the trap nextPathStep must not fall into.
    nextLessonId: lessons.find((l) => !completed.has(l.id))?.id ?? lessons[0]?.id ?? null,
  };
}

function path(spec: Record<number, number[]>, completedIds: number[] = []): LearningPathData {
  const completed = new Set(completedIds);
  return {
    modules: Object.entries(spec).map(([id, lessonIds]) =>
      module_(Number(id), lessonIds, completed),
    ),
    completedLessonIds: completed,
    error: null,
  };
}

/* ---------- nextPathStep ---------- */

test("nextPathStep: a fresh account starts at the first lesson of the first module", () => {
  const step = nextPathStep(path({ 1: [10, 11], 2: [20] }));
  assert.equal(step?.module.id, 1);
  assert.equal(step?.lesson.id, 10);
});

test("nextPathStep: skips completed lessons within a module", () => {
  const step = nextPathStep(path({ 1: [10, 11], 2: [20] }, [10]));
  assert.equal(step?.lesson.id, 11);
});

test("nextPathStep: crosses into the next module once one is finished", () => {
  const step = nextPathStep(path({ 1: [10, 11], 2: [20, 21] }, [10, 11]));
  assert.equal(step?.module.id, 2);
  assert.equal(step?.lesson.id, 20);
});

test("nextPathStep: a finished course has no next step", () => {
  // The bug this guards: ModuleWithProgress.nextLessonId falls back to the
  // module's FIRST lesson when the module is complete, so reading that field
  // would tell a player who has finished everything to start again at lesson 1.
  const finished = path({ 1: [10, 11], 2: [20] }, [10, 11, 20]);
  assert.equal(finished.modules[0].nextLessonId, 10);
  assert.equal(nextPathStep(finished), null);
});

test("nextPathStep: an empty or unloaded path has no next step", () => {
  assert.equal(nextPathStep(path({})), null);
  assert.equal(nextPathStep(path({ 1: [] })), null);
});

test("nextPathStep: an out-of-order completion still returns the earliest gap", () => {
  const step = nextPathStep(path({ 1: [10, 11, 12] }, [11, 12]));
  assert.equal(step?.lesson.id, 10);
});

/* ---------- pathProgress ---------- */

test("pathProgress: counts completed lessons over active lessons", () => {
  assert.deepEqual(pathProgress(path({ 1: [10, 11], 2: [20, 21] }, [10, 20])), {
    completed: 2,
    total: 4,
    pct: 50,
  });
});

test("pathProgress: an empty path is 0% rather than NaN", () => {
  assert.deepEqual(pathProgress(path({})), { completed: 0, total: 0, pct: 0 });
});

test("pathProgress: a progress row for a deactivated lesson cannot exceed the total", () => {
  // completedLessonIds carries a lesson (99) that is no longer in the path.
  // Counting the set's size would report 3 / 2.
  const p = pathProgress(path({ 1: [10, 11] }, [10, 11, 99]));
  assert.deepEqual(p, { completed: 2, total: 2, pct: 100 });
});

test("pathProgress: rounds to whole percent", () => {
  assert.equal(pathProgress(path({ 1: [1, 2, 3] }, [1])).pct, 33);
});

/* ---------- hrefs ---------- */

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    type: "none",
    lesson_id: null,
    module_id: null,
    lesson: null,
    scenario_id: null,
    reason: "r",
    skill_tag: null,
    difficulty: null,
    ...over,
  };
}

test("lessonHref: deep-links a lesson inside its module", () => {
  assert.equal(lessonHref(3, 42), "/learn/3/42");
});

test("recommendationHref: a lesson recommendation deep-links the lesson", () => {
  assert.equal(
    recommendationHref(rec({ type: "lesson", module_id: 3, lesson_id: 42 })),
    "/learn/3/42",
  );
});

test("recommendationHref: a lesson recommendation missing ids falls back to the map", () => {
  assert.equal(recommendationHref(rec({ type: "lesson", module_id: 3 })), "/learn");
});

test("recommendationHref: a scenario recommendation carries its filters", () => {
  const href = recommendationHref(
    rec({ type: "scenario", scenario_id: 7, skill_tag: "pot_odds", difficulty: 2 }),
  );
  assert.match(href, /^\/learn\/practice\?/);
  const params = new URLSearchParams(href.split("?")[1]);
  assert.equal(params.get("id"), "7");
  assert.equal(params.get("skill"), "pot_odds");
  assert.equal(params.get("difficulty"), "2");
});

test("recommendationHref: a bare scenario recommendation has no query string", () => {
  assert.equal(recommendationHref(rec({ type: "scenario" })), "/learn/practice");
});

test("recommendationHref: 'none' opens the course map", () => {
  assert.equal(recommendationHref(rec()), "/learn");
});
