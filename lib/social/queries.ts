// Every direct Supabase read for the social layer lives here and nowhere
// else — this file is the whole Supabase-coupled surface (besides
// Realtime subscription setup in the leaderboard shell), kept small on
// purpose so a future storage move rewrites one module.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaderboardRow } from "./types";

export interface ProfileRecord {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  is_public: boolean;
  xp: number;
  level: number;
  streak_count: number;
}

export interface SkillStatRecord {
  skill_tag: string;
  total_attempts: number;
  correct_attempts: number;
}

export interface DailyActivityRecord {
  date: string;
  xp_earned: number;
}

const LEADERBOARD_COLUMNS = "id, username, display_name, level, streak_count, xp";

export async function fetchGlobalLeaderboard(
  supabase: SupabaseClient,
  limit = 100
): Promise<LeaderboardRow[]> {
  const { data } = await supabase
    .from("leaderboard")
    .select(LEADERBOARD_COLUMNS)
    .order("xp", { ascending: false })
    .limit(limit);
  return (data ?? []) as LeaderboardRow[];
}

export async function fetchFriendIds(
  supabase: SupabaseClient,
  myId: string
): Promise<string[]> {
  const { data } = await supabase
    .from("friends")
    .select("friend_user_id")
    .eq("user_id", myId);
  return (data ?? []).map((row) => row.friend_user_id as string);
}

/** Friends board reads profiles directly (not the view): RLS grants friend
 * reads, so private friends still rank among friends. */
export async function fetchFriendsLeaderboard(
  supabase: SupabaseClient,
  myId: string
): Promise<LeaderboardRow[]> {
  const friendIds = await fetchFriendIds(supabase, myId);
  const { data } = await supabase
    .from("profiles")
    .select(LEADERBOARD_COLUMNS)
    .in("id", [...friendIds, myId]);
  return (data ?? []) as LeaderboardRow[];
}

/** Returns null when the profile doesn't exist or RLS hides it — the page
 * treats both as not-found rather than confirming existence. */
export async function fetchProfileByUsername(
  supabase: SupabaseClient,
  username: string
): Promise<ProfileRecord | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name, bio, is_public, xp, level, streak_count")
    .ilike("username", username)
    .maybeSingle();
  return (data as ProfileRecord | null) ?? null;
}

export async function fetchProfileById(
  supabase: SupabaseClient,
  userId: string
): Promise<LeaderboardRow | null> {
  const { data } = await supabase
    .from("profiles")
    .select(LEADERBOARD_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  return (data as LeaderboardRow | null) ?? null;
}

/** Empty for a non-friend — RLS on skill_stats is own-or-friend. */
export async function fetchSkillStats(
  supabase: SupabaseClient,
  userId: string
): Promise<SkillStatRecord[]> {
  const { data } = await supabase
    .from("skill_stats")
    .select("skill_tag, total_attempts, correct_attempts")
    .eq("user_id", userId);
  return (data ?? []) as SkillStatRecord[];
}

/** Empty for a non-friend — RLS on user_daily_activity is own-or-friend. */
export async function fetchDailyActivity(
  supabase: SupabaseClient,
  userId: string,
  start: string,
  end: string
): Promise<DailyActivityRecord[]> {
  const { data } = await supabase
    .from("user_daily_activity")
    .select("date, xp_earned")
    .eq("user_id", userId)
    .gte("date", start)
    .lte("date", end)
    .order("date");
  return (data ?? []) as DailyActivityRecord[];
}
