"use client";

// FastAPI home-game calls. Mirrors lib/social/api.ts: bearer token from the
// browser Supabase session, JSON in/out, `detail` surfaced on failure. The
// settle 409 carries a structured detail (the ledger discrepancy) which is
// preserved on the error for the settle screen to render.

import { loadSupabaseClient } from "../supabase/lazyClient";
import { traceHeaders } from "../observability/clientTrace";
import { supabaseConfigured } from "../supabase/env";
import type { EntryKind, SettlementMode, SettlementPayload } from "./types";

export interface UnbalancedDetail {
  error: "unbalanced";
  balance_cents: number;
  total_in_cents: number;
  total_out_cents: number;
}

export class GamesApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail?: unknown
  ) {
    super(message);
    this.name = "GamesApiError";
  }

  get unbalanced(): UnbalancedDetail | null {
    const d = this.detail as UnbalancedDetail | undefined;
    return d && typeof d === "object" && d.error === "unbalanced" ? d : null;
  }
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!supabaseConfigured()) throw new GamesApiError("Supabase is not configured.");
  const supabase = await loadSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new GamesApiError("Your session expired. Sign in again.", 401);
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...traceHeaders(),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    let detail: unknown;
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail = body.detail;
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // The status is still useful when the response is not JSON.
    }
    throw new GamesApiError(message, response.status, detail);
  }
  return (await response.json()) as T;
}

export function createGroup(
  name: string
): Promise<{ id: string; invite_code: string }> {
  return authRequest("/api/games/groups", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function joinGroup(
  inviteCode: string
): Promise<{ group_id: string; status: "joined" }> {
  return authRequest("/api/games/groups/join", {
    method: "POST",
    body: JSON.stringify({ invite_code: inviteCode }),
  });
}

export function addMember(
  groupId: string,
  userId: string
): Promise<{ status: "added" }> {
  return authRequest(`/api/games/groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

export function leaveGroup(groupId: string): Promise<{ status: "left" }> {
  return authRequest(`/api/games/groups/${groupId}/leave`, { method: "POST" });
}

export function addGuestPlayer(
  groupId: string,
  displayName: string
): Promise<{ id: string; display_name: string }> {
  return authRequest(`/api/games/groups/${groupId}/players`, {
    method: "POST",
    body: JSON.stringify({ display_name: displayName }),
  });
}

export function claimPlayer(
  groupId: string,
  playerId: string
): Promise<{ status: "claimed" }> {
  return authRequest(`/api/games/groups/${groupId}/players/${playerId}/claim`, {
    method: "POST",
  });
}

export function createSession(
  groupId: string,
  input: {
    session_date: string;
    player_ids: string[];
    name?: string;
    stakes?: string;
    location?: string;
  }
): Promise<{ id: string }> {
  return authRequest(`/api/games/groups/${groupId}/sessions`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function addSessionPlayer(
  sessionId: string,
  playerId: string
): Promise<{ status: "seated" }> {
  return authRequest(`/api/games/sessions/${sessionId}/players`, {
    method: "POST",
    body: JSON.stringify({ player_id: playerId }),
  });
}

export function addEntry(
  sessionId: string,
  input: { player_id: string; kind: EntryKind; amount_cents: number }
): Promise<{ id: number; direction: "in" | "out"; occurred_at: string }> {
  return authRequest(`/api/games/sessions/${sessionId}/entries`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function voidEntry(entryId: number): Promise<{ status: "voided" }> {
  return authRequest(`/api/games/entries/${entryId}/void`, { method: "POST" });
}

export function settlePreview(
  sessionId: string,
  mode: SettlementMode,
  bankerPlayerId?: string
): Promise<SettlementPayload> {
  const params = new URLSearchParams({ mode });
  if (bankerPlayerId) params.set("banker_player_id", bankerPlayerId);
  return authRequest(
    `/api/games/sessions/${sessionId}/settle-preview?${params.toString()}`
  );
}

export function settleSession(
  sessionId: string,
  mode: SettlementMode,
  bankerPlayerId?: string
): Promise<SettlementPayload> {
  return authRequest(`/api/games/sessions/${sessionId}/settle`, {
    method: "POST",
    body: JSON.stringify({ mode, banker_player_id: bankerPlayerId ?? null }),
  });
}

export function markSettlementPaid(
  settlementId: number,
  paid: boolean
): Promise<{ status: "paid" | "unpaid" }> {
  return authRequest(`/api/games/settlements/${settlementId}/paid`, {
    method: "POST",
    body: JSON.stringify({ paid }),
  });
}

export function reopenSession(sessionId: string): Promise<{ status: "live" }> {
  return authRequest(`/api/games/sessions/${sessionId}/reopen`, {
    method: "POST",
  });
}
