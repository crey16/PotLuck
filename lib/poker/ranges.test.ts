import test from "node:test";
import assert from "node:assert/strict";

import { dealGridHand } from "./ranges";
import { mulberry32 } from "../drill/rng";

/**
 * `dealGridHand` picks concrete suits for a grid hand like "43o". The drill
 * page renders that hand on the SERVER and then hydrates it on the CLIENT, and
 * settled decision #6 says every hand is reproducible from (seed, dealCount)
 * so the two agree.
 *
 * It did not. The suits came from `[0,1,2,3].sort(() => rng() - 0.5)`, and a
 * random comparator makes the NUMBER of rng draws depend on the comparator's
 * own results — 5 or 6 for the same array, varying by seed. Node's V8 and
 * Chrome's V8 need not order those comparisons identically, so the server and
 * the client consumed the stream differently and dealt different suits. The
 * observed symptom was a React hydration error on the preflop tab:
 *
 *   server rendered "♣", client rendered "♠"
 *
 * and because the streams desynced, every later rng() call diverged too.
 *
 * The invariant that prevents this is draw-count stability: a fixed number of
 * draws, independent of the values drawn. Fisher-Yates over 4 elements is
 * exactly 3.
 */
function countingRng(seed: number) {
  const inner = mulberry32(seed);
  let draws = 0;
  return {
    rng: () => {
      draws++;
      return inner();
    },
    draws: () => draws,
  };
}

const HANDS = ["AA", "43o", "T6s", "KQo", "76s", "22", "A5o"];

test("dealGridHand: consumes a fixed number of rng draws for every hand and seed", () => {
  const counts = new Set<number>();
  for (const hand of HANDS) {
    for (let seed = 1; seed <= 60; seed++) {
      const c = countingRng(seed);
      dealGridHand(hand, c.rng);
      counts.add(c.draws());
    }
  }
  assert.equal(
    counts.size,
    1,
    `draw count must not depend on the values drawn, or SSR and hydration ` +
      `desync — saw ${[...counts].sort().join(", ")}`,
  );
});

test("dealGridHand: same seed and hand deals the same two cards", () => {
  for (const hand of HANDS) {
    for (let seed = 1; seed <= 30; seed++) {
      const a = dealGridHand(hand, mulberry32(seed));
      const b = dealGridHand(hand, mulberry32(seed));
      assert.deepEqual(a, b, `${hand} @ ${seed}`);
    }
  }
});

test("dealGridHand: respects paired, suited and offsuit shapes", () => {
  const suitOf = (c: number) => c & 3;
  const rankOf = (c: number) => (c >> 2) + 2;
  for (let seed = 1; seed <= 60; seed++) {
    const [p1, p2] = dealGridHand("AA", mulberry32(seed));
    assert.equal(rankOf(p1), 14);
    assert.equal(rankOf(p2), 14);
    assert.notEqual(suitOf(p1), suitOf(p2), "a pair needs two different suits");

    const [s1, s2] = dealGridHand("T6s", mulberry32(seed));
    assert.equal(suitOf(s1), suitOf(s2), "suited must share a suit");
    assert.deepEqual([rankOf(s1), rankOf(s2)], [10, 6]);

    const [o1, o2] = dealGridHand("43o", mulberry32(seed));
    assert.notEqual(suitOf(o1), suitOf(o2), "offsuit must not share a suit");
    assert.deepEqual([rankOf(o1), rankOf(o2)], [4, 3]);
  }
});
