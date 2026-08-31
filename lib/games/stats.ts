// Derived home-game stats. Everything here is recomputed from raw ledger
// entries on every render — no derived value is ever imported or stored as
// the only truth (docs/19: the sheet's ROI tab carried a live formula bug;
// recomputation is the fix). Transfer/settlement math is NOT here: it lives
// server-side in api/games.py so exactly one implementation exists.

export interface LedgerEntry {
  playerId: string;
  direction: "in" | "out";
  amountCents: number;
  voided: boolean;
}

export interface SessionEntries {
  sessionId: string;
  date: string; // ISO yyyy-mm-dd
  entries: LedgerEntry[];
}

export interface PlayerStatRow {
  playerId: string;
  appearances: number;
  totalInCents: number;
  totalOutCents: number;
  netCents: number;
  /** net / totalIn, or null when nothing was paid in. */
  roi: number | null;
  avgPerGameCents: number;
}

/** Rate columns hide behind this sample-size floor by default; the UI shows
 * n beside every rate and offers "show all". */
export const MIN_APPEARANCES_DEFAULT = 3;

function live(entries: LedgerEntry[]): LedgerEntry[] {
  return entries.filter((e) => !e.voided);
}

/** Net cents per player: out − in. Voided entries excluded. */
export function netByPlayer(entries: LedgerEntry[]): Map<string, number> {
  const nets = new Map<string, number>();
  for (const e of live(entries)) {
    const delta = e.direction === "out" ? e.amountCents : -e.amountCents;
    nets.set(e.playerId, (nets.get(e.playerId) ?? 0) + delta);
  }
  return nets;
}

/** Σin − Σout. Zero iff the table balances; the sign says which way it's off. */
export function sessionBalanceCents(entries: LedgerEntry[]): number {
  let balance = 0;
  for (const e of live(entries)) {
    balance += e.direction === "in" ? e.amountCents : -e.amountCents;
  }
  return balance;
}

function byDate(sessions: SessionEntries[]): SessionEntries[] {
  return [...sessions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.sessionId.localeCompare(b.sessionId)
  );
}

export function leaderboardRows(sessions: SessionEntries[]): PlayerStatRow[] {
  const rows = new Map<string, PlayerStatRow>();
  for (const session of sessions) {
    const seen = new Set<string>();
    for (const e of live(session.entries)) {
      let row = rows.get(e.playerId);
      if (!row) {
        row = {
          playerId: e.playerId,
          appearances: 0,
          totalInCents: 0,
          totalOutCents: 0,
          netCents: 0,
          roi: null,
          avgPerGameCents: 0,
        };
        rows.set(e.playerId, row);
      }
      if (!seen.has(e.playerId)) {
        seen.add(e.playerId);
        row.appearances += 1;
      }
      if (e.direction === "in") row.totalInCents += e.amountCents;
      else row.totalOutCents += e.amountCents;
    }
  }
  for (const row of rows.values()) {
    row.netCents = row.totalOutCents - row.totalInCents;
    row.roi = row.totalInCents > 0 ? row.netCents / row.totalInCents : null;
    row.avgPerGameCents =
      row.appearances > 0 ? Math.round(row.netCents / row.appearances) : 0;
  }
  return [...rows.values()].sort((a, b) => b.netCents - a.netCents);
}

/** Cumulative net over time; only sessions the player actually appeared in. */
export function cumulativeSeries(
  sessions: SessionEntries[],
  playerId: string
): { date: string; cumulativeNetCents: number }[] {
  const series: { date: string; cumulativeNetCents: number }[] = [];
  let running = 0;
  for (const session of byDate(sessions)) {
    const net = netByPlayer(session.entries).get(playerId);
    if (net === undefined) continue;
    running += net;
    series.push({ date: session.date, cumulativeNetCents: running });
  }
  return series;
}

export function deepStats(
  sessions: SessionEntries[],
  playerId: string
): {
  appearances: number;
  netCents: number;
  avgCents: number;
  biggestWinCents: number;
  biggestLossCents: number;
} {
  let appearances = 0;
  let net = 0;
  let biggestWin = 0;
  let biggestLoss = 0;
  for (const session of sessions) {
    const sessionNet = netByPlayer(session.entries).get(playerId);
    if (sessionNet === undefined) continue;
    appearances += 1;
    net += sessionNet;
    biggestWin = Math.max(biggestWin, sessionNet);
    biggestLoss = Math.min(biggestLoss, sessionNet);
  }
  return {
    appearances,
    netCents: net,
    avgCents: appearances > 0 ? Math.round(net / appearances) : 0,
    biggestWinCents: biggestWin,
    biggestLossCents: biggestLoss,
  };
}
