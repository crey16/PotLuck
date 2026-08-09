import { getAuthUserId } from "../supabase/server";
import { supabaseConfigured } from "../supabase/env";
import {
  completedLessonIds,
  getUserProgress,
  getUserSkillStats,
  progressForLesson,
} from "../supabase/requestContext";
import { MIN_SKILL_ATTEMPTS } from "../drill/serverStats";
import { timeServerRead } from "../observability/serverTiming";
import {
  lessonById,
  lessonsForModule,
  loadPublicContent,
  moduleById,
} from "../content/publicContent";
import { composeLearningPath } from "./compose";
import { recommendationDifficulty } from "./content";
import type {
  LearningModule,
  LearningPathData,
  Lesson,
  LessonProgress,
  Recommendation,
} from "./types";

/**
 * ## Where the content/progress line falls in this file — M8.8C
 *
 * Every function below used to fetch the course and the reader's progress in
 * one `Promise.all`. The course is the same for everyone and changes when it
 * ships; the progress is different for everyone and changes when they answer.
 * Blended, neither half could be cached.
 *
 * They are now separate reads, still started together so nothing serializes:
 * `loadPublicContent()` from `lib/content/publicContent.ts` is shared across
 * requests and versioned, and the `progress` / `skill_stats` queries here stay
 * per-request, RLS-scoped and uncached. Composition happens in this file.
 *
 * **Nothing derived from a user may cross back into the content layer.** The
 * cached value is read-only here: `completedLessonIds` and every
 * `ModuleWithProgress` are built on this side, from a fresh progress read, and
 * are never handed back for storage.
 */

const EMPTY: LearningPathData = {
  modules: [],
  completedLessonIds: new Set<number>(),
  error: null,
};

function progressFromRow(row: Record<string, unknown>): LessonProgress | null {
  if (typeof row.lesson_id !== "number" || typeof row.status !== "string") return null;
  return {
    lessonId: row.lesson_id,
    status: row.status,
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    attemptsCount: typeof row.attempts_count === "number" ? row.attempts_count : 0,
    bestScore: typeof row.best_score === "number" ? row.best_score : 0,
  };
}

export async function fetchLearningPath(): Promise<LearningPathData> {
  if (!supabaseConfigured()) {
    return { ...EMPTY, error: "Supabase is not configured." };
  }
  const userId = await getAuthUserId();
  if (!userId) return { ...EMPTY, error: "Sign in to open the learning path." };
  // Started together: the shared content read and this reader's progress do
  // not depend on each other, so a cache miss costs no more wall clock than
  // the old combined query did.
  // `loadPublicContent` throws when the course cannot be read at all, which is
  // how an outage stays distinguishable from an empty seed — see its own note.
  // Each caller below turns that back into the same failure value it returned
  // before the content/progress split.
  let content;
  let progressResult;
  try {
    [content, progressResult] = await timeServerRead("learn.path", () =>
      Promise.all([loadPublicContent(), getUserProgress()])
    );
  } catch {
    return { ...EMPTY, error: "The learning path could not be loaded." };
  }
  if (progressResult.error) return { ...EMPTY, error: "The learning path could not be loaded." };

  const progress = (progressResult.data ?? []).flatMap((row) => {
    const parsed = progressFromRow({ ...row });
    return parsed ? [parsed] : [];
  });
  return composeLearningPath(content, progress);
}

export async function fetchModule(
  moduleId: number
): Promise<{ module: LearningModule; lessons: Lesson[]; completedLessonIds: Set<number> } | null> {
  if (!supabaseConfigured()) return null;
  const userId = await getAuthUserId();
  if (!userId) return null;
  // The whole course is already the cached unit, so selecting one module from
  // it costs nothing and avoids a second cache dimension. A per-module entry
  // would multiply the keys by the module count for no gain: the course is
  // read in full by `/learn` and the recommendation on the same visit anyway.
  const [content, progressResult] = await timeServerRead("learn.module", () =>
    Promise.all([loadPublicContent().catch(() => null), getUserProgress()])
  );
  if (!content) return null;
  const learningModule = moduleById(content, moduleId);
  if (!learningModule || progressResult.error) return null;
  const lessons = lessonsForModule(content, moduleId);
  // The shared read is unfiltered, so the `status = completed` filter that used
  // to be in the query is taken here. One row per lesson means the whole set is
  // a couple of dozen small integers — cheaper than a second round trip.
  return {
    module: learningModule,
    lessons,
    completedLessonIds: completedLessonIds(progressResult.data),
  };
}

