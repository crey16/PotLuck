/**
 * Server-side aggregates for the home dashboard and the drill switcher.
 * Everything here is read via the user's own Supabase session (RLS scopes the
 * rows), fails soft to empty data, and is never imported from the client.
 */
import { createClient, getAuthUserId } from "../supabase/server";
import { supabaseConfigured } from "../supabase/env";
import { DRILL_KINDS, type DrillKind, type DrillLevel } from "./contract";
import { levelWithPlacementFloor, WINDOW_SIZE, type Levels } from "./difficulty";
import { placementLevelsFromResponse } from "./drillState";
import { ASSESSMENT_VERSION } from "../placement/blueprint";
import { GENERATOR_VERSION } from "./version";

/** Display names for the 8 skill tags (the server derives tags from kinds —
 *  see api/skills.py; this map only labels them for the dashboard). */
export const SKILL_TAG_LABELS: Record<string, string> = {
  counting_outs: "Counting outs",
  equity_estimation: "Equity estimation",
  discipline: "Discipline",
  pot_odds: "Pot odds",
  bluffing: "Bluffing",
  hand_selection: "Hand selection",
  expected_value: "Expected value",
  implied_odds: "Implied odds",
};

export interface SkillStat {
  tag: string;
  label: string;
  attempts: number;
  correct: number;
  /** 0–100, rounded. */
  accuracy: number;
}

export interface KindStat {
  kind: DrillKind;
  attempts: number;
  correct: number;
  /** 0–100, rounded; null when there are no attempts. */
  accuracy: number | null;
  /** Adaptive difficulty from the last WINDOW_SIZE answers in this kind. */
  level: DrillLevel;
}

export interface ActivityDay {
  /** ISO date. */
  date: string;
  xp: number;
}

export interface DashboardStats {
  profile: {
    username: string;
    displayName: string | null;
    xp: number;
    level: number;
    streak: number;
    createdAt: string | null;
  } | null;
  skills: SkillStat[];
  kinds: Record<DrillKind, KindStat>;
  /** All-time totals across every drill attempt. */
  totalAttempts: number;
  totalCorrect: number;
  /** The kind of the most recent attempt — powers "Resume <drill>". */
  lastKind: DrillKind | null;
  activity: ActivityDay[];
}

function emptyKinds(): Record<DrillKind, KindStat> {
  return Object.fromEntries(
    DRILL_KINDS.map((kind) => [
      kind,
      { kind, attempts: 0, correct: 0, accuracy: null, level: 1 as DrillLevel },
    ])
  ) as Record<DrillKind, KindStat>;
}

const EMPTY: DashboardStats = {
  profile: null,
  skills: [],
  kinds: emptyKinds(),
  totalAttempts: 0,
  totalCorrect: 0,
  lastKind: null,
  activity: [],
};

/** Kind-level aggregates from raw attempt rows (newest first). */
export function aggregateKinds(
  rows: { drill_kind: string | null; is_correct: boolean }[],
  /**
   * M8.5B placement floors. Without these the dashboard reported the
   * history-derived level while the drill itself applied the floor, so a
   * freshly-placed player saw every card at LVL 1 and then opened a drill at
   * level 2. Same rule, one implementation — see `levelWithPlacementFloor`.
   */
  placementFloors: Levels = {}
): Record<DrillKind, KindStat> {
  const kinds = emptyKinds();
  const windows: Partial<Record<DrillKind, boolean[]>> = {};
  for (const row of rows) {
    const kind = row.drill_kind as DrillKind | null;
    if (!kind || !(kind in kinds)) continue;
    const stat = kinds[kind];
    stat.attempts += 1;
    if (row.is_correct) stat.correct += 1;
    const w = (windows[kind] ??= []);
    // Rows arrive newest-first; the window wants oldest-first, so prepend.
    if (w.length < WINDOW_SIZE) w.unshift(row.is_correct);
  }
  for (const kind of DRILL_KINDS) {
    const stat = kinds[kind];
    if (stat.attempts > 0) stat.accuracy = Math.round((stat.correct / stat.attempts) * 100);
    stat.level = levelWithPlacementFloor(windows[kind] ?? [], placementFloors[kind]);
  }
  return kinds;
}


