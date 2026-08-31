"use client";

// The settle-up flow: choose a mode, preview the transfers, settle, then
// tick payments off. Transfer math is server-side only (api/games.py) —
// this component displays what the API returns and never recomputes it.
//
// Copy rule from docs/19: the netting mode is "Fewest payments", never
// "minimum" — the greedy is near-minimal and the label must stay true.

import { useState } from "react";
import {
  GamesApiError,
  markSettlementPaid,
  reopenSession,
  settlePreview,
  settleSession,
} from "@/lib/games/api";
import { formatCents } from "@/lib/games/money";
import type {
  SettlementMode,
  SettlementPayload,
  SettlementRecord,
} from "@/lib/games/types";

function errorMessage(e: unknown): string {
  return e instanceof GamesApiError ? e.message : "Something went wrong.";
}

export function UnbalancedBanner({ balanceCents }: { balanceCents: number }) {
  return (
    <div
      className="blueprint"
      style={{
        padding: "var(--space-3) var(--space-4)",
        borderColor: "var(--crit)",
        background: "var(--crit-fill)",
      }}
    >
      <strong style={{ color: "var(--crit)" }}>
        The ledger doesn’t balance:{" "}
        {balanceCents > 0
          ? `${formatCents(balanceCents)} more went in than came out`
          : `${formatCents(-balanceCents)} more came out than went in`}
        .
      </strong>
      <p style={{ margin: "4px 0 0", fontSize: 13 }}>
        Someone’s buy-in or cash-out is missing or wrong. Fix the entries —
        settling is blocked until the table counts to zero.
      </p>
    </div>
  );
}

export function SettlePanel({
  sessionId,
  balanced,
  balanceCents,
  awaitingCashouts,
  players,
  playerNames,
  onSettled,
}: {
  sessionId: string;
  balanced: boolean;
  balanceCents: number;
  /** Someone seated has no cash-out yet — chips are still on the table, so
   * an unbalanced ledger is the normal mid-game state, not an error. */
  awaitingCashouts: boolean;
  players: string[]; // seated player ids
  playerNames: Map<string, string>;
  onSettled: () => Promise<void>;
}) {
  const [mode, setMode] = useState<SettlementMode>("banker");
  const [banker, setBanker] = useState<string | null>(null);
  const [preview, setPreview] = useState<SettlementPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = mode === "fewest_transfers" || banker !== null;

  async function onPreview() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await settlePreview(sessionId, mode, banker ?? undefined));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSettle() {
    if (!ready || !balanced || busy) return;
    setBusy(true);
    setError(null);
    try {
      await settleSession(sessionId, mode, banker ?? undefined);
      await onSettled();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="blueprint" style={{ padding: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
      <strong>Settle up</strong>
      {!balanced ? (
        awaitingCashouts ? (
          <p className="text-dim" style={{ margin: 0, fontSize: 13 }}>
            {formatCents(Math.abs(balanceCents))} still on the table — record
            everyone’s cash-out to settle the night.
          </p>
        ) : (
          // Everyone is cashed out and it still doesn't count to zero: a
          // real counting error, surfaced, never silently absorbed.
          <UnbalancedBanner balanceCents={balanceCents} />
        )
      ) : null}
      <div style={{ display: "flex", gap: 2 }}>
        <button
          className={`btn btn-caps ${mode === "banker" ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={mode === "banker"}
          style={{ flex: 1 }}
          onClick={() => {
            setMode("banker");
            setPreview(null);
          }}
        >
          Banker
        </button>
        <button
          className={`btn btn-caps ${mode === "fewest_transfers" ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={mode === "fewest_transfers"}
          style={{ flex: 1 }}
          onClick={() => {
            setMode("fewest_transfers");
            setPreview(null);
          }}
        >
          Fewest payments
        </button>
      </div>
      {mode === "banker" ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {players.map((pid) => (
            <button
              key={pid}
              className={`btn ${banker === pid ? "btn-primary" : "btn-secondary"}`}
              aria-pressed={banker === pid}
              style={{ padding: "6px 12px" }}
              onClick={() => {
                setBanker(pid);
                setPreview(null);
              }}
            >
              {playerNames.get(pid) ?? "?"}
            </button>
          ))}
          {banker === null ? (
            <span className="text-dim" style={{ fontSize: 13, alignSelf: "center" }}>
              Everyone pays — or is paid by — the banker.
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-dim" style={{ margin: 0, fontSize: 13 }}>
          The fewest payments that square everyone with everyone.
        </p>
      )}

      {preview ? (
        <div style={{ display: "grid", gap: 6 }}>
          {preview.transfers.length === 0 ? (
            <p className="text-dim" style={{ margin: 0 }}>Everyone is exactly even. No payments needed.</p>
          ) : (
            preview.transfers.map((t, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
                <span>
                  {playerNames.get(t.from_player_id) ?? "?"} →{" "}
                  {playerNames.get(t.to_player_id) ?? "?"}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatCents(t.amount_cents)}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}

      {error ? <p style={{ margin: 0, color: "var(--crit)" }}>{error}</p> : null}

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <button className="btn btn-ghost" disabled={!ready || busy} onClick={() => void onPreview()}>
          Preview
        </button>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={!ready || !balanced || busy}
          onClick={() => void onSettle()}
        >
          Settle the night
        </button>
      </div>
    </div>
  );
}

export function SettlementList({
  settlements,
  playerNames,
  canReopen,
  sessionId,
  onChanged,
}: {
  settlements: SettlementRecord[];
  playerNames: Map<string, string>;
  canReopen: boolean;
  sessionId: string;
  onChanged: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mode = settlements[0]?.mode;

  async function togglePaid(s: SettlementRecord) {
    setBusyId(s.id);
    setError(null);
    try {
      await markSettlementPaid(s.id, s.paid_at === null);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="blueprint" style={{ padding: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>Who pays whom</strong>
        {mode ? (
          <span className="tag tag-neutral">
            {mode === "banker" ? "banker" : "fewest payments"}
          </span>
        ) : null}
      </div>
      {settlements.length === 0 ? (
        <p className="text-dim" style={{ margin: 0 }}>
          Everyone finished exactly even. No payments were needed.
        </p>
      ) : (
        settlements.map((s) => {
          const paid = s.paid_at !== null;
          return (
            <button
              key={s.id}
              disabled={busyId === s.id}
              onClick={() => void togglePaid(s)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                padding: "10px 0",
                background: "none",
                border: "none",
                borderBottom: "1px solid var(--color-divider)",
                font: "inherit",
                color: "inherit",
                cursor: "pointer",
                textAlign: "left",
                opacity: paid ? 0.6 : 1,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  borderRadius: 6,
                  border: `2px solid ${paid ? "var(--good)" : "var(--color-divider)"}`,
                  display: "grid",
                  placeItems: "center",
                  color: "var(--good)",
                  fontSize: 14,
                }}
              >
                {paid ? "✓" : ""}
              </span>
              <span style={{ flex: 1, textDecoration: paid ? "line-through" : "none" }}>
                {playerNames.get(s.from_player_id) ?? "?"} pays{" "}
                {playerNames.get(s.to_player_id) ?? "?"}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                {formatCents(s.amount_cents)}
              </span>
            </button>
          );
        })
      )}
      {error ? <p style={{ margin: 0, color: "var(--crit)" }}>{error}</p> : null}
      {canReopen ? (
        <button
          className="btn btn-ghost"
          onClick={() => {
            void reopenSession(sessionId)
              .then(onChanged)
              .catch((e) => setError(errorMessage(e)));
          }}
        >
          Reopen to correct the ledger
        </button>
      ) : null}
    </div>
  );
}
