import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { composition, stability, trueStratumWeights } from "./accuracy";
import { buildSet, stratumOfFlop } from "./flops/build";
import { EQUAL_WEIGHTS, loadEvTable, loadFlopWeights } from "./preflop/evtable";

const equalWeights = (n: number) => Array.from({ length: n }, () => 1);

test("the composition gate FAILS on the shipped 25-flop set", () => {
  // The state of the world this whole programme exists to fix. If this ever
  // passes, either the set changed or the gate stopped working — and the gate
  // silently passing is the worse of the two.
  const flops = readFileSync("solver/flops.txt", "utf8").trim().split("\n");
  const report = composition(flops, equalWeights(flops.length));
  assert.equal(report.ok, false);
  assert.ok(report.totalDeviation > 0.5, `deviation ${report.totalDeviation}`);
  assert.deepEqual(report.missing.sort(), ["rainbow/trips", "two-tone/paired"]);

  // The specific distortion: two-tone under, rainbow over.
  const row = (key: string) => report.rows.find((r) => r.stratum === key)!;
  assert.ok(row("two-tone/unpaired").ratio < 0.4, "two-tone is under-represented ~3x");
  assert.ok(row("rainbow/unpaired").ratio > 2, "rainbow is over-represented ~2x");
});

test("the composition gate PASSES on every generated set", () => {
  for (const n of [12, 25, 49, 100]) {
    const { flops } = buildSet(n);
    const report = composition(
      flops.map((f) => f.flop),
      flops.map((f) => f.weight)
    );
    assert.equal(report.ok, true, `set-${n}: deviation ${report.totalDeviation}`);
    assert.deepEqual(report.missing, [], `set-${n} left a stratum unsampled`);
    assert.ok(report.totalDeviation < 1e-9, `set-${n} deviation ${report.totalDeviation}`);
  }
});

test("weighting a badly-chosen sample does NOT rescue it", () => {
  // Worth pinning, because it is the tempting shortcut: re-weight the 25 flops
  // we already solved instead of re-solving. The weights can be made to match
  // the strata that ARE present, but a stratum with no boards in it cannot be
  // given any weight at all — its probability mass stays unrepresented.
  const flops = readFileSync("solver/flops.txt", "utf8").trim().split("\n");
  const truth = trueStratumWeights();
  const counts = new Map<string, number>();
  for (const f of flops) counts.set(stratumOfFlop(f), (counts.get(stratumOfFlop(f)) ?? 0) + 1);
  const weights = flops.map((f) => (truth.get(stratumOfFlop(f)) ?? 0) / counts.get(stratumOfFlop(f))!);

  const report = composition(flops, weights);
  assert.equal(report.ok, false, "a sample missing 8.7% of flop space cannot be reweighted into truth");
  assert.deepEqual(report.missing.sort(), ["rainbow/trips", "two-tone/paired"]);
});

test("stability reports iterations 3 to 4 as converged", () => {
  // The measurement that inverted the plan: the EVs had been stable for two
  // iterations while the roadmap called for two more.
  const previous = loadEvTable("solver/ev/iter3", EQUAL_WEIGHTS);
  const current = loadEvTable("solver/ev/iter4", EQUAL_WEIGHTS);
  const report = stability(previous, current);
  assert.equal(report.converged, true);
  assert.ok(report.medianDelta < 0.02, `median delta ${report.medianDelta}bb`);
  assert.ok(report.ratioToNoise < 0.1, `ratio ${report.ratioToNoise}`);
  // Even the WORST class moved by less than the median sampling error.
  assert.ok(report.maxDelta < 0.4, `max delta ${report.maxDelta}bb`);
});

test("stability against itself is exactly zero", () => {
  const table = loadEvTable("solver/ev/iter4", EQUAL_WEIGHTS);
  const report = stability(table, table);
  assert.equal(report.medianDelta, 0);
  assert.equal(report.maxDelta, 0);
  assert.equal(report.converged, true);
});

test("a weighted set loads, and its weights sum to one", () => {
  const weights = loadFlopWeights("solver/flops/set-100.json");
  assert.equal(weights.size, 100);
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}`);
});

test("a solved flop absent from the set is refused, not silently dropped", () => {
  // Both failure modes are silent corruption: dropping the flop shrinks the
  // sample without saying so, and defaulting it to weight 1 makes one board
  // count several hundred times what it should.
  const wrongSet = new Map([["ZzZzZz", 1]]);
  assert.throws(
    () => loadEvTable("solver/ev/iter4", wrongSet),
    /solved in .* but absent from the flop set/
  );
});
