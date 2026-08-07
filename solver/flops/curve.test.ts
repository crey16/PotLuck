import test from "node:test";
import assert from "node:assert/strict";

import { readdirSync, readFileSync } from "node:fs";

import { EQUAL_WEIGHTS, loadEvTable, loadFlopWeights } from "../preflop/evtable";

/**
 * `flopClassMean` gives ONE flop's class means. It is the raw material every
 * point on the error curve is built from, and it is arithmetic that fails
 * silently: numbers that are still finite, still plausibly poker-shaped, and
 * wrong everywhere at once.
 *
 * These exist because the first implementation was wrong. It recovered a
 * flop's means by DIFFERENCE from the pooled mean and the leave-one-out mean,
 * which looks exact and is not: `comboMean` weights each flop by the hand's
 * weight in the range times the flop's weight, `classMean` then averages
 * ratios, and a board blocks different combos so the hand weights differ per
 * flop. It produced 104 chips for a hand while looking fine for most others.
 *
 * Writing these also corrected two of my own assumptions, both worth keeping
 * written down because both are natural and both are wrong. See below.
 */

const equalTable = loadEvTable("solver/ev/iter4", EQUAL_WEIGHTS);

test("a hand's EV can far exceed the STARTING pot, and that is correct", () => {
  // `expected_values` returns a share of the FINAL pot, and money goes in
  // postflop: with 975 behind, a hand that gets it in and wins is worth ~153
  // chips on a 55-chip starting pot. Asserting `value <= pot` looks like a
  // sanity check and is simply false.
  //
  // docs/14's actual invariant is about the WEIGHTED MEANS: the two players'
  // means sum to the starting pot, because that is the money in the middle
  // before anyone acts. That is asserted below.
  const bound = equalTable.pot + 2 * equalTable.stack;
  for (const player of [0, 1] as const) {
    for (let i = 0; i < equalTable.flops.length; i++) {
      const means = equalTable.flopClassMean(player, i);
      assert.equal(means.size, 169, `${equalTable.flops[i]} reported ${means.size} classes`);
      for (const [cls, value] of means) {
        assert.ok(
          Number.isFinite(value) && value >= 0 && value <= bound,
          `${equalTable.flops[i]} ${cls}: ${value} is outside [0, ${bound}]`
        );
      }
      assert.ok(
        Math.max(...means.values()) > equalTable.pot,
        `${equalTable.flops[i]}: no hand beats the starting pot, so nothing was won postflop`
      );
    }
  }
});

test("the two players' range-weighted EVs sum to the starting pot, per flop", () => {
  // docs/14's invariant, and the one that catches a sign or netting error
  // anywhere in the pipeline. It is about the RANGE-weighted mean — each hand
  // counted by its weight in the range — not the combo-count-weighted one.
  // `classMean` averages combos unweighted and so discards exactly that
  // weighting, which is why this is checked against the raw export instead of
  // against a class mean. Asserting it at the class level gives 49.71 and
  // looks like a broken invariant when it is a misapplied one.
  for (const file of readdirSync("solver/ev/iter4").filter((f) => f.endsWith(".ev.json"))) {
    const d = JSON.parse(readFileSync(`solver/ev/iter4/${file}`, "utf8")) as {
      flop: string;
      pot: number;
      players: { ev: number[]; weight: number[] }[];
    };
    let total = 0;
    for (const p of d.players) {
      let ev = 0;
      let w = 0;
      for (let i = 0; i < p.ev.length; i++) {
        ev += p.ev[i] * p.weight[i];
        w += p.weight[i];
      }
      total += ev / w;
    }
    assert.ok(
      Math.abs(total - d.pot) < 0.05,
      `${d.flop}: the two sides sum to ${total.toFixed(2)}, not the ${d.pot}-chip pot`
    );
  }
});

