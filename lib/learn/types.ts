export type LessonType = "concept" | "quiz" | "drill" | "micro_hand";
export type LessonScreenType = "info" | "question" | "drill" | "recap";

export interface LessonChoice {
  id: string;
  label: string;
}

export interface LessonScreen {
  type: LessonScreenType;
  content: string;
  choices?: LessonChoice[];
  correct_choice_id?: string;
}

export interface LessonContent {
  screens: LessonScreen[];
  skill_tags: string[];
  xp_reward: number;
}

export interface Lesson {
  id: number;
  moduleId: number;
  type: LessonType;
  title: string;
  order: number;
  content: LessonContent;
  estimatedSeconds: number | null;
  difficulty: number | null;
  version: number;
}

export interface LearningModule {
  id: number;
  title: string;
  description: string;
  order: number;
}

export interface LessonProgress {
  lessonId: number;
  status: string;
  completedAt: string | null;
  attemptsCount: number;
  bestScore: number;
}

export interface ModuleWithProgress extends LearningModule {
  lessons: Lesson[];
  completedCount: number;
  nextLessonId: number | null;
}

export interface LearningPathData {
  modules: ModuleWithProgress[];
  completedLessonIds: Set<number>;
  error: string | null;
}

export interface Recommendation {
  type: "lesson" | "scenario" | "none";
  lesson_id: number | null;
  module_id: number | null;
  lesson: {
    id: number;
    module_id: number;
    title: string;
    lesson_type: LessonType;
    estimated_time_seconds: number | null;
    difficulty: number | null;
  } | null;
  scenario_id: number | null;
  reason: string;
  skill_tag: string | null;
  difficulty: number | null;
}

export interface LessonAttemptResult {
  id: number;
  lesson_id: number;
  screen_index: number;
  selected_choice_id: string;
  is_correct: boolean;
  skill_tags: string[];
  created_at: string;
}

export interface LessonCompleteResult {
  lesson_id: number;
  lesson_title: string;
  xp_earned: number;
  total_xp: number;
  level: number;
  streak_count: number;
  already_completed: boolean;
  score: number;
}

export interface ScenarioChoice {
  id: string;
  label: string;
}

export interface AuthoredScenario {
  id: number;
  module_id: number;
  skill_tag: string;
  difficulty: number;
  scenario_json: {
    prompt: string;
    game_state: Record<string, unknown>;
    hero_cards: string[];
    board: string[];
    street?: string | null;
    villain_archetype?: string | null;
    choices: ScenarioChoice[];
    evaluation: {
      correct_choice_id: string;
      acceptable_choice_ids: string[];
    };
    explanation: string;
    rule_of_thumb: string;
  };
}

export interface ScenarioSubmitResult {
  is_correct: boolean;
  is_acceptable: boolean;
  xp_awarded: number;
  correct_choice_id: string;
  explanation: string;
  rule_of_thumb: string;
  total_xp: number;
  level: number;
  streak_count: number;
}

export interface TableScenarioAction {
  seat: number;
  action: string;
  amount_bb?: number;
}

export interface TableScenarioPlayer {
  seat: number;
  position: string;
  label?: string;
  style?: string;
  cards?: string[];
}

export interface TableScenarioChoice extends ScenarioChoice {
  action?: string;
  amount_bb?: number;
}

export interface TableScenario {
  id: number;
  module_id: number;
  difficulty: number;
  skill_tag: string;
  street: string;
  prompt_title: string;
  situation: {
    blinds?: { sb?: number; bb?: number };
    effective_stack_bb?: number;
    hero: TableScenarioPlayer & { cards: string[] };
    villains: TableScenarioPlayer[];
    pre_action: TableScenarioAction[];
    pot_bb?: number;
    board: string[];
  };
  choices: TableScenarioChoice[];
  created_at?: string;
}

export interface DailyContent {
  date: string;
  content_type: "lesson" | "scenario";
  lesson: {
    id: number;
    module_id: number;
    lesson_type: LessonType;
    title: string;
    estimated_time_seconds: number | null;
    difficulty: number | null;
  } | null;
  scenario: AuthoredScenario | null;
  title: string;
  estimated_time_seconds: number;
  is_completed: boolean;
  xp_reward: number;
}

export interface DailyCompleteResult {
  xp_awarded: number;
  already_completed: boolean;
  total_xp: number;
  level: number;
  streak_count: number;
}
