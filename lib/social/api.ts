"use client";

// FastAPI social calls. Mirrors lib/learn/api.ts: bearer token from the
// browser Supabase session, JSON in/out, `detail` surfaced on failure.

import { createClient } from "../supabase/client";
import { supabaseConfigured } from "../supabase/env";
import type {
  FriendProfile,
  FriendRequestLists,
  OwnProfile,
  ProfilePatch,
  SearchResult,
} from "./types";

export class SocialApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "SocialApiError";
  }
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!supabaseConfigured()) throw new SocialApiError("Supabase is not configured.");
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new SocialApiError("Your session expired. Sign in again.", 401);
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
      // The status is still useful when the response is not JSON.
    }
    throw new SocialApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

export function searchUsers(q: string): Promise<SearchResult[]> {
  return authRequest(`/api/users/search?q=${encodeURIComponent(q)}`);
}

export function sendFriendRequest(
  toUserId: string
): Promise<{ status: "pending" | "accepted"; request_id?: number }> {
  return authRequest("/api/friends/request", {
    method: "POST",
    body: JSON.stringify({ to_user_id: toUserId }),
  });
}

export function listFriendRequests(): Promise<FriendRequestLists> {
  return authRequest("/api/friends/requests");
}

export function respondToRequest(
  requestId: number,
  action: "accept" | "decline"
): Promise<{ status: "accepted" | "declined" }> {
  return authRequest("/api/friends/respond", {
    method: "POST",
    body: JSON.stringify({ request_id: requestId, action }),
  });
}

export function cancelRequest(requestId: number): Promise<{ status: "cancelled" }> {
  return authRequest(`/api/friends/requests/${requestId}`, { method: "DELETE" });
}

export function listFriends(): Promise<FriendProfile[]> {
  return authRequest("/api/friends");
}

export function unfriend(userId: string): Promise<{ status: "removed" }> {
  return authRequest(`/api/friends/${userId}`, { method: "DELETE" });
}

export function updateProfile(patch: ProfilePatch): Promise<OwnProfile> {
  return authRequest("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
