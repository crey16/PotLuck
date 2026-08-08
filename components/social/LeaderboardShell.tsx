"use client";

// Scope + metric toggles over server-provided initial rows, kept live by a
// Supabase Realtime subscription on profiles UPDATEs. postgres_changes
// respects RLS, so a signed-in viewer only ever receives rows they could
// read anyway. Subscription failure degrades silently to the rendered board.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadSupabaseClient } from "@/lib/supabase/lazyClient";
import { supabaseConfigured } from "@/lib/supabase/env";
import {
  applyProfileUpdate,
  injectSelf,
  sortRows,
  type Metric,
  type ProfileUpdate,
} from "@/lib/social/leaderboard";
import { fetchFriendsLeaderboard } from "@/lib/social/queries";
import type { LeaderboardRow } from "@/lib/social/types";

type Scope = "global" | "friends";

export interface LeaderboardShellProps {
  initialGlobal: LeaderboardRow[];
  friendIds: string[];
  self: LeaderboardRow | null;
  selfIsPublic: boolean;
}

export function LeaderboardShell({
  initialGlobal,
  friendIds,
  self,
  selfIsPublic,
}: LeaderboardShellProps) {
  const [scope, setScope] = useState<Scope>("global");
  const [metric, setMetric] = useState<Metric>("xp");
  const [globalRows, setGlobalRows] = useState<LeaderboardRow[]>(initialGlobal);
  const [friendRows, setFriendRows] = useState<LeaderboardRow[] | null>(null);
  const [movedId, setMovedId] = useState<string | null>(null);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scopeIds = useMemo(
    () => new Set(self ? [...friendIds, self.id] : friendIds),
    [friendIds, self]
  );

  function flashMover(id: string) {
    setMovedId(id);
    if (moveTimer.current) clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(() => setMovedId(null), 1200);
  }

  // Lazily load the friends board on first switch.
  useEffect(() => {
    if (scope !== "friends" || friendRows !== null || !supabaseConfigured() || !self) return;
    let cancelled = false;
    loadSupabaseClient()
      .then((supabase) => fetchFriendsLeaderboard(supabase, self.id))
      .then((rows) => {
        if (!cancelled) setFriendRows(sortRows(rows, metric));
      });
    return () => {
      cancelled = true;
    };
    // metric only affects the initial sort; re-sorting on change happens in render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, friendRows, self]);

  // The Realtime channel. Resubscribing when metric/scope inputs change is
  // cheap and keeps the handler's closure current without render-time refs.
  //
  // The SDK is fetched here rather than imported at module scope (M8.8C). The
  // board's rows are server-rendered, so nothing on screen is waiting on
  // Realtime, and keeping @supabase/supabase-js out of the initial JS lets the
  // ranks paint and hydrate without it. Only the liveness arrives late.
  useEffect(() => {
    if (!supabaseConfigured()) return;
    let cancelled = false;
    // Set once the subscription exists. The effect can be torn down while the
    // chunk is still in flight, so cleanup has to handle both orders.
    let unsubscribe: (() => void) | null = null;

    function onProfileUpdate(payload: { new: unknown }) {
      const next = payload.new as Record<string, unknown>;
      if (typeof next.id !== "string") return;
      const update: ProfileUpdate = {
        id: next.id,
        xp: (next.xp as number) ?? 0,
        streak_count: (next.streak_count as number) ?? 0,
        level: (next.level as number) ?? 1,
        is_public: (next.is_public as boolean) ?? true,
        username: next.username as string | undefined,
        display_name: (next.display_name as string | null) ?? null,
      };
      setGlobalRows((rows) => {
        const result = applyProfileUpdate(rows, update, metric);
        if (result.movedId) flashMover(result.movedId);
        return result.rows;
      });
      setFriendRows((rows) => {
        if (rows === null) return rows;
        const result = applyProfileUpdate(rows, update, metric, scopeIds);
        if (result.movedId) flashMover(result.movedId);
        return result.rows;
      });
    }

    void loadSupabaseClient().then((supabase) => {
      if (cancelled) return;
      const channel = supabase
        .channel("leaderboard")
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles" },
          onProfileUpdate
        )
        .subscribe();
      unsubscribe = () => {
        supabase.removeChannel(channel);
      };
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [metric, scopeIds]);

  // Inject the caller's own row whenever the global board lacks it — a
  // private caller is never in the view; a public one may sit below the
  // top 100. The row renders unranked either way; the note differs.
  const baseRows = scope === "global" ? globalRows : friendRows ?? [];
  let rows = sortRows(baseRows, metric);
  if (scope === "global" && self) {
    rows = injectSelf(rows, self, metric);
  }
  const unrankedNote = selfIsPublic
    ? "outside the top 100"
    : "private — not ranked publicly";

  const toggle = (
    active: boolean,
    label: string,
    onClick: () => void
  ) => (
    <button
      key={label}
      className={`btn btn-caps ${active ? "btn-primary" : "btn-secondary"}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div
        style={{
          display: "flex", gap: "var(--space-3)", flexWrap: "wrap",
          marginBottom: "var(--space-4)",
        }}
      >
        <div style={{ display: "flex", gap: 2 }}>
          {toggle(scope === "global", "Global", () => setScope("global"))}
          {toggle(scope === "friends", "Friends", () => setScope("friends"))}
        </div>
        <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
          {toggle(metric === "xp", "XP", () => setMetric("xp"))}
          {toggle(metric === "streak", "Streak", () => setMetric("streak"))}
        </div>
      </div>

      {scope === "friends" && friendRows === null ? (
        <p className="text-dim">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-dim">
          {scope === "friends"
            ? "Add friends to see how you stack up."
            : "Nobody on the board yet."}
        </p>
      ) : (
        <div className="blueprint" style={{ padding: 0 }}>
          {rows.map((row, index) => {
            const isSelf = self !== null && row.id === self.id;
            return (
              <div
                key={row.id}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--space-3)",
                  padding: "10px var(--space-4)",
                  borderBottom: "1px solid var(--color-divider)",
                  background: isSelf
                    ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
                    : movedId === row.id
                      ? "color-mix(in srgb, var(--color-accent) 18%, transparent)"
                      : undefined,
                  transition: "background 600ms ease",
                }}
              >
                <span
                  style={{
                    width: 34, fontFamily: "var(--font-mono)", fontSize: 12,
                    letterSpacing: ".06em",
                    color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                  }}
                >
                  {row.unranked ? "—" : String(index + 1).padStart(2, "0")}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Link
                    href={`/u/${row.username}`}
                    style={{ color: "var(--color-text)", fontWeight: 600, fontSize: 14 }}
                  >
                    {row.display_name ?? row.username}
                    {isSelf && <span className="mono-label accent" style={{ marginLeft: 8 }}>You</span>}
                  </Link>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
                    }}
                  >
                    @{row.username} · L{row.level}
                    {row.unranked && ` · ${unrankedNote}`}
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)", fontSize: 13, letterSpacing: ".04em",
                  }}
                >
                  {metric === "xp"
                    ? `${row.xp.toLocaleString()} XP`
                    : `${row.streak_count}d`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
