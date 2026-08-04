import { createClient, getAuthUserId } from "../supabase/server";
import { supabaseConfigured } from "../supabase/env";
import { MAX_ENTRY_MODULE_INDEX } from "./blueprint";

export interface PlacementRouting {
  /**
   * True only for a brand-new account: no assessment has ever been started and
   * nothing has ever been answered. An established player who has simply never
   * seen placement is never interrupted by it — they can take it from `/learn`
   * whenever they want.
   */
  needsPlacement: boolean;
  /** The 0-based module index a completed placement put the player at. */
  entryModuleIndex: number;
}

const NONE: PlacementRouting = { needsPlacement: false, entryModuleIndex: 0 };

/**
 * Read placement state directly from Supabase under the caller's RLS (M8.5B).
 *
 * Follows the M7 hybrid rule: writes go through FastAPI, RLS-secured reads go
 * direct. This one is a read on the landing route's critical path, so a
 * failure must never block the page — every error path returns "no placement",
 * which is exactly today's behaviour.
 */
export async function fetchPlacementRouting(): Promise<PlacementRouting> {
  if (!supabaseConfigured()) return NONE;
  const userId = await getAuthUserId();
  if (!userId) return NONE;

  const supabase = await createClient();
  const [assessmentResult, attemptResult] = await Promise.all([
    supabase
      .from("placement_assessments")
      .select("id, status, entry_module_index")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("attempts").select("id").eq("user_id", userId).limit(1),
  ]);

  if (assessmentResult.error || attemptResult.error) return NONE;

  const latest = assessmentResult.data;
  const hasHistory = (attemptResult.data ?? []).length > 0;

  if (!latest) return { needsPlacement: !hasHistory, entryModuleIndex: 0 };

  const raw = latest.status === "completed" ? latest.entry_module_index : 0;
  const index = typeof raw === "number" ? raw : 0;
  return {
    needsPlacement: false,
    // Clamped rather than trusted: a row written by an older assessment
    // version could name a module index this build never places anyone at.
    entryModuleIndex: Math.min(Math.max(0, index), MAX_ENTRY_MODULE_INDEX),
  };
}
