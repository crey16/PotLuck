import test from "node:test";
import assert from "node:assert/strict";

import { allocateFlops, subgameReach, type SubgameReach } from "./reach";
import { solve, N_CLASSES, PRIOR, type TerminalValuer } from "./preflop/cfr";
import { POS, type Terminal } from "./preflop/tree";

/**
 * A deliberately trivial valuer so these tests exercise the reach ARITHMETIC
 * rather than the equity table. Eight iterations is enough for a strategy to
 * exist; none of these assertions depend on it being a good one.
 */
const flat: TerminalValuer = (t: Terminal, player) => {
  const pot = POS.reduce((s, p) => s + t.contrib[p], 0);
  const mine = -t.contrib[player];
  if (t.live.length === 1) return mine + (t.live[0] === player ? pot : 0);
  return mine + pot / t.live.length;
};

const result = solve({ iterations: 8, valuer: flat });
const reach = subgameReach(result);

test("every postflop subgame the tree can reach is reported", () => {
  assert.equal(reach.length, 60, "the pruned tree has 60 postflop subgames");
  assert.equal(new Set(reach.map((r) => r.subgame)).size, 60);
  assert.equal(reach.filter((r) => r.level === 1).length, 15);
  assert.equal(reach.filter((r) => r.level === 2).length, 45);
});

test("reach probabilities are probabilities, and sum to less than one", () => {
  // Most hands never reach a postflop subgame at all — they end preflop, in a
  // walk, an uncontested pot or a called 4-bet. A total at or above 1 would
  // mean the walk is double-counting a path.
  let total = 0;
  for (const r of reach) {
    assert.ok(r.probability >= 0 && r.probability <= 1, `${r.subgame}: ${r.probability}`);
    total += r.probability;
  }
  assert.ok(total > 0, "no subgame is ever reached");
  assert.ok(total < 1, `postflop reach sums to ${total}, which cannot exceed 1`);
});

test("results are sorted by traffic, heaviest first", () => {
  for (let i = 1; i < reach.length; i++) {
    assert.ok(reach[i - 1].probability >= reach[i].probability);
  }
});

test("the out-of-position player really is out of position", () => {
  // Postflop order is SB, BB, UTG, HJ, CO, BTN — the blinds act last preflop
  // and FIRST postflop. Getting this backwards swaps the two ranges in every
  // solve, which is the bug tree.ts's POSTFLOP_ORDER comment exists to
  // prevent, so it is worth re-asserting from the reach side.
  const order = ["SB", "BB", "UTG", "HJ", "CO", "BTN"];
  for (const r of reach) {
    assert.ok(
      order.indexOf(r.ip) > order.indexOf(r.oop),
      `${r.subgame}: ${r.ip} is not in position on ${r.oop}`
    );
  }
});

test("a 3-bet pot is reached less often than the single-raised pot it came from", () => {
  // Structural, and true under any strategy: reaching a 3-bet pot requires
  // everything a single-raised pot requires and then a 3-bet on top.
  const level1 = reach.filter((r) => r.level === 1).reduce((s, r) => s + r.probability, 0);
  const level2 = reach.filter((r) => r.level === 2).reduce((s, r) => s + r.probability, 0);
  assert.ok(level1 > level2, `level 1 ${level1} should exceed level 2 ${level2}`);
});

/* ------------------------------------------------------------------ *
 * Allocation
 * ------------------------------------------------------------------ */

const fake = (probabilities: number[]): SubgameReach[] =>
  probabilities.map((probability, i) => ({
    subgame: `s${i}`,
    probability,
    level: 1,
    oop: "BB" as const,
    ip: "BTN" as const,
  }));

test("allocation spends the budget and never starves a subgame", () => {
  const spread = fake([0.5, 0.2, 0.1, 0.1, 0.05, 0.05]);
  const allocation = allocateFlops(spread, 600, 12);
  assert.equal([...allocation.values()].reduce((a, b) => a + b, 0), 600);
  for (const [key, n] of allocation) {
    assert.ok(n >= 12, `${key} got ${n}, below the floor`);
  }
  // More traffic must never get fewer flops.
  assert.ok(allocation.get("s0")! > allocation.get("s5")!);
});

test("a budget too small for the floor is refused, not quietly rationed", () => {
  // Silently dropping below the floor would leave a subgame with an error
  // nobody can estimate, which the preflop step cannot price around.
  assert.throws(() => allocateFlops(fake([0.5, 0.5]), 10, 12), /cannot give/);
});

test("a subgame with no traffic still gets its floor", () => {
  const allocation = allocateFlops(fake([1, 0]), 120, 12);
  assert.equal(allocation.get("s1"), 12);
  assert.ok(allocation.get("s0")! > 12);
});

test("damping keeps a wrong estimate from starving 59 subgames", () => {
  // The measured failure mode: the bootstrap valuer puts 50% of postflop
  // traffic in one subgame, which a proportional allocation turns into a 30x
  // swing. A structural check says the real ratio is nearer 1.2x, so the
  // allocation must not be that confident in an estimate we know is loose.
  const lopsided = fake([0.5, ...Array.from({ length: 59 }, () => 0.5 / 59)]);
  const damped = allocateFlops(lopsided, 3000, 12);
  const proportional = allocateFlops(lopsided, 3000, 12, 1);

  const spread = (a: Map<string, number>) =>
    Math.max(...a.values()) / Math.min(...a.values());
  assert.ok(
    spread(damped) < spread(proportional) / 3,
    `damped spread ${spread(damped).toFixed(1)}x vs proportional ${spread(proportional).toFixed(1)}x`
  );
  // It still sends materially more compute where the traffic is.
  assert.ok(damped.get("s0")! > damped.get("s1")! * 2);
  // And it still spends the whole budget exactly.
  assert.equal([...damped.values()].reduce((a, b) => a + b, 0), 3000);
});

test("the allocation always sums to the budget exactly", () => {
  // Rounding each share independently drifts by a few solves, which is
  // harmless until someone sizes a machine rental from the total.
  for (const budget of [800, 1500, 3000, 5000]) {
    for (const exponent of [0.5, 1]) {
      const allocation = allocateFlops(reach, budget, 12, exponent);
      assert.equal(
        [...allocation.values()].reduce((a, b) => a + b, 0),
        budget,
        `budget ${budget}, exponent ${exponent}`
      );
    }
  }
});
