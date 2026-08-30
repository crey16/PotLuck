import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { composition, flopsAbsentFromSet, stability, trueStratumWeights } from "./accuracy";
import { buildSet, stratumOfFlop } from "./flops/build";
import { EQUAL_WEIGHTS, loadEvTable, loadFlopWeights } from "./preflop/evtable";

const equalWeights = (n: number) => Array.from({ length: n }, () => 1);

test("the composition gate FAILS on the legacy 25-flop set", () => {
  // The state of the world this whole programme exists to fix. The hand-picked
  // list the published pack averaged is preserved verbatim in legacy-25.txt as
  // that pack's provenance record; if this test ever passes, either the record
  // changed or the gate stopped working — and the gate silently passing is the
  // worse of the two.
  const flops = readFileSync("solver/flops/legacy-25.txt", "utf8").trim().split("\n");
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
  const flops = readFileSync("solver/flops/legacy-25.txt", "utf8").trim().split("\n");
  const truth = trueStratumWeights();
  const counts = new Map<string, number>();
  for (const f of flops) counts.set(stratumOfFlop(f), (counts.get(stratumOfFlop(f)) ?? 0) + 1);
  const weights = flops.map((f) => (truth.get(stratumOfFlop(f)) ?? 0) / counts.get(stratumOfFlop(f))!);

  const report = composition(flops, weights);
  assert.equal(report.ok, false, "a sample missing 8.7% of flop space cannot be reweighted into truth");
  assert.deepEqual(report.missing.sort(), ["rainbow/trips", "two-tone/paired"]);
});

test("flops.txt is set-25.json's board list, in the same order", () => {
  // The board list and the weights are two halves of one thing. flops.txt is
  // only the SOLVE ORDER — the runners take a plain list precisely so the
  // weights stay an analysis input — and this pins the two files together so
  // neither can be regenerated without the other.
  const listed = readFileSync("solver/flops.txt", "utf8").trim().split("\n");
  const set = JSON.parse(readFileSync("solver/flops/set-25.json", "utf8")) as {
    flops: { flop: string; weight: number }[];
  };
  assert.deepEqual(listed, set.flops.map((f) => f.flop));

  // With the set's weights the composition is exact by construction.
  const report = composition(listed, set.flops.map((f) => f.weight));
  assert.equal(report.ok, true, `deviation ${report.totalDeviation}`);
  assert.ok(report.totalDeviation < 1e-9);
});

test("equal weights over the stratified list do NOT reproduce its composition", () => {
  // The trap the split-file layout invites: averaging over flops.txt with
  // equal weights. The floor-of-one allocation gives rainbow/trips (0.24% of
  // flop space) a full 1/25 = 4% at equal weight, so the unweighted list
  // fails the very gate its set passes — measured deviation 0.094 against the
  // 0.02 tolerance. Anything that averages EVs must load the weights from
  // set-25.json (loadFlopWeights), never assume 1/n.
  const listed = readFileSync("solver/flops.txt", "utf8").trim().split("\n");
  const report = composition(listed, listed.map(() => 1));
  assert.equal(report.ok, false);
  assert.ok(report.totalDeviation > 0.05, `deviation ${report.totalDeviation}`);
  assert.deepEqual(report.missing, [], "every stratum is present; the failure is weighting alone");
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

test("a cross-set --against comparison is detected before any EVs load", () => {
  // The repro that motivated this: `--ev set100-iter4 --flop-set set-100.json
  // --against ev/iter4`. iter4 was solved over the legacy hand-picked list,
  // so weighting it by set-100 is comparing two different samples — a
  // composition change dressed up as a stability change. The refusal itself
  // is loadEvTable's job (tested below); this checks the CHEAP detector the
  // CLI uses to report it as a diagnostic instead of a stack trace.
  const set100 = loadFlopWeights("solver/flops/set-100.json");
  const legacy = readFileSync("solver/flops/legacy-25.txt", "utf8").trim().split("\n");

  const absent = flopsAbsentFromSet(legacy, set100);
  assert.ok(absent.length > 0, "the legacy list must not sit inside set-100");
  assert.ok(absent.includes("6s5d4h"), "the board the stack trace named is detected");
  for (const f of absent) assert.ok(legacy.includes(f), "only boards from the directory are reported");

  // A directory solved over the set itself has nothing absent...
  const set100Boards = [...set100.keys()];
  assert.deepEqual(flopsAbsentFromSet(set100Boards, set100), []);
  // ...and so does any directory under EQUAL_WEIGHTS, where no set exists to
  // disagree with.
  assert.deepEqual(flopsAbsentFromSet(legacy, EQUAL_WEIGHTS), []);
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
