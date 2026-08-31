// Every leaderboard/summary number is recomputed from ledger entries here —
// never imported from a derived source. The sheet's ROI tab shipped a live
// formula bug (VISHNU reading -1 instead of -100.00%); recomputation is the
// fix, and these tests pin the semantics.

import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_APPEARANCES_DEFAULT,
  cumulativeSeries,
  deepStats,
  leaderboardRows,
  netByPlayer,
  sessionBalanceCents,
  type SessionEntries,
} from "./stats";

function entry(
  playerId: string,
  direction: "in" | "out",
  amountCents: number,
  voided = false
) {
  return { playerId, direction, amountCents, voided };
}

const balancedNight: SessionEntries = {
  sessionId: "s1",
  date: "2026-07-23",
  entries: [
    entry("a", "in", 6000),
    entry("a", "in", 10000), // rebuy
    entry("a", "out", 20000),
    entry("b", "in", 6000),
    entry("b", "out", 2000),
  ],
};

test("netByPlayer is out minus in, voided excluded", () => {
  const nets = netByPlayer(balancedNight.entries);
  assert.equal(nets.get("a"), 4000);
  assert.equal(nets.get("b"), -4000);

  const withVoid = netByPlayer([
    entry("a", "in", 6000),
    entry("a", "in", 9999, true), // voided rebuy must not count
    entry("a", "out", 6000),
  ]);
  assert.equal(withVoid.get("a"), 0);
});

test("sessionBalanceCents is zero iff the table balances", () => {
  assert.equal(sessionBalanceCents(balancedNight.entries), 0);
  // A missing $20 cash-out shows up as +2000 (more in than out).
  assert.equal(
    sessionBalanceCents([entry("a", "in", 6000), entry("a", "out", 4000)]),
    2000
  );
});

test("an unbalanced session still yields nets — balance is surfaced separately", () => {
  const nets = netByPlayer([entry("a", "in", 6000), entry("a", "out", 4000)]);
  assert.equal(nets.get("a"), -2000);
});

test("leaderboardRows aggregates across sessions", () => {
  const secondNight: SessionEntries = {
    sessionId: "s2",
    date: "2026-07-30",
    entries: [
      entry("a", "in", 6000),
      entry("a", "out", 2000),
      entry("c", "in", 6000),
      entry("c", "out", 10000),
    ],
  };
  const rows = leaderboardRows([balancedNight, secondNight]);
  const a = rows.find((r) => r.playerId === "a")!;
  assert.equal(a.appearances, 2);
  assert.equal(a.totalInCents, 22000);
  assert.equal(a.totalOutCents, 22000);
  assert.equal(a.netCents, 0);
  assert.equal(a.roi, 0);
  assert.equal(a.avgPerGameCents, 0);

  const c = rows.find((r) => r.playerId === "c")!;
  assert.equal(c.appearances, 1);
  assert.equal(c.netCents, 4000);
  assert.ok(Math.abs((c.roi ?? 0) - 4000 / 6000) < 1e-12);
  assert.equal(c.avgPerGameCents, 4000);
});

test("a player whose only entries are voided did not appear", () => {
  const rows = leaderboardRows([
    {
      sessionId: "s1",
      date: "2026-07-23",
      entries: [
        entry("a", "in", 6000),
        entry("a", "out", 6000),
        entry("ghost", "in", 6000, true),
      ],
    },
  ]);
  assert.equal(rows.some((r) => r.playerId === "ghost"), false);
});

test("ROI is null when nothing was paid in, never a fake number", () => {
  const rows = leaderboardRows([
    {
      sessionId: "s1",
      date: "2026-07-23",
      entries: [entry("freeroller", "out", 5000)],
    },
  ]);
  assert.equal(rows[0].roi, null);
});

test("the SID case: one huge-ROI session ranks but is filterable by sample size", () => {
  // SID: one session, 221% ROI. The row exists; the min-appearances filter
  // (applied by the UI with this default) is what keeps it honest.
  const rows = leaderboardRows([
    {
      sessionId: "s1",
      date: "2026-08-01",
      entries: [entry("sid", "in", 6800), entry("sid", "out", 21800)],
    },
  ]);
  assert.equal(rows[0].appearances, 1);
  assert.ok((rows[0].roi ?? 0) > 2.2);
  assert.ok(MIN_APPEARANCES_DEFAULT > 1);
});

test("cumulativeSeries walks sessions in date order, only nights played", () => {
  const s2: SessionEntries = {
    sessionId: "s2",
    date: "2026-07-30",
    entries: [entry("a", "in", 6000), entry("a", "out", 3000)],
  };
  // Handed over out of order on purpose.
  const series = cumulativeSeries([s2, balancedNight], "a");
  assert.deepEqual(series, [
    { date: "2026-07-23", cumulativeNetCents: 4000 },
    { date: "2026-07-30", cumulativeNetCents: 1000 },
  ]);
  assert.deepEqual(cumulativeSeries([balancedNight], "nobody"), []);
});

test("deepStats reports biggest win and loss", () => {
  const sessions: SessionEntries[] = [
    balancedNight, // a: +4000
    {
      sessionId: "s2",
      date: "2026-07-30",
      entries: [entry("a", "in", 20000), entry("a", "out", 5000)],
    }, // a: -15000
    {
      sessionId: "s3",
      date: "2026-08-06",
      entries: [entry("a", "in", 6000), entry("a", "out", 12000)],
    }, // a: +6000
  ];
  const d = deepStats(sessions, "a");
  assert.equal(d.appearances, 3);
  assert.equal(d.netCents, -5000);
  assert.equal(d.biggestWinCents, 6000);
  assert.equal(d.biggestLossCents, -15000);
  assert.equal(d.avgCents, Math.round(-5000 / 3));
});
