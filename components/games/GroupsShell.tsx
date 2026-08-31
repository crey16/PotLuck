"use client";

// The /games landing: your groups, create, and join-by-code. Everything
// loads client-side through lib/games/queries.ts; mutations go through
// lib/games/api.ts and refresh the list from the source of truth.

import Link from "next/link";
import { useEffect, useState } from "react";
import { loadSupabaseClient } from "@/lib/supabase/lazyClient";
import { supabaseConfigured } from "@/lib/supabase/env";
import { fetchMyGroups } from "@/lib/games/queries";
import { GamesApiError, createGroup, joinGroup } from "@/lib/games/api";
import type { GroupRecord } from "@/lib/games/types";

type LoadState = "loading" | "ready" | "error";

function errorMessage(e: unknown): string {
  return e instanceof GamesApiError ? e.message : "Something went wrong.";
}

export function GroupsShell() {
  const [state, setState] = useState<LoadState>("loading");
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = supabaseConfigured();

  // setState only ever runs in .then/.catch callbacks — never synchronously
  // from the effect body (the M2 lint rule).
  function reload(): Promise<void> {
    return loadSupabaseClient()
      .then((supabase) => fetchMyGroups(supabase))
      .then((rows) => {
        setGroups(rows);
        setState("ready");
      })
      .catch(() => {
        setState("error");
      });
  }

  useEffect(() => {
    if (!configured) return;
    void reload();
     
  }, [configured]);

  async function onCreate() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createGroup(name.trim());
      setName("");
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onJoin() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await joinGroup(code.trim());
      setCode("");
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return <p className="text-dim">Supabase is not configured — no groups without accounts.</p>;
  }
  if (state === "loading") {
    return <p className="text-dim">Loading your groups…</p>;
  }
  if (state === "error") {
    return <p className="text-dim">Couldn’t load groups. Refresh to retry.</p>;
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {groups.length === 0 ? (
        <div className="card" style={{ padding: "var(--space-4)" }}>
          <p style={{ margin: 0 }}>
            No groups yet. Create one for your game, or join a friend’s with
            their invite code.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-3)" }}>
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/games/${g.id}`}
              className="card"
              style={{
                padding: "var(--space-4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3)",
                textDecoration: "none",
              }}
            >
              <span style={{ fontFamily: "var(--font-heading)", fontSize: 20 }}>
                {g.name}
              </span>
              <span className="tag tag-neutral">{g.currency}</span>
            </Link>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
        <strong>Start a group</strong>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: "1 1 180px" }}
            placeholder="Group name — e.g. Thursday Night"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void onCreate()}
          />
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void onCreate()}>
            Create
          </button>
        </div>
        <strong>Join with a code</strong>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ flex: "1 1 180px", textTransform: "uppercase" }}
            placeholder="Invite code"
            value={code}
            maxLength={20}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void onJoin()}
          />
          <button className="btn btn-secondary" disabled={busy || !code.trim()} onClick={() => void onJoin()}>
            Join
          </button>
        </div>
        {error ? <p style={{ margin: 0, color: "var(--crit)" }}>{error}</p> : null}
      </div>
    </div>
  );
}
