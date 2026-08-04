import { createClient, getAuthUserId } from "../supabase/server";
import { supabaseConfigured } from "../supabase/env";
import { MAX_ENTRY_MODULE_INDEX } from "./blueprint";
import type { PlacementStatus } from "./types";

/**
 * Everything the app needs to decide how to treat a player who may still be
 * new. One fetch answers all of it, because `/` and `/drill` both need the
 * whole picture and none of it is worth a second round trip.
 */
export interface NewPlayerRouting {
  /**
   * True only for a brand-new account: no assessment has ever been started and
   * nothing has ever been answered. An established player who has simply never
   * seen placement is never interrupted by it — they can take it from `/learn`
   * whenever they want.
   */
  needsPlacement: boolean;
  /** The 0-based module index a completed placement put the player at. */
  entryModuleIndex: number;
  /**
   * The most recent assessment's status, or null if there has never been one.
   *
   * Load-bearing for `in_progress`. `PlacementPlayer` writes its row on mount,
   * so a player who answers two questions and navigates away has a row —
   * `needsPlacement` goes false and nothing would ever route them back. The
   * nudge banner reads this and offers "Finish your placement" instead, which
   * is their only way in.
   */
  status: PlacementStatus | null;
  /**
   * Whether the player has any lesson behind them. Drives the "start with the
   * lessons" nudge.
   *
   * `placed_out` counts as started: a player placement put past module 1
   * demonstrated that material and is not cold. A player placed at module 0
   * has no `placed_out` rows and does still see the nudge, which is right.
   */
  hasStartedLearning: boolean;
}

/**
 * The safe default, returned from EVERY error path.
 *
 * Deliberately the "established player" answer: a transient Supabase failure
 * must never trap someone in onboarding, and must never redirect a real player
 * into an assessment they already took. The cost is that a genuinely new
 * player hits the dashboard un-placed — which the nudge banner then recovers,
 * and which is why that banner is load-bearing rather than decorative.
 */
const NONE: NewPlayerRouting = {
  needsPlacement: false,
  entryModuleIndex: 0,
  status: null,
  hasStartedLearning: true,
};

const PLACEMENT_STATUSES = new Set<PlacementStatus>([
  "in_progress",
  "completed",
  "skipped",
]);

/** Lesson progress states that mean "this player has begun the course". */
export const STARTED_LEARNING_STATUSES = ["completed", "placed_out"] as const;

/**
 * Read new-player routing state directly from Supabase under the caller's RLS
 * (M8.5B, widened by the M8.5A revert).
 *
 * Follows the M7 hybrid rule: writes go through FastAPI, RLS-secured reads go
 * direct. This sits on the landing route's critical path, so a failure must
 * never block the page — see `NONE` above.
 *
 * Three indexed single-row probes in one round trip. None of them fetches a
 * payload; they exist only to answer yes/no questions.
 */
export async function fetchNewPlayerRouting(): Promise<NewPlayerRouting> {
  if (!supabaseConfigured()) return NONE;
  const userId = await getAuthUserId();
  if (!userId) return NONE;

  const supabase = await createClient();
  const [assessmentResult, attemptResult, progressResult] = await Promise.all([
    supabase
      .from("placement_assessments")
      .select("id, status, entry_module_index")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("attempts").select("id").eq("user_id", userId).limit(1),
    supabase
      .from("progress")
      .select("lesson_id")
      .eq("user_id", userId)
      .in("status", STARTED_LEARNING_STATUSES)
      .limit(1),
  ]);

  if (assessmentResult.error || attemptResult.error || progressResult.error) {
    return NONE;
  }

  const latest = assessmentResult.data;
  const hasHistory = (attemptResult.data ?? []).length > 0;
  const hasStartedLearning = (progressResult.data ?? []).length > 0;

  if (!latest) {
    return {
      needsPlacement: !hasHistory,
      entryModuleIndex: 0,
      status: null,
      hasStartedLearning,
    };
  }

  const status = PLACEMENT_STATUSES.has(latest.status as PlacementStatus)
    ? (latest.status as PlacementStatus)
    : null;
  const raw = status === "completed" ? latest.entry_module_index : 0;
  const index = typeof raw === "number" ? raw : 0;

  return {
    needsPlacement: false,
    // Clamped rather than trusted: a row written by an older assessment
    // version could name a module index this build never places anyone at.
    entryModuleIndex: Math.min(Math.max(0, index), MAX_ENTRY_MODULE_INDEX),
    status,
    hasStartedLearning,
  };
}
