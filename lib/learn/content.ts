import type {
  Lesson,
  LessonChoice,
  LessonContent,
  LessonScreen,
  LessonScreenType,
  LessonType,
} from "./types";

const LESSON_TYPES = new Set<LessonType>(["concept", "quiz", "drill", "micro_hand"]);
const SCREEN_TYPES = new Set<LessonScreenType>(["info", "question", "drill", "recap"]);

function choices(value: unknown): LessonChoice[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value.flatMap((choice) => {
    if (!choice || typeof choice !== "object") return [];
    const row = choice as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.label !== "string") return [];
    return [{ id: row.id, label: row.label }];
  });
  return parsed.length > 0 ? parsed : undefined;
}

export function parseLessonContent(value: unknown): LessonContent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.screens) || raw.screens.length === 0) return null;
  const screens: LessonScreen[] = [];
  for (const entry of raw.screens) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.type !== "string" ||
      !SCREEN_TYPES.has(row.type as LessonScreenType) ||
      typeof row.content !== "string"
    ) {
      return null;
    }
    const screen: LessonScreen = {
      type: row.type as LessonScreenType,
      content: row.content,
    };
    if (screen.type === "question" || screen.type === "drill") {
      const parsedChoices = choices(row.choices);
      if (!parsedChoices || typeof row.correct_choice_id !== "string") return null;
      if (!parsedChoices.some((choice) => choice.id === row.correct_choice_id)) return null;
      screen.choices = parsedChoices;
      screen.correct_choice_id = row.correct_choice_id;
    }
    screens.push(screen);
  }
  const skillTags = Array.isArray(raw.skill_tags)
    ? raw.skill_tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  const xpReward =
    typeof raw.xp_reward === "number" && Number.isInteger(raw.xp_reward)
      ? raw.xp_reward
      : 10;
  return { screens, skill_tags: skillTags, xp_reward: xpReward };
}

export function lessonFromRow(row: Record<string, unknown>): Lesson | null {
  const content = parseLessonContent(row.content_json);
  if (
    !content ||
    typeof row.id !== "number" ||
    typeof row.module_id !== "number" ||
    typeof row.lesson_type !== "string" ||
    !LESSON_TYPES.has(row.lesson_type as LessonType) ||
    typeof row.title !== "string" ||
    typeof row.order_index !== "number"
  ) {
    return null;
  }
  return {
    id: row.id,
    moduleId: row.module_id,
    type: row.lesson_type as LessonType,
    title: row.title,
    order: row.order_index,
    content,
    estimatedSeconds:
      typeof row.estimated_time_seconds === "number" ? row.estimated_time_seconds : null,
    difficulty: typeof row.difficulty === "number" ? row.difficulty : null,
    version: typeof row.version === "number" ? row.version : 1,
  };
}

export function formatLessonTime(seconds: number | null): string {
  if (!seconds || seconds < 60) return "< 1 min";
  return `${Math.round(seconds / 60)} min`;
}

export function lessonTypeLabel(type: LessonType): string {
  if (type === "micro_hand") return "Micro hand";
  return type.slice(0, 1).toUpperCase() + type.slice(1);
}

export function recommendationDifficulty(correct: number, total: number): number {
  if (total <= 0) return 1;
  const accuracy = correct / total;
  if (accuracy < 0.4) return 1;
  if (accuracy < 0.75) return 2;
  return 3;
}
