import type { PublicContent } from "../content/publicContent";
import type { LearningPathData, LessonProgress, ModuleWithProgress } from "./types";

/**
 * Where shared content meets one reader's progress — M8.8C.
 *
 * This is the join that used to happen inline in `lib/learn/server.ts`, pulled
 * out because it is the exact place a caching mistake would become a privacy
 * bug. The content half arrives from a cache shared by every account; the
 * progress half is read fresh, per request, under RLS. If those two were ever
 * mixed in the wrong direction — a completion flag written back onto the
 * shared object, a module array reused and mutated — one player would see
 * another's progress, and it would look like a rendering quirk rather than a
 * leak.
 *
 * So this function is pure and takes both halves explicitly. It has no
 * database, no cookies and no user id beyond the rows handed to it, which is
 * what makes `compose.test.ts` able to run the same content object through two
 * different readers and assert they cannot influence each other.
 *
 * **It must never mutate `content`.** Every derived value is a fresh object;
 * `content.modules` and `content.lessons` are only read from. The test asserts
 * this by deep-freezing the input.
 */
export function composeLearningPath(
  content: PublicContent,
  progress: LessonProgress[]
): LearningPathData {
  // `placed_out` counts as satisfied (M8.5B): the placement assessment showed
  // the player already knows this material, so the path must not route them
  // back into it. It is a separate status rather than `completed` because they
  // did not take the lesson — `fetchLesson` still reports it as uncompleted,
  // so the lesson itself opens fresh if they choose to.
  const completedLessonIds = new Set(
    progress
      .filter((row) => row.status === "completed" || row.status === "placed_out")
      .map((row) => row.lessonId)
  );
  const modules: ModuleWithProgress[] = content.modules.map((module) => {
    const moduleLessons = content.lessons.filter((lesson) => lesson.moduleId === module.id);
    return {
      ...module,
      lessons: moduleLessons,
      completedCount: moduleLessons.filter((lesson) => completedLessonIds.has(lesson.id)).length,
      nextLessonId:
        moduleLessons.find((lesson) => !completedLessonIds.has(lesson.id))?.id ??
        moduleLessons[0]?.id ??
        null,
    };
  });
  return { modules, completedLessonIds, error: null };
}
