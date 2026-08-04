import { createClient } from "../supabase/client";
import { supabaseConfigured } from "../supabase/env";
import { DRILL_KINDS, type DrillKind, type DrillLevel } from "./contract";
import { emptyWindows, WINDOW_SIZE, type DrillWindows, type Levels } from "./difficulty";

const KINDS = new Set<string>(DRILL_KINDS);

/** Everything `/api/progress/drill-state` restores on first paint. */
export interface DrillState {
  windows: DrillWindows;
  /**
   * Per-kind starting difficulty from the M8.5B placement assessment, used as
   * a FLOOR under the history-derived level. Empty when the player skipped
   * placement, never took it, or took it under an older version.
   */
  placementLevels: Levels;
}

/**
 * Defensive parse: any shape that is not what we expect yields empty windows,
 * which simply starts every drill at level 1. Never throws.
 */
export function windowsFromResponse(json: unknown): DrillWindows {
  const out = emptyWindows();
  const raw = (json as { windows?: unknown })?.windows;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KINDS.has(kind) || !Array.isArray(value)) continue;
    out[kind as DrillKind] = value.map(Boolean).slice(-WINDOW_SIZE);
  }
  return out;
}

/** Same defensive contract: an unrecognised shape places nobody. */
export function placementLevelsFromResponse(json: unknown): Levels {
  const out: Levels = {};
  const raw = (json as { placement_levels?: unknown })?.placement_levels;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KINDS.has(kind)) continue;
    if (value === 1 || value === 2 || value === 3) {
      out[kind as DrillKind] = value as DrillLevel;
    }
  }
  return out;
}

export function drillStateFromResponse(json: unknown): DrillState {
  return {
    windows: windowsFromResponse(json),
    placementLevels: placementLevelsFromResponse(json),
  };
}

/**
 * Seed the difficulty windows from history. Returns null (and the caller keeps
 * empty windows) whenever Supabase is unconfigured, there is no session, or
 * the request fails — difficulty seeding is never on the critical path.
 */
export async function fetchDrillState(): Promise<DrillState | null> {
  if (!supabaseConfigured()) return null;
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const res = await fetch("/api/progress/drill-state", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      console.warn(`fetchDrillState: responded ${res.status}`);
      return null;
    }
    return drillStateFromResponse(await res.json());
  } catch (err) {
    console.warn("fetchDrillState: failed", err);
    return null;
  }
}
