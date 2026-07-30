import type { DrillKind, OptionValue } from "@/lib/drill/contract";
import { createClient } from "@/lib/supabase/client";
import { supabaseConfigured } from "@/lib/supabase/env";

/** One answered question, from DrillShell. */
export interface DrillResult {
  kind: DrillKind;
  payload: Record<string, unknown>;
  answer: OptionValue;
  correct: boolean;
}

/** Body shape expected by `AttemptIn` in api/index.py. Names must match exactly. */
export interface AttemptRequestBody {
  drill_kind: DrillKind;
  drill_payload: Record<string, unknown>;
  answer: string;
  is_correct: boolean;
}

export interface AttemptRequest {
  path: string;
  body: AttemptRequestBody;
}

/** Response shape returned by POST /api/progress/attempts (api/index.py). */
export interface ProfileUpdate {
  id: string;
  username: string;
  display_name: string | null;
  xp: number;
  level: number;
  streak_count: number;
  last_active_date: string | null;
  xp_earned: number;
}

/**
 * Pure request-shaping, no I/O — the testable unit. Keep this in sync with
 * `AttemptIn` in api/index.py: field names, and `answer` stringified.
 */
export function buildAttemptRequest(result: DrillResult): AttemptRequest {
  return {
    path: "/api/progress/attempts",
    body: {
      drill_kind: result.kind,
      drill_payload: result.payload,
      answer: String(result.answer),
      is_correct: result.correct,
    },
  };
}

/**
 * Posts a drill result to the FastAPI attempts endpoint so XP/level/streak
 * persist. Never throws into the drill loop:
 *  - Supabase unconfigured (no .env.local yet) → null, no network call.
 *  - No signed-in session → null (drill still works signed-out in dev).
 *  - Non-OK response / network failure → null, with a console.warn.
 */
export async function recordAttempt(result: DrillResult): Promise<ProfileUpdate | null> {
  if (!supabaseConfigured()) return null;

  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return null;

    const { path, body } = buildAttemptRequest(result);
    const res = await fetch(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn(`recordAttempt: ${path} responded ${res.status}`);
      return null;
    }

    return (await res.json()) as ProfileUpdate;
  } catch (err) {
    console.warn("recordAttempt: failed", err);
    return null;
  }
}
