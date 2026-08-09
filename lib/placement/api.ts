"use client";

import { loadSupabaseClient } from "../supabase/lazyClient";
import { traceHeaders } from "../observability/clientTrace";
import { supabaseConfigured } from "../supabase/env";
import { responseTypeFor, type OptionValue } from "../drill/contract";
import type {
  PlacementAssessment,
  PlacementCompleteResult,
  PlacementResponseResult,
  PlacementState,
} from "./types";

export class PlacementApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PlacementApiError";
  }
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!supabaseConfigured()) throw new PlacementApiError("Supabase is not configured.");
  // The SDK chunk is fetched on first authenticated call, not at import
  // time (M8.8C). This function was already async and is only ever reached
  // from an effect or an event handler, so nothing above it changes shape —
  // but a static import here put 64 kB gzipped in front of hydration on
  // every route that renders a client component from this feature.
  const supabase = await loadSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new PlacementApiError("Your session expired. Sign in again.", 401);
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      // Joins this call to the page load that issued it (M8.8A). One header,
      // no request of its own — the id is already in memory.
      ...traceHeaders(),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // The status is still useful when the response is not JSON.
    }
    throw new PlacementApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, body: unknown) =>
  authRequest<T>(path, { method: "POST", body: JSON.stringify(body) });

export const getPlacementState = () =>
  authRequest<PlacementState>("/api/placement/state");

/**
 * Begin (or resume) an assessment. The seed travels client→server so the
 * questions already on screen and the row that stores the answers describe the
 * same assessment; if a row is already in progress the server returns it, seed
 * included, and the caller must re-deal from THAT seed rather than its own.
 */
export const startPlacement = (seed: number) =>
  post<PlacementAssessment>("/api/placement/start", { seed });

/** Pure request shaping, extracted so it can be unit-tested without a network. */
export function placementResponseBody(
  assessmentId: number,
  questionIndex: number,
  chosen: OptionValue,
  correct: boolean,
) {
  const responseType = responseTypeFor(chosen);
  return {
    assessment_id: assessmentId,
    question_index: questionIndex,
    // An unsure answer is never correct. The server re-derives this too.
    is_correct: responseType === "unsure" ? false : correct,
    response_type: responseType,
    answer: String(chosen),
  };
}

export const recordPlacementResponse = (
  assessmentId: number,
  questionIndex: number,
  chosen: OptionValue,
  correct: boolean,
) =>
  post<PlacementResponseResult>(
    "/api/placement/responses",
    placementResponseBody(assessmentId, questionIndex, chosen, correct),
  );

export const completePlacement = (assessmentId: number) =>
  post<PlacementCompleteResult>("/api/placement/complete", { assessment_id: assessmentId });

export const skipPlacement = (assessmentId: number) =>
  post<PlacementAssessment>("/api/placement/skip", { assessment_id: assessmentId });
