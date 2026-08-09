"use client";

import { loadSupabaseClient } from "../supabase/lazyClient";
import { traceHeaders } from "../observability/clientTrace";
import { supabaseConfigured } from "../supabase/env";
import type {
  AuthoredScenario,
  DailyCompleteResult,
  DailyContent,
  LessonAttemptResult,
  LessonCompleteResult,
  Recommendation,
  ScenarioSubmitResult,
  TableScenario,
} from "./types";

export class LearningApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "LearningApiError";
  }
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!supabaseConfigured()) throw new LearningApiError("Supabase is not configured.");
  // The SDK chunk is fetched on first authenticated call, not at import
  // time (M8.8C). This function was already async and is only ever reached
  // from an effect or an event handler, so nothing above it changes shape —
  // but a static import here put 64 kB gzipped in front of hydration on
  // every route that renders a client component from this feature.
  const supabase = await loadSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new LearningApiError("Your session expired. Sign in again.", 401);
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      // Joins this call to the page load that issued it (M8.8A). One header,
      // no request of its own — the id is already in memory.
      ...traceHeaders(),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // The status is still useful when the response is not JSON.
    }
    throw new LearningApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

export function lessonAttemptBody(
  lessonId: number,
  screenIndex: number,
  selectedChoiceId: string
) {
  return {
    lesson_id: lessonId,
    screen_index: screenIndex,
    selected_choice_id: selectedChoiceId,
  };
}

export function lessonCompleteBody(lessonId: number) {
  return { lesson_id: lessonId };
}

export function recordLessonAttempt(
  lessonId: number,
  screenIndex: number,
  selectedChoiceId: string
): Promise<LessonAttemptResult> {
  return authRequest("/api/progress/attempts", {
    method: "POST",
    body: JSON.stringify(lessonAttemptBody(lessonId, screenIndex, selectedChoiceId)),
  });
}

export function completeLesson(lessonId: number): Promise<LessonCompleteResult> {
  return authRequest("/api/progress/lesson-complete", {
    method: "POST",
    body: JSON.stringify(lessonCompleteBody(lessonId)),
  });
}

export function getNextRecommendation(): Promise<Recommendation> {
  return authRequest("/api/recommendations/next");
}

export function getScenario(options: {
  id?: number;
  moduleId?: number;
  difficulty?: number;
  skillTag?: string;
  } = {}): Promise<AuthoredScenario> {
  const params = new URLSearchParams();
  if (options.id) params.set("scenario_id", String(options.id));
  if (options.moduleId) params.set("module_id", String(options.moduleId));
  if (options.difficulty) params.set("difficulty", String(options.difficulty));
  if (options.skillTag) params.set("skill_tag", options.skillTag);
  const suffix = params.size ? `?${params.toString()}` : "";
  return authRequest(`/api/scenarios/random${suffix}`);
}

export function submitScenario(
  scenarioId: number,
  selectedChoiceId: string
): Promise<ScenarioSubmitResult> {
  return authRequest("/api/scenarios/submit", {
    method: "POST",
    body: JSON.stringify({
      scenario_id: scenarioId,
      selected_choice_id: selectedChoiceId,
    }),
  });
}

export function getTableScenario(options: {
  moduleId?: number;
  difficulty?: number;
  skillTag?: string;
} = {}): Promise<TableScenario> {
  const params = new URLSearchParams();
  if (options.moduleId) params.set("module_id", String(options.moduleId));
  if (options.difficulty) params.set("difficulty", String(options.difficulty));
  if (options.skillTag) params.set("skill_tag", options.skillTag);
  const suffix = params.size ? `?${params.toString()}` : "";
  return authRequest(`/api/table-scenarios/random${suffix}`);
}

export function submitTableScenario(
  scenarioId: number,
  selectedChoiceId: string
): Promise<ScenarioSubmitResult> {
  return authRequest("/api/table-scenarios/submit", {
    method: "POST",
    body: JSON.stringify({
      scenario_id: scenarioId,
      selected_choice_id: selectedChoiceId,
    }),
  });
}

export function getDaily(): Promise<DailyContent> {
  return authRequest("/api/daily");
}

export function completeDaily(): Promise<DailyCompleteResult> {
  return authRequest("/api/daily/complete", { method: "POST" });
}
