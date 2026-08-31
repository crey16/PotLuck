"use client";

// One group's home: the leaderboard, session history, and roster. All
// reads come from lib/games/queries.ts in a single load; every mutation
// goes through lib/games/api.ts and then reloads from the source of truth.
//
// The leaderboard is computed from SETTLED sessions only — a live night's
// ledger is half-written by definition. Live sessions appear in the
// history list with a LIVE chip instead.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { loadSupabaseClient } from "@/lib/supabase/lazyClient";
import { supabaseConfigured } from "@/lib/supabase/env";
import {
  fetchGroup,
  fetchGroupMembers,
  fetchGroupPlayers,
  fetchGroupSessions,
  fetchSessionEntries,
} from "@/lib/games/queries";
import {
  GamesApiError,
  addGuestPlayer,
  addMember,
  claimPlayer,
  createSession,
} from "@/lib/games/api";
import { listFriends } from "@/lib/social/api";
import type { FriendProfile } from "@/lib/social/types";
import type {
  GameSessionRecord,
  GroupMemberRecord,
  GroupPlayerRecord,
  GroupRecord,
  SessionEntryRecord,
} from "@/lib/games/types";
import { netByPlayer, type SessionEntries } from "@/lib/games/stats";
import { formatCents } from "@/lib/games/money";
import { GroupLeaderboard } from "./GroupLeaderboard";

type Tab = "board" | "sessions" | "roster";
type LoadState = "loading" | "ready" | "missing" | "error";

function errorMessage(e: unknown): string {
  return e instanceof GamesApiError ? e.message : "Something went wrong.";
}

