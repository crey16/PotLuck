"use client";

// One night, live: per-player buy-ins and cash-outs recorded as they
// happen, a running on-the-table total, the entry timeline with void, and
// the settle-up panel. Once settled it renders the transfer list.
//
// The banker-owned ledger rule (docs/19): any group member can record
// entries — players without accounts can't, guests are rows not users —
// and everything is written through the API, which re-derives direction
// from kind and enforces the balance invariant at settle time.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadSupabaseClient } from "@/lib/supabase/lazyClient";
import { supabaseConfigured } from "@/lib/supabase/env";
import {
  fetchGroup,
  fetchGroupMembers,
  fetchGroupPlayers,
  fetchGroupSessions,
  fetchSessionEntries,
  fetchSessionPlayers,
  fetchSettlements,
} from "@/lib/games/queries";
import {
  GamesApiError,
  addEntry,
  addSessionPlayer,
  voidEntry,
} from "@/lib/games/api";
import { formatCents, parseDollarsToCents } from "@/lib/games/money";
import { netByPlayer, sessionBalanceCents } from "@/lib/games/stats";
import type {
  GameSessionRecord,
  GroupMemberRecord,
  GroupPlayerRecord,
  SessionEntryRecord,
  SessionPlayerRecord,
  SettlementRecord,
} from "@/lib/games/types";
import { SettlePanel, SettlementList } from "./SettleUp";

type LoadState = "loading" | "ready" | "missing" | "error";

function errorMessage(e: unknown): string {
  return e instanceof GamesApiError ? e.message : "Something went wrong.";
}

const QUICK_ADD = [2000, 4000, 6000, 10000];

