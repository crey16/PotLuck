"use client";

import { createClient } from "../supabase/client";
import { supabaseConfigured } from "../supabase/env";
import { PLAY_SOLVE_PACK_ID } from "./constants";
import type { StoppingPoint } from "./setup";

export { PLAY_SOLVE_PACK_ID } from "./constants";

/**
 * Public identity of the only solve pack currently shipped in /public/solves.
 * The value is versioned because persisted hands must never be reinterpreted
 * against a future export of the same spot.
 */
export type PlayStatus = "incomplete" | "completed" | "abandoned";
export type PlayStreet = "preflop" | "flop" | "turn" | "river";
export type PlayGradingSource = "solver" | "reference" | "ungraded";
export type PlayGradingStatus =
  | "validated"
  | "reference_graded"
  | "legacy_unverified"
  | "ungraded";

/**
 * Frozen configuration returned with history. This deliberately describes
 * archived snapshots rather than only today's pack: the M8 backfill has its
 * own profile/version and marks advanced_settings. Writes use the strict
 * CreatePlayConfiguration below.
 */
export interface PlayConfiguration {
  solution_profile_id: string;
  solution_version: string;
  table_size: number;
  hero_positions: string[];
  matchup_positions: string[];
  starting_spot: string;
  action_family_filters: string[];
  stack_depth_bb: number;
  rake_model: string;
  ev_model: string;
  advanced_settings: Record<string, unknown>;
}

/** The only configuration accepted for a newly-created M8 session. */
export interface CreatePlayConfiguration {
  solution_profile_id: "cash-6max-chip-ev";
  solution_version: "m6-v1";
  table_size: 6;
  /** M8 freezes the only configuration published by the current solve pack. */
  hero_positions: ["BTN", "BB"];
  matchup_positions: ["BTN", "BB"];
  starting_spot: "preflop";
  /**
   * How far each hand runs — M8.7C. Distinct from `starting_spot`: that is
   * where a hand BEGINS, this is where it ENDS. The server treats it as
   * frozen session configuration and decides completion from it, so it can
   * never be supplied per hand.
   */
  stopping_point: StoppingPoint;
  action_family_filters: ["single_raised_pot"];
  stack_depth_bb: 100;
  rake_model: "none";
  ev_model: "chip_ev";
  advanced_settings: Record<string, never>;
}

export const DEFAULT_PLAY_CONFIGURATION: CreatePlayConfiguration = {
  solution_profile_id: "cash-6max-chip-ev",
  solution_version: "m6-v1",
  table_size: 6,
  hero_positions: ["BTN", "BB"],
  matchup_positions: ["BTN", "BB"],
  starting_spot: "preflop",
  stopping_point: "river",
  action_family_filters: ["single_raised_pot"],
  stack_depth_bb: 100,
  rake_model: "none",
  ev_model: "chip_ev",
  advanced_settings: {},
};

export interface CreatePlaySessionBody {
  client_session_id: string;
  solve_pack_id: string;
  config: CreatePlayConfiguration;
}

export interface CreatePlayHandBody {
  client_hand_id: string;
  flop: string;
  instance_index: number;
}

export interface CreatePlayDecisionBody {
  client_decision_id: string;
  node_path: string;
  chosen_action_code: string;
}

export interface PlaySession {
  id: string;
  client_session_id: string;
  solve_pack_id: string;
  status: PlayStatus;
  config: PlayConfiguration;
  started_at: string;
  last_activity_at: string;
  completed_at: string | null;
  abandoned_at: string | null;
  hand_count?: number;
  completed_hand_count?: number;
  decision_count?: number;
  total_ev_loss_bb?: number;
}

export interface PlayHandSummary {
  id: string;
  session_id: string;
  client_hand_id: string;
  source_hand_id: string;
  solve_pack_id: string;
  status: PlayStatus;
  hand_index: number;
  hero_position: string;
  opponent_positions: string[];
  spot: string;
  stack_depth_bb: number;
  starting_street: PlayStreet;
  starting_node_id: string;
  hero_cards: string[];
  opponent_cards: Record<string, unknown>;
  initial_board_cards: string[];
  runout_cards: string[];
  action_history_snapshot: unknown[];
  deal_snapshot: Record<string, unknown>;
  result_snapshot: Record<string, unknown> | null;
  started_at: string;
  last_activity_at: string;
  completed_at: string | null;
  abandoned_at: string | null;
  decision_count?: number;
  total_ev_loss_bb?: number;
  blunder_count?: number;
}

export interface PlayActionReview {
  decision_id: string;
  action_code: string;
  ordinal: number;
  action_label: string;
  action_kind: string;
  amount_bb: number | null;
  frequency: number | null;
  ev_bb: number | null;
  ev_delta_bb: number | null;
  ev_loss_bb: number | null;
  is_chosen: boolean;
  created_at: string;
}

