import { createClient, getAuthUserId } from "../supabase/server";
import { supabaseConfigured } from "../supabase/env";
import { lessonFromRow, recommendationDifficulty } from "./content";
import type {
  LearningModule,
  LearningPathData,
  Lesson,
  LessonProgress,
  ModuleWithProgress,
  Recommendation,
} from "./types";

const EMPTY: LearningPathData = {
  modules: [],
  completedLessonIds: new Set<number>(),
  error: null,
};

function moduleFromRow(row: Record<string, unknown>): LearningModule | null {
  if (
    typeof row.id !== "number" ||
    typeof row.title !== "string" ||
    typeof row.description !== "string" ||
    typeof row.order_index !== "number"
  ) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    order: row.order_index,
  };
}

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
  const supabase = await createClient();
  const [modulesResult, lessonsResult, progressResult] = await Promise.all([
    supabase
      .from("modules")
      .select("id, title, description, order_index")
      .eq("is_active", true)
      .order("order_index"),
    supabase
      .from("lessons")
      .select(
        "id, module_id, lesson_type, title, order_index, content_json, estimated_time_seconds, difficulty, version"
      )
      .eq("is_active", true)
      .order("module_id")
      .order("order_index"),
    supabase
      .from("progress")
      .select("lesson_id, status, completed_at, attempts_count, best_score")
      .eq("user_id", userId),
  ]);
  const error = modulesResult.error ?? lessonsResult.error ?? progressResult.error;
  if (error) return { ...EMPTY, error: "The learning path could not be loaded." };

  const modules = (modulesResult.data ?? []).flatMap((row) => {
    const parsed = moduleFromRow(row);
    return parsed ? [parsed] : [];
  });
  const lessons = (lessonsResult.data ?? []).flatMap((row) => {
    const parsed = lessonFromRow(row);
    return parsed ? [parsed] : [];
  });
  const progress = (progressResult.data ?? []).flatMap((row) => {
    const parsed = progressFromRow(row);
    return parsed ? [parsed] : [];
  });
  const completedLessonIds = new Set(
    progress.filter((row) => row.status === "completed").map((row) => row.lessonId)
  );
  const withProgress: ModuleWithProgress[] = modules.map((module) => {
    const moduleLessons = lessons.filter((lesson) => lesson.moduleId === module.id);
    const completedCount = moduleLessons.filter((lesson) => completedLessonIds.has(lesson.id)).length;
    return {
      ...module,
      lessons: moduleLessons,
      completedCount,
      nextLessonId:
        moduleLessons.find((lesson) => !completedLessonIds.has(lesson.id))?.id ??
        moduleLessons[0]?.id ??
        null,
    };
  });
  return { modules: withProgress, completedLessonIds, error: null };
}