export async function fetchLesson(
  moduleId: number,
  lessonId: number
): Promise<{ module: LearningModule; lesson: Lesson; completed: boolean } | null> {
  if (!supabaseConfigured()) return null;
  const userId = await getAuthUserId();
  if (!userId) return null;
  const [content, progressResult] = await timeServerRead("learn.lesson", () =>
    Promise.all([loadPublicContent().catch(() => null), getUserProgress()])
  );
  if (!content) return null;
  const learningModule = moduleById(content, moduleId);
  // `lessonById` checks the module too, so a lesson id from another module is
  // still a miss — the old query enforced that with `.eq("module_id", …)` and
  // dropping it would turn a wrong URL into someone else's lesson under the
  // wrong heading.
  const lesson = lessonById(content, moduleId, lessonId);
  if (!learningModule || !lesson) return null;
  return {
    module: learningModule,
    lesson,
    completed: progressForLesson(progressResult.data, lessonId)?.status === "completed",
  };
}

export async function fetchServerRecommendation(): Promise<Recommendation> {
  const none: Recommendation = {
    type: "none",
    lesson_id: null,
    module_id: null,
    lesson: null,
    scenario_id: null,
    reason: "Learning content is not available yet",
    skill_tag: null,
    difficulty: null,
  };
  if (!supabaseConfigured()) return none;
  const userId = await getAuthUserId();
  if (!userId) return none;
  // Three content reads became one shared lookup; the two personalized reads
  // stay exactly as they were. This is the function the dashboard streams
  // behind its Suspense boundary, so it is also the one that benefits most
  // from a hit.
  const [content, progressResult, skillsResult] = await timeServerRead(
    // The one read the dashboard streams behind a Suspense boundary (M8.8C).
    // Timed separately because it is explicitly NOT part of `/`'s TTFB — a
    // report that added it to `dashboard.stats` would be describing a wait
    // nobody has.
    "learn.recommendation",
    () =>
      Promise.all([
        loadPublicContent().catch(() => null),
        getUserProgress(),
        getUserSkillStats(),
      ])
  );
  if (!content || progressResult.error || skillsResult.error) return none;
  const scenarios = content.scenarios;
  const moduleOrder = new Map<number, number>(
    content.modules.map((entry) => [entry.id, entry.order])
  );
  const lessons = [...content.lessons]
    .sort(
      (a, b) =>
        (moduleOrder.get(a.moduleId) ?? a.moduleId) - (moduleOrder.get(b.moduleId) ?? b.moduleId) ||
        a.order - b.order ||
        a.id - b.id
    );
  const completed = completedLessonIds(progressResult.data);
  // `gte("total_attempts", 5)` was the query's filter and is now taken here —
  // the same rule the dashboard's "weakest skill" uses, against the same eight
  // rows, read once. See `docs/04-roadmap.md` on why that rule lives in one
  // place: Home and Learn must not be able to disagree about what is weakest.
  const weakest = [...(skillsResult.data ?? [])]
    .filter((row) => row.total_attempts >= MIN_SKILL_ATTEMPTS)
    .sort((a, b) => {
      const aAccuracy = a.correct_attempts / a.total_attempts;
      const bAccuracy = b.correct_attempts / b.total_attempts;
      return aAccuracy - bAccuracy || String(a.skill_tag).localeCompare(String(b.skill_tag));
    })[0];

  const lessonRecommendation = (lesson: Lesson, reason: string, skillTag: string | null): Recommendation => ({
    type: "lesson",
    lesson_id: lesson.id,
    module_id: lesson.moduleId,
    lesson: {
      id: lesson.id,
      module_id: lesson.moduleId,
      title: lesson.title,
      lesson_type: lesson.type,
      estimated_time_seconds: lesson.estimatedSeconds,
      difficulty: lesson.difficulty,
    },
    scenario_id: null,
    reason,
    skill_tag: skillTag,
    difficulty: null,
  });

  if (weakest) {
    const tag = weakest.skill_tag as string;
    const matchingLesson = lessons.find(
      (lesson) => !completed.has(lesson.id) && lesson.content.skill_tags.includes(tag)
    );
    if (matchingLesson) {
      return lessonRecommendation(matchingLesson, `Build your ${tag.replaceAll("_", " ")}`, tag);
    }
    const difficulty = recommendationDifficulty(
      weakest.correct_attempts as number,
      weakest.total_attempts as number
    );
    const scenario = scenarios.find(
      (row) => row.skillTag === tag && row.difficulty === difficulty
    );
    if (scenario) {
      return {
        type: "scenario",
        lesson_id: null,
        module_id: scenario.moduleId,
        lesson: null,
        scenario_id: scenario.id,
        reason: `Practice your ${tag.replaceAll("_", " ")}`,
        skill_tag: tag,
        difficulty,
      };
    }
  }
  const nextLesson = lessons.find((lesson) => !completed.has(lesson.id));
  if (nextLesson) {
    return lessonRecommendation(nextLesson, "Continue the learning path", weakest?.skill_tag ?? null);
  }
  const scenario = scenarios.find((row) => row.difficulty === 2) ?? scenarios[0];
  if (!scenario) return none;
  return {
    type: "scenario",
    lesson_id: null,
    module_id: scenario.moduleId,
    lesson: null,
    scenario_id: scenario.id,
    reason: "Keep sharpening your decisions",
    skill_tag: scenario.skillTag,
    difficulty: scenario.difficulty,
  };
}
