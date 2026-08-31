// Every direct Supabase read for the home-game tracker lives here and
// nowhere else, mirroring lib/social/queries.ts. RLS (migration 0010) does
// the scoping: a non-member — or an ex-member — simply gets empty results,
// and the pages treat empty as not-found rather than confirming existence.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GameSessionRecord,
  GroupMemberRecord,
  GroupPlayerRecord,
  GroupRecord,
  SessionEntryRecord,
  SessionPlayerRecord,
  SettlementRecord,
} from "./types";

export async function fetchMyGroups(
  supabase: SupabaseClient
): Promise<GroupRecord[]> {
  const { data } = await supabase
    .from("poker_groups")
    .select("id, name, owner_user_id, currency, invite_code, created_at")
    .order("created_at", { ascending: false });
  return (data ?? []) as GroupRecord[];
}

export async function fetchGroup(
  supabase: SupabaseClient,
  groupId: string
): Promise<GroupRecord | null> {
  const { data } = await supabase
    .from("poker_groups")
    .select("id, name, owner_user_id, currency, invite_code, created_at")
    .eq("id", groupId)
    .maybeSingle();
  return (data as GroupRecord | null) ?? null;
}

export async function fetchGroupMembers(
  supabase: SupabaseClient,
  groupId: string
): Promise<GroupMemberRecord[]> {
  const { data } = await supabase
    .from("group_members")
    .select("group_id, user_id, role, joined_at")
    .eq("group_id", groupId)
    .is("left_at", null);
  return (data ?? []) as GroupMemberRecord[];
}

export async function fetchGroupPlayers(
  supabase: SupabaseClient,
  groupId: string
): Promise<GroupPlayerRecord[]> {
  const { data } = await supabase
    .from("group_players")
    .select("id, group_id, display_name, claimed_by_user_id, archived_at")
    .eq("group_id", groupId)
    .is("archived_at", null)
    .order("display_name");
  return (data ?? []) as GroupPlayerRecord[];
}

export async function fetchGroupSessions(
  supabase: SupabaseClient,
  groupId: string
): Promise<GameSessionRecord[]> {
  const { data } = await supabase
    .from("game_sessions")
    .select(
      "id, group_id, session_date, name, stakes, location, currency, status, settlement_mode, banker_player_id, started_at, ended_at, settled_at"
    )
    .eq("group_id", groupId)
    .order("session_date", { ascending: false })
    .order("started_at", { ascending: false });
  return (data ?? []) as GameSessionRecord[];
}

export async function fetchSessionPlayers(
  supabase: SupabaseClient,
  sessionId: string
): Promise<SessionPlayerRecord[]> {
  const { data } = await supabase
    .from("session_players")
    .select("session_id, player_id, joined_at, left_at")
    .eq("session_id", sessionId);
  return (data ?? []) as SessionPlayerRecord[];
}

/** Entries for one session or a whole group's history in one round trip. */
export async function fetchSessionEntries(
  supabase: SupabaseClient,
  sessionIds: string[]
): Promise<SessionEntryRecord[]> {
  if (sessionIds.length === 0) return [];
  const { data } = await supabase
    .from("session_entries")
    .select(
      "id, session_id, player_id, direction, kind, amount_cents, occurred_at, imported, created_by, voided_at"
    )
    .in("session_id", sessionIds)
    .order("occurred_at")
    .order("id");
  return (data ?? []) as SessionEntryRecord[];
}

export async function fetchSettlements(
  supabase: SupabaseClient,
  sessionId: string
): Promise<SettlementRecord[]> {
  const { data } = await supabase
    .from("session_settlements")
    .select(
      "id, session_id, from_player_id, to_player_id, amount_cents, mode, paid_at"
    )
    .eq("session_id", sessionId)
    .order("amount_cents", { ascending: false })
    .order("id");
  return (data ?? []) as SettlementRecord[];
}
