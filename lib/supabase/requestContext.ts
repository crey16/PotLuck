import { cache } from "react";
import { createClient } from "./server";
import { supabaseConfigured } from "./env";
import { getAuthUserId } from "./server";

/**
 * The signed-in reader's data, fetched once per request — M8.8B.
 *
 * ## The distinction this module is built on
 *
 * **Request deduplication is not caching.** React's `cache()` memoizes a
 * function for the lifetime of ONE server render and then throws the whole
 * scope away. Two concurrent requests — from two different people, on the same
 * serverless instance, in the same millisecond — get two independent scopes and
 * therefore two independent reads. Nothing here survives a response.
 *
 * That is the only mechanism personalized data is allowed to use.
 * `unstable_cache`, `revalidate`, `fetch` caching and module-level state are
 * all cross-request, and a profile row placed in any of them is one person's
 * XP shown to another. `requestContext.test.ts` reads this module's own source
 * and fails if one appears — the same technique
 * `lib/content/publicContent.test.ts` uses from the opposite side, where the
 * rule is that content must have NO user in scope.
 *
 * ## Why per-table readers rather than one "load the user" call
 *
 * A single query returning everything about a person would make `/reference`
 * pay for drill aggregates it never renders. Each reader below is separate and
 * lazy: a route that does not call one does not run it. The goal is the
 * **minimum necessary queries**, not the smallest number — which is also why
 * `placement_assessments` is deliberately NOT shared (see the note in
 * `lib/drill/serverStats.ts`): its two readers want genuinely different rows,
 * and collapsing them would trade a correct answer for a smaller count.
 *
 * ## Why sharing does not serialize anything
 *
 * `cache()` returns the same promise to every caller, so the first call starts
 * the read and later callers await the work already in flight. Two sections
 * that used to issue the same query in parallel now issue one and both wait on
 * it — strictly fewer round trips, never a new dependency edge. This matters
 * on `/`, where the dashboard's read and the streamed recommendation both want
 * `skill_stats`: they still run concurrently, they just stop asking twice.
 *
 * ## Shape
 *
 * Every reader returns `{ data, error }` rather than throwing. Callers had
 * four different fail-soft behaviours before this refactor — an error string,
 * `null`, an empty recommendation, an absent header — and each of them is
 * still the caller's decision to make.
 */

/** Columns every consumer of the profile row needs, unioned. */
export interface SessionProfile {
  id: string;
  username: string;
  display_name: string | null;
  xp: number;
  level: number;
  streak_count: number;
  created_at: string | null;
}

export interface ProgressRow {
  lesson_id: number | null;
  status: string | null;
  completed_at: string | null;
  attempts_count: number | null;
  best_score: number | null;
}

export interface SkillStatRow {
  skill_tag: string;
  total_attempts: number;
  correct_attempts: number;
}

export interface ReadResult<T> {
  data: T | null;
  error: unknown;
}

/**
 * One Supabase client per request.
 *
 * `createClient()` reads `cookies()` and builds a cookie jar bound to this
 * request, so an instance is meaningless outside it and sharing one across
 * requests would be the session bug this project's middleware note warns
 * about. Within a request, one instance is what `@supabase/ssr` expects
 * anyway — the previous code constructed eight of them on `/`.
 */
export const getRequestClient = cache(async () => createClient());

/**
 * The signed-in reader's profile row, or null.
 *
 * **This is the query M8.8A measured as the floor under every route** — 78ms
 * p50 / 139ms p95 across all 300 baseline requests, because the root layout
 * ran it on `/reference` and `/system` too. It is now read once per request
 * instead of twice on `/`, and the layout no longer blocks the shell on it.
 *
 * Returns null rather than throwing when there is no session or Supabase is
 * unconfigured: the header renders signed-out, which is correct.
 */
export const getSessionProfile = cache(
  async (): Promise<SessionProfile | null> => {
    if (!supabaseConfigured()) return null;
    const userId = await getAuthUserId();
    if (!userId) return null;
    const supabase = await getRequestClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, username, display_name, xp, level, streak_count, created_at")
      .eq("id", userId)
      .single();
    return (data as SessionProfile | null) ?? null;
  }
);

/**
 * Every `progress` row this reader owns.
 *
 * Unfiltered on purpose. Four learn readers wanted four different slices of it
 * — all rows, completed only, and one lesson — and on `/learn` two of them ran
 * in the same `Promise.all`, which was two round trips for overlapping data.
 * One row per lesson means the whole set is around two dozen rows of small
 * integers, so the slices are taken in memory and the count is one.
 */
export const getUserProgress = cache(
  async (): Promise<ReadResult<ProgressRow[]>> => {
    if (!supabaseConfigured()) return { data: null, error: "not configured" };
    const userId = await getAuthUserId();
    if (!userId) return { data: null, error: "no session" };
    const supabase = await getRequestClient();
    const { data, error } = await supabase
      .from("progress")
      .select("lesson_id, status, completed_at, attempts_count, best_score")
      .eq("user_id", userId);
    return { data: (data as ProgressRow[] | null) ?? null, error };
  }
);

/**
 * Every `skill_stats` row this reader owns — eight tags at most.
 *
 * The dashboard wanted all of them and the recommendation wanted only those
 * with five or more attempts, which is a filter, not a different query. Taken
 * in memory now, so `/` reads the table once instead of twice.
 */
export const getUserSkillStats = cache(
  async (): Promise<ReadResult<SkillStatRow[]>> => {
    if (!supabaseConfigured()) return { data: null, error: "not configured" };
    const userId = await getAuthUserId();
    if (!userId) return { data: null, error: "no session" };
    const supabase = await getRequestClient();
    const { data, error } = await supabase
      .from("skill_stats")
      .select("skill_tag, total_attempts, correct_attempts")
      .eq("user_id", userId);
    return { data: (data as SkillStatRow[] | null) ?? null, error };
  }
);

/** Completed lesson ids, the slice three callers wanted. */
export function completedLessonIds(rows: ProgressRow[] | null): Set<number> {
  const out = new Set<number>();
  for (const row of rows ?? []) {
    if (row.status === "completed" && typeof row.lesson_id === "number") {
      out.add(row.lesson_id);
    }
  }
  return out;
}

/** The row for one lesson, or null — replaces a `.eq(...).maybeSingle()`. */
export function progressForLesson(
  rows: ProgressRow[] | null,
  lessonId: number
): ProgressRow | null {
  return (rows ?? []).find((row) => row.lesson_id === lessonId) ?? null;
}