export interface PlayDecisionReview {
  id: string;
  hand_id: string;
  client_decision_id: string;
  attempt_id: number | null;
  solve_pack_id: string;
  decision_index: number;
  solve_node_id: string;
  street: PlayStreet;
  position: string;
  spot: string;
  stack_depth_bb: number;
  board_cards: string[];
  board_texture: string | null;
  hand_class: string | null;
  action_context: Record<string, unknown>;
  chosen_action_code: string;
  grading_source: PlayGradingSource;
  grading_status: PlayGradingStatus;
  grading_version: string | null;
  chosen_frequency: number | null;
  ev_basis: "absolute" | "relative_to_best" | "unknown";
  chosen_ev_bb: number | null;
  best_ev_bb: number | null;
  ev_loss_bb: number | null;
  verdict: "correct" | "acceptable" | "inaccuracy" | "blunder" | "ungraded";
  is_correct: boolean | null;
  alternatives_complete: boolean;
  occurred_at: string;
  actions: PlayActionReview[];
  created_at: string;
  xp_earned?: number;
}

export interface PlayHandReview extends PlayHandSummary {
  decisions: PlayDecisionReview[];
}

export class PlayApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PlayApiError";
  }
}

/** Client-generated UUIDs are the idempotency identities accepted by the API. */
export function newPlayClientId(): string {
  return globalThis.crypto.randomUUID();
}

export function sourceHandId(flop: string, index: number): string {
  return `${PLAY_SOLVE_PACK_ID}/${flop}#${index}`;
}

/** Pure request builders keep authoritative grading fields out of the browser request. */
export function buildPlaySessionBody(
  clientSessionId: string,
  stoppingPoint: StoppingPoint = "river"
): CreatePlaySessionBody {
  return {
    client_session_id: clientSessionId,
    solve_pack_id: PLAY_SOLVE_PACK_ID,
    // The stopping point is the one part of the configuration the player can
    // currently move, so it is threaded through rather than defaulted away.
    // It is frozen on the session at creation: changing it mid-session would
    // silently restate what earlier hands in that session were.
    config: { ...DEFAULT_PLAY_CONFIGURATION, stopping_point: stoppingPoint },
  };
}

export function buildPlayHandBody(
  clientHandId: string,
  flop: string,
  index: number
): CreatePlayHandBody {
  return {
    client_hand_id: clientHandId,
    flop,
    instance_index: index,
  };
}

export function buildPlayDecisionBody(
  clientDecisionId: string,
  nodePath: string,
  chosenActionCode: string
): CreatePlayDecisionBody {
  return {
    client_decision_id: clientDecisionId,
    node_path: nodePath,
    chosen_action_code: chosenActionCode,
  };
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!supabaseConfigured()) {
    throw new PlayApiError("Supabase is not configured.");
  }
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new PlayApiError("Sign in to save and review hands.", 401);

  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // The status remains useful for non-JSON failures.
    }
    throw new PlayApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

export function createPlaySession(
  clientSessionId: string,
  stoppingPoint: StoppingPoint = "river"
): Promise<PlaySession> {
  return authRequest("/api/play/sessions", {
    method: "POST",
    body: JSON.stringify(buildPlaySessionBody(clientSessionId, stoppingPoint)),
  });
}

export function createPlayHand(
  sessionId: string,
  clientHandId: string,
  flop: string,
  index: number
): Promise<PlayHandSummary> {
  return authRequest(`/api/play/sessions/${encodeURIComponent(sessionId)}/hands`, {
    method: "POST",
    body: JSON.stringify(buildPlayHandBody(clientHandId, flop, index)),
  });
}

export function createPlayDecision(
  handId: string,
  body: CreatePlayDecisionBody
): Promise<PlayDecisionReview> {
  return authRequest(`/api/play/hands/${encodeURIComponent(handId)}/decisions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updatePlayHand(
  handId: string,
  status: "completed" | "abandoned"
): Promise<PlayHandSummary> {
  return authRequest(`/api/play/hands/${encodeURIComponent(handId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function updatePlaySession(
  sessionId: string,
  status: "completed" | "abandoned"
): Promise<PlaySession> {
  return authRequest(`/api/play/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function listPlaySessions(limit = 20): Promise<PlaySession[]> {
  const result = await authRequest<{ sessions: PlaySession[] }>(
    `/api/play/sessions?limit=${encodeURIComponent(String(limit))}`
  );
  return result.sessions;
}

export async function listPlayHands(sessionId: string, limit = 50): Promise<PlayHandSummary[]> {
  const result = await authRequest<{ hands: PlayHandSummary[] }>(
    `/api/play/sessions/${encodeURIComponent(sessionId)}/hands?limit=${encodeURIComponent(String(limit))}`
  );
  return result.hands;
}

export function getPlayHand(handId: string): Promise<PlayHandReview> {
  return authRequest(`/api/play/hands/${encodeURIComponent(handId)}`);
}
