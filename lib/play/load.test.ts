import test from "node:test";
import assert from "node:assert/strict";
import { handId, pickInstance } from "./load";
import { mulberry32 } from "../drill/rng";
import type { PlayInstance, SolveFile } from "./types";

const instance = (hero: 0 | 1): PlayInstance => ({
  hero,
  hand: "7h7d",
  bot: "QdTc",
  nodes: { "": { pre: [], a: ["X"], f: [255], l: [0], tb: [0, 0], st: 0, eq: 128 } },
  ends: { "0": { pre: [], tb: [0, 0], k: "sd" } },
});

/** Ten instances, alternating hero seats — the shape the real pack has. */
const SOLVE: SolveFile = {
  spot: "srp-btn-bb",
  flop: "Ts9s5h",
  pot: 55,
  stack: 975,
  instances: Array.from({ length: 10 }, (_, i) => instance((i % 2) as 0 | 1)),
};

test("pickInstance: honours the hero seat chosen at setup", () => {
  for (const wantHero of [0, 1] as const) {
    for (let seed = 1; seed <= 40; seed++) {
      const i = pickInstance(SOLVE, new Set(), wantHero, mulberry32(seed));
      assert.equal(
        SOLVE.instances[i].hero,
        wantHero,
        `seed ${seed}: asked for hero ${wantHero}, got ${SOLVE.instances[i].hero}`
      );
    }
  }
});

test("pickInstance: skips instances already used this session", () => {
  const used = new Set<string>();
  const seen = new Set<number>();
  const rng = mulberry32(7);
  // Five instances have hero 1; all five should come out before any repeat.
  for (let n = 0; n < 5; n++) {
    const i = pickInstance(SOLVE, used, 1, rng);
    assert.ok(!seen.has(i), `instance ${i} repeated after ${n} deals`);
    seen.add(i);
    used.add(handId(SOLVE.flop, i));
  }
  assert.equal(seen.size, 5);
});

test("pickInstance: falls back to a repeat of the right seat rather than the wrong seat", () => {
  // Everything used: the seat requirement must still hold.
  const used = new Set(SOLVE.instances.map((_, i) => handId(SOLVE.flop, i)));
  for (let seed = 1; seed <= 20; seed++) {
    const i = pickInstance(SOLVE, used, 0, mulberry32(seed));
    assert.equal(SOLVE.instances[i].hero, 0, "fell back to the wrong seat");
  }
});

test("pickInstance: a null seat preference accepts anything", () => {
  const heroes = new Set(
    Array.from({ length: 40 }, (_, seed) =>
      SOLVE.instances[pickInstance(SOLVE, new Set(), null, mulberry32(seed + 1))].hero
    )
  );
  assert.deepEqual([...heroes].sort(), [0, 1]);
});

test("pickInstance: an empty solve fails loudly rather than returning index 0", () => {
  assert.throws(() => pickInstance({ ...SOLVE, instances: [] }, new Set(), 1, mulberry32(1)));
});