/**
 * The placement floors for the signed-in user, or `{}`.
 *
 * Mirrors the guards in `api/index.py`'s drill-state handler exactly: only a
 * COMPLETED assessment counts, and both versions must match today's. A
 * placement scored by different rules or dealt by different generators
 * measured something else, and silently reinterpreting it is the failure the
 * stored versions exist to prevent — so an outdated result stops applying
 * rather than being reinterpreted.
 *
 * Fail-soft: any error yields no floors, which is the cold-start behaviour.
 */
async function fetchPlacementFloors(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<Levels> {
  const { data } = await supabase
    .from("placement_assessments")
    .select("levels")
    .eq("user_id", userId)
    .eq("status", "completed")
    .eq("assessment_version", ASSESSMENT_VERSION)
    .eq("generator_version", GENERATOR_VERSION)
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  const levels = data?.[0]?.levels;
  // Reuses the drill client's parser so both paths validate identically.
  return placementLevelsFromResponse({ placement_levels: levels });
}

/** Just the per-kind aggregates — what the drill switcher needs. */
export async function fetchKindStats(): Promise<Record<DrillKind, KindStat>> {
  if (!supabaseConfigured()) return emptyKinds();
  const userId = await getAuthUserId();
  if (!userId) return emptyKinds();
  const supabase = await createClient();
  const { data } = await supabase
    .from("attempts")
    .select("drill_kind, is_correct")
    .eq("user_id", userId)
    .not("drill_kind", "is", null)
    .order("created_at", { ascending: false })
    .limit(5000);
  return aggregateKinds(data ?? [], await fetchPlacementFloors(supabase, userId));
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  if (!supabaseConfigured()) return EMPTY;
  const userId = await getAuthUserId();
  if (!userId) return EMPTY;
  const supabase = await createClient();

  const since = new Date();
  since.setDate(since.getDate() - 7 * 12);
  const sinceIso = since.toISOString().slice(0, 10);

  // Added to the existing parallel batch rather than awaited separately: this
  // page's query fan-out is already an M8.8B concern, and a placement floor is
  // not worth a serial round trip.
  const [profileRes, skillsRes, attemptsRes, activityRes, placementFloors] =
    await Promise.all([
    supabase
      .from("profiles")
      .select("username, display_name, xp, level, streak_count, created_at")
      .eq("id", userId)
      .single(),
    supabase
      .from("skill_stats")
      .select("skill_tag, total_attempts, correct_attempts")
      .eq("user_id", userId),
    supabase
      .from("attempts")
      .select("drill_kind, is_correct")
      .eq("user_id", userId)
      .not("drill_kind", "is", null)
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("user_daily_activity")
      .select("date, xp_earned")
      .eq("user_id", userId)
      .gte("date", sinceIso)
      .order("date", { ascending: true }),
    fetchPlacementFloors(supabase, userId),
  ]);

  const profile = profileRes.data
    ? {
        username: profileRes.data.username,
        displayName: profileRes.data.display_name ?? null,
        xp: profileRes.data.xp,
        level: profileRes.data.level,
        streak: profileRes.data.streak_count,
        createdAt: profileRes.data.created_at ?? null,
      }
    : null;

  const skills: SkillStat[] = (skillsRes.data ?? [])
    .map((row) => ({
      tag: row.skill_tag as string,
      label: SKILL_TAG_LABELS[row.skill_tag] ?? row.skill_tag,
      attempts: row.total_attempts as number,
      correct: row.correct_attempts as number,
      accuracy:
        row.total_attempts > 0
          ? Math.round((row.correct_attempts / row.total_attempts) * 100)
          : 0,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);

  const rows = attemptsRes.data ?? [];
  const kinds = aggregateKinds(rows, placementFloors);
  const totalAttempts = rows.length;
  const totalCorrect = rows.filter((r) => r.is_correct).length;
  const first = rows[0]?.drill_kind;
  const lastKind =
    first && (DRILL_KINDS as readonly string[]).includes(first) ? (first as DrillKind) : null;

  const activity: ActivityDay[] = (activityRes.data ?? []).map((row) => ({
    date: row.date as string,
    xp: row.xp_earned as number,
  }));

  return { profile, skills, kinds, totalAttempts, totalCorrect, lastKind, activity };
}