export async function fetchModule(
  moduleId: number
): Promise<{ module: LearningModule; lessons: Lesson[]; completedLessonIds: Set<number> } | null> {
  if (!supabaseConfigured()) return null;
  const userId = await getAuthUserId();
  if (!userId) return null;
  const supabase = await createClient();
  const [moduleResult, lessonsResult, progressResult] = await Promise.all([
    supabase
      .from("modules")
      .select("id, title, description, order_index")
      .eq("id", moduleId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("lessons")
      .select(
        "id, module_id, lesson_type, title, order_index, content_json, estimated_time_seconds, difficulty, version"
      )
      .eq("module_id", moduleId)
      .eq("is_active", true)
      .order("order_index"),
    supabase
      .from("progress")
      .select("lesson_id, status")
      .eq("user_id", userId)
      .eq("status", "completed"),
  ]);
  const learningModule = moduleResult.data ? moduleFromRow(moduleResult.data) : null;
  if (!learningModule || moduleResult.error || lessonsResult.error || progressResult.error) return null;
  const lessons = (lessonsResult.data ?? []).flatMap((row) => {
    const parsed = lessonFromRow(row);
    return parsed ? [parsed] : [];
  });
  const completedLessonIds = new Set(
    (progressResult.data ?? [])
      .map((row) => row.lesson_id)
      .filter((id): id is number => typeof id === "number")
  );
  return { module: learningModule, lessons, completedLessonIds };
}

export async function fetchLesson(
  moduleId: number,
  lessonId: number
): Promise<{ module: LearningModule; lesson: Lesson; completed: boolean } | null> {
  if (!supabaseConfigured()) return null;
  const userId = await getAuthUserId();
  if (!userId) return null;
  const supabase = await createClient();
  const [moduleResult, lessonResult, progressResult] = await Promise.all([
    supabase
      .from("modules")
      .select("id, title, description, order_index")
      .eq("id", moduleId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("lessons")
      .select(
        "id, module_id, lesson_type, title, order_index, content_json, estimated_time_seconds, difficulty, version"
      )
      .eq("id", lessonId)
      .eq("module_id", moduleId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("progress")
      .select("status")
      .eq("user_id", userId)
      .eq("lesson_id", lessonId)
      .maybeSingle(),
  ]);
  const learningModule = moduleResult.data ? moduleFromRow(moduleResult.data) : null;
  const lesson = lessonResult.data ? lessonFromRow(lessonResult.data) : null;
  if (!learningModule || !lesson || moduleResult.error || lessonResult.error) return null;
  return { module: learningModule, lesson, completed: progressResult.data?.status === "completed" };
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
  const supabase = await createClient();
  const [modulesResult, lessonsResult, progressResult, skillsResult, scenariosResult] =
    await Promise.all([
      supabase.from("modules").select("id, order_index").eq("is_active", true),
      supabase
        .from("lessons")
        .select(
          "id, module_id, lesson_type, title, order_index, content_json, estimated_time_seconds, difficulty, version"
        )
        .eq("is_active", true),
      supabase
        .from("progress")
        .select("lesson_id, status")
        .eq("user_id", userId)
        .eq("status", "completed"),
      supabase
        .from("skill_stats")
        .select("skill_tag, total_attempts, correct_attempts")
        .eq("user_id", userId)
        .gte("total_attempts", 5),
      supabase
        .from("scenarios")
        .select("id, module_id, skill_tag, difficulty")
        .eq("is_active", true)
        .order("id"),
    ]);
  if (
    modulesResult.error ||
    lessonsResult.error ||
    progressResult.error ||
    skillsResult.error ||
    scenariosResult.error
  ) {
    return none;
  }
  const moduleOrder = new Map<number, number>(
    (modulesResult.data ?? []).map((row) => [row.id as number, row.order_index as number])
  );
  const lessons = (lessonsResult.data ?? [])
    .flatMap((row) => {
      const lesson = lessonFromRow(row);
      return lesson ? [lesson] : [];
    })
    .sort(
      (a, b) =>
        (moduleOrder.get(a.moduleId) ?? a.moduleId) - (moduleOrder.get(b.moduleId) ?? b.moduleId) ||
        a.order - b.order ||
        a.id - b.id
    );
  const completed = new Set(
    (progressResult.data ?? [])
      .map((row) => row.lesson_id)
      .filter((id): id is number => typeof id === "number")
  );
  const weakest = [...(skillsResult.data ?? [])].sort((a, b) => {
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
    const scenario = (scenariosResult.data ?? []).find(
      (row) => row.skill_tag === tag && row.difficulty === difficulty
    );
    if (scenario) {
      return {
        type: "scenario",
        lesson_id: null,
        module_id: scenario.module_id as number,
        lesson: null,
        scenario_id: scenario.id as number,
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
  const scenario = (scenariosResult.data ?? []).find((row) => row.difficulty === 2) ?? scenariosResult.data?.[0];
  if (!scenario) return none;
  return {
    type: "scenario",
    lesson_id: null,
    module_id: scenario.module_id as number,
    lesson: null,
    scenario_id: scenario.id as number,
    reason: "Keep sharpening your decisions",
    skill_tag: scenario.skill_tag as string,
    difficulty: scenario.difficulty as number,
  };
}
