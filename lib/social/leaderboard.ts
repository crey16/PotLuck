// Pure leaderboard logic: sorting, applying a Realtime profile update,
// and injecting a private caller's own row. No Supabase imports here —
// the coupled reads live in lib/social/queries.ts.

import type { LeaderboardRow } from "./types";

export type Metric = "xp" | "streak";

export interface ProfileUpdate {
  id: string;
  xp: number;
  streak_count: number;
  level: number;
  is_public: boolean;
  username?: string;
  display_name?: string | null;
}

function metricValue(rowValue: LeaderboardRow, metric: Metric): number {
  return metric === "xp" ? rowValue.xp : rowValue.streak_count;
}

export function sortRows(rows: LeaderboardRow[], metric: Metric): LeaderboardRow[] {
  return [...rows].sort((a, b) => {
    const primary = metricValue(b, metric) - metricValue(a, metric);
    if (primary !== 0) return primary;
    if (b.xp !== a.xp) return b.xp - a.xp;
    return a.username.toLowerCase().localeCompare(b.username.toLowerCase());
  });
}

export interface UpdateResult {
  rows: LeaderboardRow[];
  /** The id whose position/values changed, for a UI flash; null if nothing did. */
  movedId: string | null;
}

/**
 * Fold one Realtime profiles UPDATE into a board.
 *
 * `scopeIds` present = a friends board: updates outside the scope are
 * ignored, and privacy changes do not remove rows (friends may see private
 * friends). No `scopeIds` = the global board: a row that went private is
 * removed, and unknown ids are ignored (the top-100 read is authoritative;
 * a new public profile joins on the next load).
 */
export function applyProfileUpdate(
  rows: LeaderboardRow[],
  update: ProfileUpdate,
  metric: Metric,
  scopeIds?: Set<string>
): UpdateResult {
  const scoped = scopeIds !== undefined;
  if (scoped && !scopeIds.has(update.id)) return { rows, movedId: null };

  const existing = rows.find((r) => r.id === update.id);
  if (!scoped && !update.is_public) {
    if (!existing) return { rows, movedId: null };
    return { rows: rows.filter((r) => r.id !== update.id), movedId: null };
  }

  let next: LeaderboardRow[];
  if (existing) {
    next = rows.map((r) =>
      r.id === update.id
        ? {
            ...r,
            xp: update.xp,
            streak_count: update.streak_count,
            level: update.level,
            ...(update.username !== undefined ? { username: update.username } : {}),
            ...(update.display_name !== undefined
              ? { display_name: update.display_name }
              : {}),
          }
        : r
    );
  } else {
    if (!scoped) return { rows, movedId: null };
    if (update.username === undefined) return { rows, movedId: null };
    next = [
      ...rows,
      {
        id: update.id,
        username: update.username,
        display_name: update.display_name ?? null,
        level: update.level,
        streak_count: update.streak_count,
        xp: update.xp,
      },
    ];
  }
  return { rows: sortRows(next, metric), movedId: update.id };
}

/** Add the caller's own row when the board doesn't include it (private
 * caller on the global board), marked unranked. */
export function injectSelf(
  rows: LeaderboardRow[],
  self: LeaderboardRow,
  metric: Metric
): LeaderboardRow[] {
  if (rows.some((r) => r.id === self.id)) return rows;
  return sortRows([...rows, { ...self, unranked: true }], metric);
}
