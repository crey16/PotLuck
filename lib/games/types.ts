// Row shapes for the home-game tracker, snake_case as returned by
// Supabase/FastAPI (matching lib/social/types.ts convention).

export type GroupRole = "owner" | "admin" | "member";
export type SessionStatus = "live" | "settled" | "void";
export type SettlementMode = "banker" | "fewest_transfers";
export type EntryKind = "buyin" | "rebuy" | "addon" | "cashout";

export interface GroupRecord {
  id: string;
  name: string;
  owner_user_id: string;
  currency: string;
  invite_code: string;
  created_at: string;
}

export interface GroupMemberRecord {
  group_id: string;
  user_id: string;
  role: GroupRole;
  joined_at: string;
}

export interface GroupPlayerRecord {
  id: string;
  group_id: string;
  display_name: string;
  claimed_by_user_id: string | null;
  archived_at: string | null;
}

export interface GameSessionRecord {
  id: string;
  group_id: string;
  session_date: string;
  name: string | null;
  stakes: string | null;
  location: string | null;
  currency: string;
  status: SessionStatus;
  settlement_mode: SettlementMode | null;
  banker_player_id: string | null;
  started_at: string;
  ended_at: string | null;
  settled_at: string | null;
}

export interface SessionPlayerRecord {
  session_id: string;
  player_id: string;
  joined_at: string;
  left_at: string | null;
}

export interface SessionEntryRecord {
  id: number;
  session_id: string;
  player_id: string;
  direction: "in" | "out";
  kind: EntryKind;
  amount_cents: number;
  occurred_at: string;
  imported: boolean;
  created_by: string;
  voided_at: string | null;
}

export interface SettlementRecord {
  id: number;
  session_id: string;
  from_player_id: string;
  to_player_id: string;
  amount_cents: number;
  mode: SettlementMode;
  paid_at: string | null;
}

/** A transfer as returned by settle/settle-preview (not yet a stored row). */
export interface ProposedTransfer {
  from_player_id: string;
  to_player_id: string;
  amount_cents: number;
}

export interface SettlementPayload {
  balance_cents: number;
  nets: { player_id: string; net_cents: number }[];
  transfers: ProposedTransfer[];
}