test("per-flop means genuinely differ between boards", () => {
  // If every flop reported the pooled mean — the plausible failure of a
  // dropped weight — the curve would report zero sampling error at every N,
  // which would look like spectacular precision.
  const a = equalTable.flopClassMean(0, 0);
  const b = equalTable.flopClassMean(0, 1);
  let differing = 0;
  for (const [cls, x] of a) {
    if (Math.abs(x - (b.get(cls) ?? x)) > 0.5) differing++;
  }
  assert.ok(differing > 50, `only ${differing}/169 classes differ between two flops`);
});

test("hand strength orders correctly POOLED, but not board by board", () => {
  // The second wrong assumption. Aces beat seven-deuce on average, and do NOT
  // beat it on every flop: on 7d6h2c, 72o has two pair and aces have one.
  // A per-board ordering assertion is not an invariant, it is a bet on the
  // boards in the sample.
  const oop = equalTable.classMean(0);
  assert.ok(oop.get("AA")! > oop.get("72o")! * 3, "pooled, aces must dominate");

  let boardsWhereTrashWins = 0;
  for (let i = 0; i < equalTable.flops.length; i++) {
    const means = equalTable.flopClassMean(0, i);
    if (means.get("72o")! > means.get("AA")!) boardsWhereTrashWins++;
  }
  assert.ok(
    boardsWhereTrashWins > 0,
    "if no board ever favours 72o over AA, the per-flop means are not board-specific"
  );
});

test("per-flop means are unaffected by unequal flop weights", () => {
  // The property the curve depends on. A single board solved once has one set
  // of class EVs; how much that board counts in a pooled average is a separate
  // choice and must not change them. This is what makes it valid to resample
  // subsets from one solved run.
  const fake = new Map(equalTable.flops.map((f, i) => [f, (i + 1) / 325]));
  const weighted = loadEvTable("solver/ev/iter4", fake);
  assert.ok(Math.max(...weighted.flopWeights) > Math.min(...weighted.flopWeights) * 5);
  for (const player of [0, 1] as const) {
    for (let i = 0; i < equalTable.flops.length; i++) {
      const a = equalTable.flopClassMean(player, i);
      const b = weighted.flopClassMean(player, i);
      for (const [cls, value] of a) {
        assert.ok(
          Math.abs(value - (b.get(cls) ?? 0)) < 1e-12,
          `${equalTable.flops[i]} ${cls}: ${value} vs ${b.get(cls)}`
        );
      }
    }
  }
});

test("pooling at combo level and averaging per-flop means are DIFFERENT estimators", () => {
  // Measured: they differ by a median of ~3 chips and up to 13. `classMean`
  // pools at the combo level weighted by each hand's weight in the range, and
  // a board blocks different combos, so those weights vary per flop.
  //
  // Pinned because it is the trap the curve nearly fell into: comparing
  // resampled subsets (per-flop averages) against `classMean` as the reference
  // would fold a systematic 0.3bb offset into every point and report it as
  // sampling error. The curve uses one estimator on both sides.
  const pooled = equalTable.classMean(0);
  const perFlop = equalTable.flops.map((_, i) => equalTable.flopClassMean(0, i));
  const deviations: number[] = [];
  for (const [cls, expected] of pooled) {
    const values = perFlop.map((m) => m.get(cls) ?? expected);
    deviations.push(Math.abs(values.reduce((a, b) => a + b, 0) / values.length - expected));
  }
  deviations.sort((a, b) => a - b);
  const median = deviations[Math.floor(deviations.length / 2)];
  assert.ok(median > 0.5, `the two estimators agree to ${median} chips — has one changed?`);
  assert.ok(median < 10, `the two estimators are ${median} chips apart, which is too far to be weighting alone`);
});

test("the published set's weights load and cover it", () => {
  const weights = loadFlopWeights("solver/flops/set-100.json");
  assert.equal(weights.size, 100);
  assert.ok(Math.abs([...weights.values()].reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