function todayIso(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function GroupShell({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>("loading");
  const [tab, setTab] = useState<Tab>("board");
  const [myId, setMyId] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupRecord | null>(null);
  const [members, setMembers] = useState<GroupMemberRecord[]>([]);
  const [players, setPlayers] = useState<GroupPlayerRecord[]>([]);
  const [sessions, setSessions] = useState<GameSessionRecord[]>([]);
  const [entries, setEntries] = useState<SessionEntryRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // New-session picker.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [stakes, setStakes] = useState("");

  // Roster forms.
  const [guestName, setGuestName] = useState("");
  const [friends, setFriends] = useState<FriendProfile[] | null>(null);
  const [copied, setCopied] = useState(false);

  const configured = supabaseConfigured();

  // setState only ever runs in .then/.catch callbacks — never synchronously
  // from the effect body (the M2 lint rule).
  function reload(): Promise<void> {
    return loadSupabaseClient()
      .then(async (supabase) => {
        const {
          data: { session: authSession },
        } = await supabase.auth.getSession();
        const uid = authSession?.user?.id ?? null;
        const g = await fetchGroup(supabase, groupId);
        // RLS hides groups you are not in; missing and hidden look the same.
        if (!g) return { uid, group: null };
        const [memberRows, playerRows, sessionRows] = await Promise.all([
          fetchGroupMembers(supabase, groupId),
          fetchGroupPlayers(supabase, groupId),
          fetchGroupSessions(supabase, groupId),
        ]);
        const entryRows = await fetchSessionEntries(
          supabase,
          sessionRows.map((s) => s.id)
        );
        return { uid, group: g, memberRows, playerRows, sessionRows, entryRows };
      })
      .then((loaded) => {
        setMyId(loaded.uid);
        if (!loaded.group) {
          setState("missing");
          return;
        }
        setGroup(loaded.group);
        setMembers(loaded.memberRows);
        setPlayers(loaded.playerRows);
        setSessions(loaded.sessionRows);
        setEntries(loaded.entryRows);
        setState("ready");
      })
      .catch(() => {
        setState("error");
      });
  }

  useEffect(() => {
    if (!configured) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, groupId]);

  const playerNames = useMemo(
    () => new Map(players.map((p) => [p.id, p.display_name])),
    [players]
  );

  const entriesBySession = useMemo(() => {
    const map = new Map<string, SessionEntryRecord[]>();
    for (const e of entries) {
      const list = map.get(e.session_id);
      if (list) list.push(e);
      else map.set(e.session_id, [e]);
    }
    return map;
  }, [entries]);

  const settledSessions: SessionEntries[] = useMemo(
    () =>
      sessions
        .filter((s) => s.status === "settled")
        .map((s) => ({
          sessionId: s.id,
          date: s.session_date,
          entries: (entriesBySession.get(s.id) ?? []).map((e) => ({
            playerId: e.player_id,
            direction: e.direction,
            amountCents: e.amount_cents,
            voided: e.voided_at !== null,
          })),
        })),
    [sessions, entriesBySession]
  );

  const myPlayer = useMemo(
    () => players.find((p) => p.claimed_by_user_id === myId) ?? null,
    [players, myId]
  );
  const myRole = useMemo(
    () => members.find((m) => m.user_id === myId)?.role ?? null,
    [members, myId]
  );

  if (!configured)
    return <p className="text-dim">Supabase is not configured — no groups without accounts.</p>;
  if (state === "loading") return <p className="text-dim">Loading…</p>;
  if (state === "missing") return <p className="text-dim">This group doesn’t exist, or you’re not in it.</p>;
  if (state === "error" || !group)
    return <p className="text-dim">Couldn’t load the group. Refresh to retry.</p>;

  async function onStartSession() {
    if (picked.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createSession(groupId, {
        session_date: todayIso(),
        player_ids: [...picked],
        stakes: stakes.trim() || undefined,
      });
      router.push(`/games/${groupId}/session/${created.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  async function withReload(action: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const liveSession = sessions.find((s) => s.status === "live") ?? null;

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h1 style={{ fontSize: 34, lineHeight: 1 }}>{group.name}</h1>
        <span className="lede">
          {members.length} member{members.length === 1 ? "" : "s"} ·{" "}
          {players.length} on the roster
        </span>
      </div>

      {liveSession ? (
        <Link
          href={`/games/${groupId}/session/${liveSession.id}`}
          className="blueprint"
          style={{
            padding: "var(--space-3) var(--space-4)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <span>
            <span className="tag tag-accent" style={{ marginRight: 8 }}>LIVE</span>
            Session in progress — {liveSession.session_date}
          </span>
          <span>→</span>
        </Link>
      ) : (
        <div>
          {!picking ? (
            <button className="btn btn-primary btn-block" onClick={() => setPicking(true)}>
              Start tonight’s session
            </button>
          ) : (
            <div className="blueprint" style={{ padding: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
              <strong>Who’s playing?</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                {players.map((p) => {
                  const on = picked.has(p.id);
                  return (
                    <button
                      key={p.id}
                      className={on ? "btn btn-primary" : "btn btn-ghost"}
                      style={{ padding: "8px 14px" }}
                      onClick={() => {
                        const next = new Set(picked);
                        if (on) next.delete(p.id);
                        else next.add(p.id);
                        setPicked(next);
                      }}
                    >
                      {p.display_name}
                    </button>
                  );
                })}
              </div>
              <input
                className="input"
                placeholder="Stakes (optional) — e.g. $0.25/$0.50"
                value={stakes}
                maxLength={60}
                onChange={(e) => setStakes(e.target.value)}
              />
              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button
                  className="btn btn-primary"
                  disabled={busy || picked.size === 0}
                  onClick={() => void onStartSession()}
                >
                  Deal them in ({picked.size})
                </button>
                <button className="btn btn-ghost" onClick={() => setPicking(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 2 }}>
        {(
          [
            ["board", "Board"],
            ["sessions", "Sessions"],
            ["roster", "Roster"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            className={`btn btn-caps ${tab === key ? "btn-primary" : "btn-secondary"}`}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p style={{ margin: 0, color: "var(--crit)" }}>{error}</p> : null}

      {tab === "board" ? (
        <GroupLeaderboard sessions={settledSessions} playerNames={playerNames} />
      ) : null}

      {tab === "sessions" ? (
        <div
          className={sessions.length === 0 ? undefined : "blueprint"}
          style={sessions.length === 0 ? undefined : { padding: 0, overflow: "hidden" }}
        >
          {sessions.length === 0 ? (
            <p className="text-dim" style={{ margin: 0 }}>No sessions yet.</p>
          ) : (
            sessions.map((s) => {
              const sessionEntries = (entriesBySession.get(s.id) ?? []).map((e) => ({
                playerId: e.player_id,
                direction: e.direction,
                amountCents: e.amount_cents,
                voided: e.voided_at !== null,
              }));
              const nets = netByPlayer(sessionEntries);
              const myNet = myPlayer ? nets.get(myPlayer.id) : undefined;
              const headcount = new Set(
                sessionEntries.filter((e) => !e.voided).map((e) => e.playerId)
              ).size;
              return (
                <Link
                  key={s.id}
                  href={`/games/${groupId}/session/${s.id}`}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "var(--space-3)",
                    padding: "12px var(--space-4)",
                    borderBottom: "1px solid var(--color-divider)",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{s.session_date}</span>
                  {s.status === "live" ? (
                    <span className="tag tag-accent">LIVE</span>
                  ) : s.status === "void" ? (
                    <span className="tag tag-neutral">VOID</span>
                  ) : null}
                  <span className="text-dim" style={{ fontSize: 13, flex: 1 }}>
                    {headcount} player{headcount === 1 ? "" : "s"}
                    {s.stakes ? ` · ${s.stakes}` : ""}
                  </span>
                  {myNet !== undefined ? (
                    <span
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        color: myNet >= 0 ? "var(--good)" : "var(--crit)",
                      }}
                    >
                      {formatCents(myNet, true)}
                    </span>
                  ) : null}
                </Link>
              );
            })
          )}
        </div>
      ) : null}

      {tab === "roster" ? (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <div className="blueprint" style={{ padding: 0, overflow: "hidden" }}>
            {players.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  padding: "10px var(--space-4)",
                  borderBottom: "1px solid var(--color-divider)",
                }}
              >
                <span style={{ flex: 1, fontWeight: 600 }}>{p.display_name}</span>
                {p.claimed_by_user_id ? (
                  <span className="tag tag-neutral">
                    {p.claimed_by_user_id === myId ? "you" : "claimed"}
                  </span>
                ) : myPlayer === null ? (
                  <button
                    className="btn btn-ghost"
                    style={{ padding: "4px 10px" }}
                    disabled={busy}
                    onClick={() => void withReload(() => claimPlayer(groupId, p.id))}
                  >
                    This is me
                  </button>
                ) : (
                  <span className="tag tag-outline">guest</span>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Add a guest — name only, no account needed"
              value={guestName}
              maxLength={60}
              onChange={(e) => setGuestName(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                guestName.trim() &&
                void withReload(() => addGuestPlayer(groupId, guestName.trim())).then(
                  (ok) => ok && setGuestName("")
                )
              }
            />
            <button
              className="btn btn-secondary"
              disabled={busy || !guestName.trim()}
              onClick={() =>
                void withReload(() => addGuestPlayer(groupId, guestName.trim())).then(
                  (ok) => ok && setGuestName("")
                )
              }
            >
              Add
            </button>
          </div>

          {myRole === "owner" || myRole === "admin" ? (
            <div className="blueprint" style={{ padding: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
              <strong>Invite</strong>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <code className="tag tag-mono" style={{ fontSize: 16, letterSpacing: 2 }}>
                  {group.invite_code}
                </code>
                <button
                  className="btn btn-ghost"
                  style={{ padding: "4px 10px" }}
                  onClick={() => {
                    void navigator.clipboard?.writeText(group.invite_code).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? "Copied" : "Copy code"}
                </button>
              </div>
              {friends === null ? (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    void listFriends().then(setFriends).catch(() => setFriends([]));
                  }}
                >
                  Add from your friends…
                </button>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                  {friends
                    .filter((f) => !members.some((m) => m.user_id === f.id))
                    .map((f) => (
                      <button
                        key={f.id}
                        className="btn btn-ghost"
                        style={{ padding: "6px 12px" }}
                        disabled={busy}
                        onClick={() => void withReload(() => addMember(groupId, f.id))}
                      >
                        + {f.display_name ?? f.username}
                      </button>
                    ))}
                  {friends.filter((f) => !members.some((m) => m.user_id === f.id)).length === 0 ? (
                    <span className="text-dim" style={{ fontSize: 13 }}>
                      All your friends are already in.
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
