"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HandReview } from "./HandReview";
import {
  getPlayHand,
  listPlayHands,
  listPlaySessions,
  updatePlayHand,
  type PlayHandReview,
  type PlayHandSummary,
  type PlaySession,
} from "@/lib/play/api";
import { displayCards, statusCopy } from "@/lib/play/history";

interface RecentState {
  sessions: PlaySession[];
  hands: PlayHandSummary[];
}

function timeLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function HistoryHeader({ detail = false }: { detail?: boolean }) {
  return (
    <div className="switcher">
      <div className="left">
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span className="mono-label accent" style={{ letterSpacing: ".12em" }}>
            PLAY — DURABLE HISTORY
          </span>
          <span
            style={{
              fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 24,
              lineHeight: 1.05, letterSpacing: ".02em", textTransform: "uppercase",
            }}
          >
            {detail ? "Saved hand review" : "Recent solver hands"}
          </span>
        </div>
      </div>
      <div className="right">
        <Link className="btn btn-secondary btn-caps" href="/play">Back to play</Link>
      </div>
    </div>
  );
}

function LoadFailure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="blueprint" style={{ padding: "var(--space-6)" }}>
      <h2 style={{ fontSize: 25 }}>History unavailable</h2>
      <p className="text-dim">{message}</p>
      <button className="btn btn-secondary btn-caps" onClick={retry}>Try again</button>
    </div>
  );
}

export function RecentPlayHistory() {
  const [state, setState] = useState<RecentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void listPlaySessions(20)
      .then(async (sessions) => {
        const groups = await Promise.all(sessions.map((session) => listPlayHands(session.id, 50)));
        if (cancelled) return;
        const hands = groups.flat().sort((a, b) =>
          new Date(b.started_at).valueOf() - new Date(a.started_at).valueOf()
        );
        setState({ sessions, hands });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const sessionById = useMemo(
    () => new Map(state?.sessions.map((session) => [session.id, session]) ?? []),
    [state]
  );

  return (
    <main className="page">
      <HistoryHeader />
      {error ? (
        <LoadFailure
          message={error}
          retry={() => {
            setError(null);
            setState(null);
            setReloadKey((key) => key + 1);
          }}
        />
      ) : !state ? (
        <div className="blueprint" style={{ padding: "var(--space-6)" }}>Loading saved hands…</div>
      ) : state.hands.length === 0 ? (
        <div className="blueprint" style={{ padding: "var(--space-6)" }}>
          <h2 style={{ fontSize: 27 }}>No saved hands yet</h2>
          <p className="text-dim">Play a hand and each decision will appear here after the server grades it.</p>
          <Link className="btn btn-primary blueprint btn-caps" href="/play">Deal a hand</Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          {state.hands.map((hand) => {
            const session = sessionById.get(hand.session_id);
            return (
              <Link
                key={hand.id}
                href={`/play/history/${encodeURIComponent(hand.id)}`}
                className="blueprint"
                style={{
                  padding: "var(--space-4)", color: "var(--color-text)",
                  display: "grid", gridTemplateColumns: "minmax(180px, 1fr) auto",
                  alignItems: "center", gap: "var(--space-4)",
                }}
              >
                <div>
                  <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    <span className="mono-label accent">{statusCopy(hand.status)}</span>
                    <span className="mono-label">{hand.hero_position} vs {hand.opponent_positions.join(" / ")}</span>
                  </div>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 24 }}>
                    {displayCards(hand.hero_cards)} · {displayCards([
                      ...hand.initial_board_cards,
                      ...hand.runout_cards,
                    ])}
                  </div>
                  <div className="text-dim" style={{ fontSize: 12.5 }}>
                    {timeLabel(hand.started_at)} · {session?.config.solution_version ?? hand.solve_pack_id}
                    {session ? ` · ${statusCopy(session.status).toLowerCase()} session` : ""}
                  </div>
                </div>
                <span className="btn btn-secondary btn-caps">Review</span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

export function SavedHandReview({ handId }: { handId: string }) {
  const [review, setReview] = useState<PlayHandReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [abandoning, setAbandoning] = useState(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPlayHand(handId)
      .then((result) => { if (!cancelled) setReview(result); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, [handId, reloadKey]);

  const abandon = useCallback(async () => {
    if (!review || review.status !== "incomplete") return;
    setAbandoning(true);
    setError(null);
    try {
      const abandoned = await updatePlayHand(review.id, "abandoned");
      setReview((current) => current ? { ...current, ...abandoned, decisions: current.decisions } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAbandoning(false);
    }
  }, [review]);

  const complete = useCallback(async () => {
    if (!review || review.status !== "incomplete") return;
    setCompleting(true);
    setError(null);
    try {
      const completed = await updatePlayHand(review.id, "completed");
      setReview((current) => current ? { ...current, ...completed, decisions: current.decisions } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCompleting(false);
    }
  }, [review]);

  return (
    <main className="page">
      <HistoryHeader detail />
      {error && !review ? (
        <LoadFailure
          message={error}
          retry={() => {
            setError(null);
            setReview(null);
            setReloadKey((key) => key + 1);
          }}
        />
      ) : !review ? (
        <div className="blueprint" style={{ padding: "var(--space-6)" }}>Loading hand review…</div>
      ) : (
        <>
          {error && <div className="note critl" style={{ margin: "0 0 var(--space-4)" }}>{error}</div>}
          <HandReview
            review={review}
            abandoning={abandoning}
            completing={completing}
            onAbandon={abandon}
            onComplete={complete}
          />
        </>
      )}
    </main>
  );
}
