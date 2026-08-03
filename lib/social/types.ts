// Social vocabulary and shapes shared across the API client, the
// leaderboard logic, and the pages. The two const tuples below are pinned
// to api/friends.py by api/test_social_vocab_matches_typescript.py — change
// them in both places or that test fails.

export const REQUEST_STATUSES = ["pending", "accepted", "declined"] as const;
export const RELATIONSHIPS = [
  "none",
  "friends",
  "pending_outgoing",
  "pending_incoming",
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export type Relationship = (typeof RELATIONSHIPS)[number];

export interface SearchResult {
  id: string;
  username: string;
  display_name: string | null;
  level: number;
  streak_count: number;
  relationship: Relationship;
}

export interface FriendProfile {
  id: string;
  username: string;
  display_name: string | null;
  level: number;
  streak_count: number;
  xp: number;
}

export interface FriendRequestEntry {
  id: number;
  from_user_id: string;
  to_user_id: string;
  created_at: string;
  user: Omit<SearchResult, "relationship">;
}

export interface FriendRequestLists {
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
}

export interface LeaderboardRow {
  id: string;
  username: string;
  display_name: string | null;
  level: number;
  streak_count: number;
  xp: number;
  /** True for a private caller's self row injected into the global board. */
  unranked?: boolean;
}

export interface OwnProfile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  is_public: boolean;
  xp: number;
  level: number;
  streak_count: number;
}

export interface ProfilePatch {
  display_name?: string;
  bio?: string;
  is_public?: boolean;
}
