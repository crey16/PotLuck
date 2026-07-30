import { createClient } from "../supabase/client";
import { supabaseConfigured } from "../supabase/env";
import { DRILL_KINDS, type DrillKind } from "./contract";
import { emptyWindows, WINDOW_SIZE, type DrillWindows } from "./difficulty";

const KINDS = new Set<string>(DRILL_KINDS);

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

/**
 * Seed the difficulty windows from history. Returns null (and the caller keeps
 * empty windows) whenever Supabase is unconfigured, there is no session, or
 * the request fails — difficulty seeding is never on the critical path.
 */
export async function fetchDrillState(): Promise<DrillWindows | null> {
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
    return windowsFromResponse(await res.json());
  } catch (err) {
    console.warn("fetchDrillState: failed", err);
    return null;
  }
}
