"use client";

// One leaderboard, sortable columns, with the sample-size honesty rules
// from docs/19: a minimum-appearances filter on by default (the sheet had
// SID leading ROI at 221% off a single night) and n shown beside every
// rate. Tapping a row expands deep stats + the profit-over-time chart.

import { useMemo, useState } from "react";
import {
  MIN_APPEARANCES_DEFAULT,
  cumulativeSeries,
  deepStats,
  leaderboardRows,
  type PlayerStatRow,
  type SessionEntries,
} from "@/lib/games/stats";
import { formatCents } from "@/lib/games/money";
import { ProfitChart } from "./ProfitChart";

type SortKey = "net" | "roi" | "avg" | "games";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "net", label: "Net" },
  { key: "roi", label: "ROI %" },
  { key: "avg", label: "Avg / game" },
  { key: "games", label: "Games" },
];

function sortValue(row: PlayerStatRow, key: SortKey): number {
  switch (key) {
    case "net":
      return row.netCents;
    case "roi":
      return row.roi ?? Number.NEGATIVE_INFINITY;
    case "avg":
      return row.avgPerGameCents;
    case "games":
      return row.appearances;
  }
}

function roiLabel(roi: number | null): string {
  return roi === null ? "—" : `${(roi * 100).toFixed(0)}%`;
}

export function GroupLeaderboard({
  sessions,
  playerNames,
}: {
  sessions: SessionEntries[];
  playerNames: Map<string, string>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("net");
  const [showAll, setShowAll] = useState(false);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

  const allRows = useMemo(() => leaderboardRows(sessions), [sessions]);
  // Rate sorts (ROI, avg) hide small samples unless "show all" is on; the
  // net and games columns are counting stats and always show everyone.
  const rateSort = sortKey === "roi" || sortKey === "avg";
  const rows = useMemo(() => {
    const filtered =
      rateSort && !showAll
        ? allRows.filter((r) => r.appearances >= MIN_APPEARANCES_DEFAULT)
        : allRows;
    return [...filtered].sort(
      (a, b) =>
        sortValue(b, sortKey) - sortValue(a, sortKey) ||
        b.netCents - a.netCents
    );
  }, [allRows, sortKey, showAll, rateSort]);

  if (allRows.length === 0) {
    return (
      <p className="text-dim" style={{ margin: 0 }}>
        The board fills in once a session is settled.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={s.key === sortKey ? "btn btn-primary" : "btn btn-ghost"}
            style={{ padding: "6px 12px" }}
            onClick={() => setSortKey(s.key)}
          >
            {s.label}
          </button>
        ))}
        {rateSort ? (
          <label className="text-dim" style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            include under {MIN_APPEARANCES_DEFAULT} games
          </label>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-dim" style={{ margin: 0 }}>
          Nobody has {MIN_APPEARANCES_DEFAULT}+ games yet — a rate needs a
          sample. Tick “include under {MIN_APPEARANCES_DEFAULT} games” to see
          everyone anyway.
        </p>
      ) : null}

      <div>
        {rows.map((row, index) => {
          const name = playerNames.get(row.playerId) ?? "Unknown";
          const open = openPlayer === row.playerId;
          const deep = open ? deepStats(sessions, row.playerId) : null;
          return (
            <div key={row.playerId} style={{ borderBottom: "1px solid var(--color-divider)" }}>
              <button
                onClick={() => setOpenPlayer(open ? null : row.playerId)}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "baseline",
                  gap: "var(--space-3)",
                  padding: "12px 0",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                  textAlign: "left",
                }}
              >
                <span className="text-dim" style={{ width: 22, flexShrink: 0 }}>{index + 1}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{name}</span>
                <span className="text-dim" style={{ fontSize: 13 }}>
                  {sortKey === "roi"
                    ? `${roiLabel(row.roi)} · ${row.appearances}g`
                    : sortKey === "avg"
                      ? `${formatCents(row.avgPerGameCents, true)}/g · ${row.appearances}g`
                      : `${row.appearances}g`}
                </span>
                <span
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 600,
                    color: row.netCents >= 0 ? "var(--good)" : "var(--crit)",
                  }}
                >
                  {formatCents(row.netCents, true)}
                </span>
              </button>
              {open && deep ? (
                <div style={{ padding: "0 0 var(--space-4) 22px", display: "grid", gap: "var(--space-3)" }}>
                  <ProfitChart series={cumulativeSeries(sessions, row.playerId)} />
                  <div className="text-dim" style={{ fontSize: 13, display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
                    <span>{deep.appearances} sessions</span>
                    <span>avg {formatCents(deep.avgCents, true)}</span>
                    <span>best {formatCents(deep.biggestWinCents, true)}</span>
                    <span>worst {formatCents(deep.biggestLossCents, true)}</span>
                    <span>
                      ROI {roiLabel(row.roi)} (n={row.appearances})
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
