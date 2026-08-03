"use client";

// The /friends page: pending requests, the roster, and add-by-username
// search. All data flows through lib/social/api.ts; mutations update local
// state from the response and errors render inline under the acting row.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  SocialApiError,
  cancelRequest,
  listFriendRequests,
  listFriends,
  respondToRequest,
  searchUsers,
  sendFriendRequest,
  unfriend,
} from "@/lib/social/api";
import type {
  FriendProfile,
  FriendRequestLists,
  SearchResult,
} from "@/lib/social/types";

type LoadState = "loading" | "ready" | "error";

function errorMessage(e: unknown): string {
  return e instanceof SocialApiError ? e.message : "Something went wrong.";
}

function PersonPlate({
  username,
  displayName,
  level,
  streak,
  children,
}: {
  username: string;
  displayName: string | null;
  level: number;
  streak: number;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: "var(--space-3)",
        padding: "10px 0", borderBottom: "1px solid var(--color-divider)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32, height: 32, display: "grid", placeItems: "center",
          borderRadius: 999, background: "var(--color-accent)", color: "#fff",
          fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 16,
          textTransform: "uppercase", flexShrink: 0,
        }}
      >
        {username.slice(0, 1)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link href={`/u/${username}`} style={{ color: "var(--color-text)", fontWeight: 600, fontSize: 14 }}>
          {displayName ?? username}
        </Link>
        <div
          style={{
            fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".08em",
            textTransform: "uppercase",
            color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
          }}
        >
          @{username} · L{level} · {streak}d
        </div>
      </div>
      {children}
    </div>
  );
}