export function SessionShell({
  groupId,
  sessionId,
}: {
  groupId: string;
  sessionId: string;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [myId, setMyId] = useState<string | null>(null);
  const [session, setSession] = useState<GameSessionRecord | null>(null);
  const [members, setMembers] = useState<GroupMemberRecord[]>([]);
  const [players, setPlayers] = useState<GroupPlayerRecord[]>([]);
  const [seated, setSeated] = useState<SessionPlayerRecord[]>([]);
  const [entries, setEntries] = useState<SessionEntryRecord[]>([]);
  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Which player's amount pad is open, and for what.
  const [pad, setPad] = useState<{ playerId: string; kind: "buyin" | "cashout" } | null>(null);
  const [amount, setAmount] = useState("");
  const [showTimeline, setShowTimeline] = useState(false);
  const [addingPlayer, setAddingPlayer] = useState(false);

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
        const [g, sessionRows] = await Promise.all([
          fetchGroup(supabase, groupId),
          fetchGroupSessions(supabase, groupId),
        ]);
        const s = sessionRows.find((row) => row.id === sessionId) ?? null;
        if (!g || !s) return { uid, found: null };
        const [memberRows, playerRows, seatedRows, entryRows, settlementRows] =
          await Promise.all([
            fetchGroupMembers(supabase, groupId),
            fetchGroupPlayers(supabase, groupId),
            fetchSessionPlayers(supabase, sessionId),
            fetchSessionEntries(supabase, [sessionId]),
            fetchSettlements(supabase, sessionId),
          ]);
        return {
          uid,
          found: { s, memberRows, playerRows, seatedRows, entryRows, settlementRows },
        };
      })
      .then((loaded) => {
        setMyId(loaded.uid);
        if (!loaded.found) {
          setState("missing");
          return;
        }
        setSession(loaded.found.s);
        setMembers(loaded.found.memberRows);
        setPlayers(loaded.found.playerRows);
        setSeated(loaded.found.seatedRows);
        setEntries(loaded.found.entryRows);
        setSettlements(loaded.found.settlementRows);
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
  }, [configured, groupId, sessionId]);

  const playerNames = useMemo(
    () => new Map(players.map((p) => [p.id, p.display_name])),
    [players]
  );

  const ledger = useMemo(
    () =>
      entries.map((e) => ({
        playerId: e.player_id,
        direction: e.direction,
        amountCents: e.amount_cents,
        voided: e.voided_at !== null,
      })),
    [entries]
  );
  const nets = useMemo(() => netByPlayer(ledger), [ledger]);
  const balance = useMemo(() => sessionBalanceCents(ledger), [ledger]);
  const totalIn = useMemo(
    () =>
      ledger
        .filter((e) => !e.voided && e.direction === "in")
        .reduce((sum, e) => sum + e.amountCents, 0),
    [ledger]
  );

  const perPlayer = useMemo(() => {
    const map = new Map<
      string,
      { inCents: number; outCents: number; lastBuyinCents: number | null }
    >();
    for (const sp of seated) {
      map.set(sp.player_id, { inCents: 0, outCents: 0, lastBuyinCents: null });
    }
    for (const e of entries) {
      if (e.voided_at !== null) continue;
      const row = map.get(e.player_id);
      if (!row) continue;
      if (e.direction === "in") {
        row.inCents += e.amount_cents;
        row.lastBuyinCents = e.amount_cents;
      } else {
        row.outCents += e.amount_cents;
      }
    }
    return map;
  }, [seated, entries]);

  const myRole = useMemo(
    () => members.find((m) => m.user_id === myId)?.role ?? null,
    [members, myId]
  );

  if (!configured)
    return <p className="text-dim">Supabase is not configured — no sessions without accounts.</p>;
  if (state === "loading") return <p className="text-dim">Loading…</p>;
  if (state === "missing")
    return <p className="text-dim">This session doesn’t exist, or you’re not in its group.</p>;
  if (state === "error" || !session)
    return <p className="text-dim">Couldn’t load the session. Refresh to retry.</p>;

  const live = session.status === "live";
  const lastBuyinAnywhere =
    [...entries].reverse().find((e) => e.direction === "in" && e.voided_at === null)
      ?.amount_cents ?? 6000;

  async function submitEntry(playerId: string, kind: "buyin" | "cashout", cents: number) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // A repeat buy-in is a rebuy; the first money in is the buy-in.
      const stats = perPlayer.get(playerId);
      const realKind = kind === "buyin" && stats && stats.inCents > 0 ? "rebuy" : kind;
      await addEntry(sessionId, {
        player_id: playerId,
        kind: realKind,
        amount_cents: cents,
      });
      setPad(null);
      setAmount("");
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function openPad(playerId: string, kind: "buyin" | "cashout") {
    setPad({ playerId, kind });
    // Buy-ins prefill from the player's (or table's) last buy-in; cash-outs
    // start blank — the stack is counted at the table, not guessed.
    const stats = perPlayer.get(playerId);
    const prefill = stats?.lastBuyinCents ?? lastBuyinAnywhere;
    setAmount(kind === "buyin" ? String(prefill / 100) : "");
  }

  const unseatedPlayers = players.filter(
    (p) => !seated.some((sp) => sp.player_id === p.id)
  );

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h1 style={{ fontSize: 30, lineHeight: 1.1 }}>
          {session.session_date}
          {session.stakes ? (
            <span className="text-dim" style={{ fontSize: 16, marginLeft: 10 }}>
              {session.stakes}
            </span>
          ) : null}
        </h1>
        <span className="lede">
          <Link href={`/games/${groupId}`}>← back to the group</Link>
        </span>
      </div>

      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <span className="tag tag-neutral">
          {live ? "LIVE" : session.status.toUpperCase()}
        </span>
        <span className="text-dim" style={{ fontSize: 14 }}>
          {formatCents(totalIn)} through the game
          {live ? ` · ${formatCents(Math.max(balance, 0))} on the table` : ""}
        </span>
      </div>

      {error ? <p style={{ margin: 0, color: "var(--crit)" }}>{error}</p> : null}

      <div>
        {seated.map((sp) => {
          const name = playerNames.get(sp.player_id) ?? "?";
          const stats = perPlayer.get(sp.player_id)!;
          const net = nets.get(sp.player_id);
          const cashedOut = stats.outCents > 0;
          const padOpen = pad?.playerId === sp.player_id;
          return (
            <div
              key={sp.player_id}
              style={{ borderBottom: "1px solid var(--color-divider)", padding: "12px 0" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{name}</div>
                  <div className="text-dim" style={{ fontSize: 13 }}>
                    in {formatCents(stats.inCents)}
                    {cashedOut ? ` · out ${formatCents(stats.outCents)}` : ""}
                  </div>
                </div>
                {cashedOut && net !== undefined ? (
                  <span
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                      color: net >= 0 ? "var(--good)" : "var(--crit)",
                    }}
                  >
                    {formatCents(net, true)}
                  </span>
                ) : null}
                {live ? (
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "8px 12px" }}
                      onClick={() =>
                        padOpen && pad?.kind === "buyin"
                          ? setPad(null)
                          : openPad(sp.player_id, "buyin")
                      }
                    >
                      + Buy-in
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "8px 12px" }}
                      onClick={() =>
                        padOpen && pad?.kind === "cashout"
                          ? setPad(null)
                          : openPad(sp.player_id, "cashout")
                      }
                    >
                      Cash out
                    </button>
                  </div>
                ) : null}
              </div>
              {padOpen && pad ? (
                <div style={{ marginTop: "var(--space-3)", display: "grid", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <input
                      className="input"
                      style={{ flex: 1, fontSize: 18 }}
                      inputMode="decimal"
                      autoFocus
                      placeholder={pad.kind === "cashout" ? "Count the stack…" : "Amount"}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      onKeyDown={(e) => {
                        const cents = parseDollarsToCents(amount);
                        if (e.key === "Enter" && cents !== null && (cents > 0 || pad.kind === "cashout")) {
                          void submitEntry(pad.playerId, pad.kind, Math.max(cents, 1));
                        }
                      }}
                    />
                    <button
                      className="btn btn-primary"
                      disabled={
                        busy ||
                        (() => {
                          const cents = parseDollarsToCents(amount);
                          return cents === null || cents < 1;
                        })()
                      }
                      onClick={() => {
                        const cents = parseDollarsToCents(amount);
                        if (cents !== null && cents >= 1) {
                          void submitEntry(pad.playerId, pad.kind, cents);
                        }
                      }}
                    >
                      {pad.kind === "buyin" ? "Add" : "Cash out"}
                    </button>
                  </div>
                  {pad.kind === "buyin" ? (
                    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                      {QUICK_ADD.map((cents) => (
                        <button
                          key={cents}
                          className="btn btn-ghost"
                          style={{ padding: "4px 10px" }}
                          onClick={() => setAmount(String(cents / 100))}
                        >
                          {formatCents(cents).replace(".00", "")}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {live ? (
        <div>
          {!addingPlayer ? (
            unseatedPlayers.length > 0 ? (
              <button className="btn btn-ghost" onClick={() => setAddingPlayer(true)}>
                + Add a player mid-session
              </button>
            ) : null
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
              {unseatedPlayers.map((p) => (
                <button
                  key={p.id}
                  className="btn btn-ghost"
                  style={{ padding: "6px 12px" }}
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void addSessionPlayer(sessionId, p.id)
                      .then(() => reload())
                      .catch((e) => setError(errorMessage(e)))
                      .finally(() => {
                        setBusy(false);
                        setAddingPlayer(false);
                      });
                  }}
                >
                  + {p.display_name}
                </button>
              ))}
              <button className="btn btn-ghost" onClick={() => setAddingPlayer(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div>
        <button className="btn btn-ghost" onClick={() => setShowTimeline(!showTimeline)}>
          {showTimeline ? "Hide" : "Show"} entry log ({entries.length})
        </button>
        {showTimeline ? (
          <div style={{ marginTop: "var(--space-2)" }}>
            {entries.map((e) => {
              const voided = e.voided_at !== null;
              return (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "var(--space-3)",
                    padding: "8px 0",
                    borderBottom: "1px solid var(--color-divider)",
                    fontSize: 14,
                    opacity: voided ? 0.5 : 1,
                    textDecoration: voided ? "line-through" : "none",
                  }}
                >
                  <span className="text-dim" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {new Date(e.occurred_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  <span style={{ flex: 1 }}>
                    {playerNames.get(e.player_id) ?? "?"} · {e.kind}
                    {e.imported ? " (imported total)" : ""}
                  </span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {e.direction === "out" ? "−" : "+"}
                    {formatCents(e.amount_cents)}
                  </span>
                  {live && !voided ? (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "2px 8px", fontSize: 12 }}
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm("Void this entry? It stays in the log, struck through.")) return;
                        setBusy(true);
                        void voidEntry(e.id)
                          .then(() => reload())
                          .catch((err) => setError(errorMessage(err)))
                          .finally(() => setBusy(false));
                      }}
                    >
                      Void
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {live ? (
        <SettlePanel
          sessionId={sessionId}
          balanced={balance === 0 && entries.some((e) => e.voided_at === null)}
          balanceCents={balance}
          awaitingCashouts={seated.some(
            (sp) => (perPlayer.get(sp.player_id)?.outCents ?? 0) === 0
          )}
          players={seated.map((sp) => sp.player_id)}
          playerNames={playerNames}
          onSettled={reload}
        />
      ) : session.status === "settled" ? (
        <SettlementList
          settlements={settlements}
          playerNames={playerNames}
          canReopen={myRole === "owner" || myRole === "admin"}
          sessionId={sessionId}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}
