/**
 * Pure derivations over a loaded `LearningPathData`.
 *
 * `/learn` answers "what is my next lesson, and how far along am I?". These
 * live here rather than inside the page so the answer has one implementation:
 * `recommendationHref` is shared with the home page's recommendation card, and
 * the two traps documented below are the kind that produce a confidently wrong
 * answer rather than an error.
 */
import type { LearningPathData, ModuleWithProgress, Lesson, Recommendation } from "./types";

export interface PathStep {
  module: ModuleWithProgress;
  lesson: Lesson;
}

export interface PathProgress {
  completed: number;
  total: number;
  /** Whole percent, 0 when the course has no lessons loaded. */
  pct: number;
}

/**
 * The next lesson to take: the first uncompleted lesson in module order, then
 * lesson order. Null when every lesson is done, or when nothing is loaded.
 *
 * Deliberately NOT built from `ModuleWithProgress.nextLessonId`. That field
 * falls back to the module's first lesson once the module is complete, so a
 * finished course would report its own first lesson as "next" and the landing
 * page would tell a player who has done everything to start again from the
 * beginning.
 */
export function nextPathStep(path: LearningPathData): PathStep | null {
  // Named `courseModule`, not `module`: Next's no-assign-module-variable rule
  // rejects binding that identifier in an app-router module.
  for (const courseModule of path.modules) {
    for (const lesson of courseModule.lessons) {
      if (!path.completedLessonIds.has(lesson.id)) {
        return { module: courseModule, lesson };
      }
    }
  }
  return null;
}

/** Lessons completed out of lessons loaded, across every module. */
export function pathProgress(path: LearningPathData): PathProgress {
  const total = path.modules.reduce((sum, module) => sum + module.lessons.length, 0);
  // Not `completedLessonIds.size`: that counts progress rows, which can include
  // a lesson that has since been deactivated and is no longer in the path. The
  // denominator only ever counts active lessons, so counting the numerator any
  // other way can report 21 / 20.
  const completed = path.modules.reduce(
    (sum, module) =>
      sum + module.lessons.filter((lesson) => path.completedLessonIds.has(lesson.id)).length,
    0,
  );
  return { completed, total, pct: total ? Math.round((completed / total) * 100) : 0 };
}

/** Deep link for a lesson anywhere in the path. */
export const lessonHref = (moduleId: number, lessonId: number): string =>
  `/learn/${moduleId}/${lessonId}`;

/**
 * Where a deterministic recommendation points. Was duplicated verbatim in
 * `app/page.tsx` and `app/learn/page.tsx`; both call this. The home page's
 * "Recommended next" card and the course page's "Recommended practice" row are
 * the same recommendation and must resolve to the same URL.
 */
export function recommendationHref(recommendation: Recommendation): string {
  if (recommendation.type === "lesson" && recommendation.lesson_id && recommendation.module_id) {
    return lessonHref(recommendation.module_id, recommendation.lesson_id);
  }
  if (recommendation.type === "scenario") {
    const params = new URLSearchParams();
    if (recommendation.scenario_id) params.set("id", String(recommendation.scenario_id));
    if (recommendation.skill_tag) params.set("skill", recommendation.skill_tag);
    if (recommendation.difficulty) params.set("difficulty", String(recommendation.difficulty));
    return `/learn/practice${params.size ? `?${params}` : ""}`;
  }
  return "/learn";
}