export function FriendsShell() {
  const [load, setLoad] = useState<LoadState>("loading");
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [requests, setRequests] = useState<FriendRequestLists>({ incoming: [], outgoing: [] });
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
  const [confirmingUnfriend, setConfirmingUnfriend] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listFriends(), listFriendRequests()])
      .then(([friendList, requestLists]) => {
        if (cancelled) return;
        setFriends(friendList);
        setRequests(requestLists);
        setLoad("ready");
      })
      .catch(() => {
        if (!cancelled) setLoad("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced search. Synchronous state changes happen in the change
  // handler (house rule: no setState inside useEffect); the effect only
  // owns the timer and the async fetch.
  function handleQueryChange(next: string) {
    setQuery(next);
    if (!next.trim()) {
      setResults([]);
      setSearching(false);
    } else {
      setSearching(true);
    }
  }

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      searchUsers(q)
        .then((rows) => {
          if (searchSeq.current !== seq) return;
          setResults(rows);
          setSearching(false);
        })
        .catch(() => {
          if (searchSeq.current !== seq) return;
          setResults([]);
          setSearching(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  async function act(key: string, action: () => Promise<void>) {
    setRowError(null);
    try {
      await action();
    } catch (e) {
      setRowError({ key, message: errorMessage(e) });
    }
  }

  function refreshLists() {
    Promise.all([listFriends(), listFriendRequests()])
      .then(([friendList, requestLists]) => {
        setFriends(friendList);
        setRequests(requestLists);
      })
      .catch(() => {
        /* keep the last known state; the next action retries */
      });
  }

  const inputStyle = {
    width: "100%",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-sm)",
    background: "var(--color-surface)",
    color: "var(--color-text)",
    fontFamily: "var(--font-body)",
    fontSize: 14,
    padding: "8px 10px",
  } as const;

  if (load === "loading") {
    return <p className="text-dim">Loading…</p>;
  }
  if (load === "error") {
    return <p className="text-dim">Could not load your friends. Refresh to retry.</p>;
  }

  const hasRequests = requests.incoming.length > 0 || requests.outgoing.length > 0;

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      {hasRequests && (
        <section className="blueprint" style={{ padding: "var(--space-4)" }}>
          <div className="mono-label" style={{ marginBottom: 6 }}>
            Requests
          </div>
          {requests.incoming.map((request) => (
            <PersonPlate
              key={`in-${request.id}`}
              username={request.user.username}
              displayName={request.user.display_name}
              level={request.user.level}
              streak={request.user.streak_count}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {rowError?.key === `in-${request.id}` && (
                  <span style={{ color: "var(--warn)", fontSize: 12 }}>{rowError.message}</span>
                )}
                <button
                  className="btn btn-primary btn-caps"
                  onClick={() =>
                    act(`in-${request.id}`, async () => {
                      await respondToRequest(request.id, "accept");
                      refreshLists();
                    })
                  }
                >
                  Accept
                </button>
                <button
                  className="btn btn-secondary btn-caps"
                  onClick={() =>
                    act(`in-${request.id}`, async () => {
                      await respondToRequest(request.id, "decline");
                      setRequests((r) => ({
                        ...r,
                        incoming: r.incoming.filter((x) => x.id !== request.id),
                      }));
                    })
                  }
                >
                  Decline
                </button>
              </div>
            </PersonPlate>
          ))}
          {requests.outgoing.map((request) => (
            <PersonPlate
              key={`out-${request.id}`}
              username={request.user.username}
              displayName={request.user.display_name}
              level={request.user.level}
              streak={request.user.streak_count}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {rowError?.key === `out-${request.id}` && (
                  <span style={{ color: "var(--warn)", fontSize: 12 }}>{rowError.message}</span>
                )}
                <span className="mono-label">Sent</span>
                <button
                  className="btn btn-secondary btn-caps"
                  onClick={() =>
                    act(`out-${request.id}`, async () => {
                      await cancelRequest(request.id);
                      setRequests((r) => ({
                        ...r,
                        outgoing: r.outgoing.filter((x) => x.id !== request.id),
                      }));
                    })
                  }
                >
                  Cancel
                </button>
              </div>
            </PersonPlate>
          ))}
        </section>
      )}

      <section className="blueprint" style={{ padding: "var(--space-4)" }}>
        <div className="mono-label" style={{ marginBottom: 6 }}>
          Friends · {friends.length}
        </div>
        {friends.length === 0 ? (
          <p className="text-dim" style={{ margin: 0 }}>
            No friends yet — find one below.
          </p>
        ) : (
          friends.map((friend) => (
            <PersonPlate
              key={friend.id}
              username={friend.username}
              displayName={friend.display_name}
              level={friend.level}
              streak={friend.streak_count}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {rowError?.key === friend.id && (
                  <span style={{ color: "var(--warn)", fontSize: 12 }}>{rowError.message}</span>
                )}
                <button
                  className={`btn btn-caps ${confirmingUnfriend === friend.id ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => {
                    if (confirmingUnfriend !== friend.id) {
                      setConfirmingUnfriend(friend.id);
                      return;
                    }
                    setConfirmingUnfriend(null);
                    act(friend.id, async () => {
                      await unfriend(friend.id);
                      setFriends((f) => f.filter((x) => x.id !== friend.id));
                    });
                  }}
                  onBlur={() => setConfirmingUnfriend((c) => (c === friend.id ? null : c))}
                >
                  {confirmingUnfriend === friend.id ? "Confirm?" : "Unfriend"}
                </button>
              </div>
            </PersonPlate>
          ))
        )}
      </section>

      <section className="blueprint" style={{ padding: "var(--space-4)" }}>
        <div className="mono-label" style={{ marginBottom: 6 }}>
          Add friends
        </div>
        <input
          style={inputStyle}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search by username"
          aria-label="Search by username"
        />
        {searching && <p className="text-dim" style={{ marginBottom: 0 }}>Searching…</p>}
        {!searching && query.trim() && results.length === 0 && (
          <p className="text-dim" style={{ marginBottom: 0 }}>No matches.</p>
        )}
        {results.map((result) => (
          <PersonPlate
            key={result.id}
            username={result.username}
            displayName={result.display_name}
            level={result.level}
            streak={result.streak_count}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {rowError?.key === result.id && (
                <span style={{ color: "var(--warn)", fontSize: 12 }}>{rowError.message}</span>
              )}
              {result.relationship === "friends" && (
                <span className="mono-label">Friends</span>
              )}
              {result.relationship === "pending_outgoing" && (
                <span className="mono-label">Requested</span>
              )}
              {(result.relationship === "none" ||
                result.relationship === "pending_incoming") && (
                <button
                  className="btn btn-primary btn-caps"
                  onClick={() =>
                    act(result.id, async () => {
                      const outcome = await sendFriendRequest(result.id);
                      setResults((rows) =>
                        rows.map((row) =>
                          row.id === result.id
                            ? {
                                ...row,
                                relationship:
                                  outcome.status === "accepted"
                                    ? "friends"
                                    : "pending_outgoing",
                              }
                            : row
                        )
                      );
                      refreshLists();
                    })
                  }
                >
                  {result.relationship === "pending_incoming" ? "Accept" : "Add"}
                </button>
              )}
            </div>
          </PersonPlate>
        ))}
      </section>
    </div>
  );
}
