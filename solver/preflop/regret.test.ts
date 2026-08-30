import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ALL_COMBOS, EQUAL_WEIGHTS, comboToClass, loadEvTable } from "./evtable";
import { BB_CALL_THRESHOLD, OPEN, gridHands, parseRangeString, rangePercent } from "./rangeUpdate";
import { Z95, aggregateRegret, btnThreshold } from "./regret";

/**
 * Write a synthetic ev directory whose per-class EVs are known exactly.
 *
 * `evOf(player, handClass, flopIndex)` supplies chips. Every combo of a class
 * gets the same value, which is how the pack is indexed anyway, and every hand
 * is present at weight 1 so `comboMean` is a plain mean.
 */
function fakeEvDir(
  flops: string[],
  evOf: (player: 0 | 1, cls: string, flop: number) => number,
): string {
  const dir = mkdtempSync(join(tmpdir(), "regret-"));
  flops.forEach((flop, i) => {
    const players = [0, 1].map((p) => ({
      hands: ALL_COMBOS,
      ev: ALL_COMBOS.map((c) => evOf(p as 0 | 1, comboToClass(c), i)),
      weight: ALL_COMBOS.map(() => 1),
    }));
    writeFileSync(
      join(dir, `${flop}.ev.json`),
      JSON.stringify({ flop, pot: 55, stack: 975, players }),
    );
  });
  return dir;
}

const FLOPS = ["AcQcTd", "AcQd5h", "Ac9c8d", "Ac7d4h"];
/** Everything folds except AA, far above BB's threshold and far below BTN's. */
const baseline = (player: 0 | 1, cls: string): number =>
  cls === "AA" ? BB_CALL_THRESHOLD + 30 : BB_CALL_THRESHOLD - 30;

test("BTN's open/fold boundary is derived from the tree, not assumed to be zero", () => {
  // Opening is (1-p)*15 + p*(ev - 25). At p = 1 the dead money never comes in
  // and the boundary is the open itself; as p falls the fold equity subsidises
  // ever worse hands and the boundary drops.
  assert.equal(btnThreshold(1), OPEN);
  assert.ok(Math.abs(btnThreshold(0.778) - 20.72) < 0.01, "≈2.07bb at 77.8% calls");
  assert.ok(btnThreshold(0.5) < btnThreshold(0.9), "more folds means a wider open");
});

test("a strategy that already IS the best response has zero regret", () => {
  const dir = fakeEvDir(FLOPS, baseline);
  const table = loadEvTable(dir, EQUAL_WEIGHTS);
  // BB calls only AA. BTN opens everything: even the worst class is only
  // called by AA's 6 combos, so the fold equity dominates.
  const sigmaOop = new Map(gridHands().map((h) => [h, h === "AA" ? 1 : 0]));
  const sigmaIp = new Map(gridHands().map((h) => [h, 1]));
  const r = aggregateRegret(table, sigmaOop, sigmaIp);
  assert.ok(Math.abs(r.bb.crossFitted) < 1e-9, `BB ${r.bb.crossFitted}`);
  assert.ok(Math.abs(r.btn.crossFitted) < 1e-9, `BTN ${r.btn.crossFitted}`);
  assert.ok(Math.abs(r.combined) < 1e-9);
  assert.equal(r.combinedLower95, 0, "zero regret is not distinguishable from zero");
});

test("regret equals the EV actually given up, priced per class", () => {
  const dir = fakeEvDir(FLOPS, baseline);
  const table = loadEvTable(dir, EQUAL_WEIGHTS);
  // BB folds AA, which is worth 30 chips more than folding, every flop.
  const sigmaOop = new Map(gridHands().map((h) => [h, 0]));
  const sigmaIp = new Map(gridHands().map((h) => [h, 1]));
  const r = aggregateRegret(table, sigmaOop, sigmaIp);
  const expected = (6 / 1326) * 1 * 30; // prior(AA) * frequency error * chips
  assert.ok(Math.abs(r.bb.crossFitted - expected) < 1e-9, `${r.bb.crossFitted} vs ${expected}`);
  // Every flop is identical, so the sample says nothing is uncertain.
  assert.ok(r.bb.se < 1e-9);
  assert.ok(r.bb.lower95 > 0, "a real, precisely measured loss is distinguishable from zero");
});

test("BTN's regret is priced at the decision, not on the postflop scale", () => {
  const dir = fakeEvDir(FLOPS, baseline);
  const table = loadEvTable(dir, EQUAL_WEIGHTS);
  // BTN folds AA. Its postflop EV is 45 chips, but that is only reached when
  // BB calls; opening is worth (1-p)*15 + p*(45-25) with p = AA's 6/1326.
  const sigmaOop = new Map(gridHands().map((h) => [h, h === "AA" ? 1 : 0]));
  const sigmaIp = new Map(gridHands().map((h) => [h, h === "AA" ? 0 : 1]));
  const r = aggregateRegret(table, sigmaOop, sigmaIp);
  const p = rangePercent(new Map(gridHands().map((h) => [h, h === "AA" ? 1 : 0]))) / 100;
  const expected = (6 / 1326) * ((1 - p) * 15 + p * (45 - OPEN));
  assert.ok(Math.abs(r.btn.crossFitted - expected) < 1e-9, `${r.btn.crossFitted} vs ${expected}`);
});

/**
 * THE TRAP THIS MODULE EXISTS TO AVOID.
 *
 * Every class here is EXACTLY indifferent on average — its EV sits on the
 * threshold, and the four flops straddle it symmetrically. The truth is that
 * there is nothing to win, so the honest answer is zero.
 *
 * The plug-in estimate cannot say that. It picks each class's action by the
 * sign of the noisy pooled mean and then prices it with the same numbers, so
 * it always finds something. The cross-fitted estimate chooses on 3 flops and
 * prices on the 4th, which breaks that circularity.
 */
test("cross-fitting removes the winner's curse that inflates plug-in regret", () => {
  // Every class is truly indifferent: its EV is the threshold plus noise whose
  // EXPECTATION is zero. A finite sample of boards still leaves each pooled
  // mean somewhere off the threshold, and that is all the plug-in has to go
  // on — it picks a side from the noise and then prices it with the same
  // numbers, so it finds "regret" in a game where there is none to win.
  const flops = ["AcQcTd", "AcQd5h", "Ac9c8d", "Ac7d4h", "Ac4c2d", "Jc6c3d", "Kc5c3d"];
  let seed = 12345;
  const noise = new Map<string, number[]>();
  for (const cls of gridHands()) {
    noise.set(
      cls,
      flops.map(() => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return ((seed % 2001) - 1000) / 40; // ±25 chips, mean zero
      }),
    );
  }
  const dir = fakeEvDir(flops, (player, cls, flop) =>
    (player === 0 ? BB_CALL_THRESHOLD : OPEN) + noise.get(cls)![flop],
  );
  const table = loadEvTable(dir, EQUAL_WEIGHTS);
  const half = new Map(gridHands().map((h) => [h, 0.5]));
  const r = aggregateRegret(table, half, half);

  assert.ok(r.bb.plugin > 0.05, `plug-in should find regret in pure noise: ${r.bb.plugin}`);
  assert.ok(
    Math.abs(r.bb.crossFitted) < r.bb.plugin / 3,
    `cross-fitted (${r.bb.crossFitted}) must collapse toward zero, plug-in was ${r.bb.plugin}`,
  );
  // And the honest conclusion follows for that side: nothing distinguishable
  // from zero, which is the right answer for a game of pure indifference.
  //
  // BB is the side asserted on because its threshold is EXOGENOUS — call iff
  // ev > 15, whatever anyone else does. BTN's indifference point moves with
  // BB's calling frequency, which is itself noise-driven here, so "centred on
  // indifference" is not something this fixture can arrange for BTN.
  assert.equal(r.bb.lower95, 0);
});

test("the standard error widens when the flops disagree, and the bound follows", () => {
  // Same average regret as the priced-per-class case, but delivered by two
  // flops that disagree wildly rather than four that agree.
  const spread = fakeEvDir(FLOPS, (player, cls, flop) =>
    cls === "AA"
      ? BB_CALL_THRESHOLD + (flop % 2 === 0 ? 90 : -30)
      : BB_CALL_THRESHOLD - 30,
  );
  const table = loadEvTable(spread, EQUAL_WEIGHTS);
  const sigmaOop = new Map(gridHands().map((h) => [h, 0]));
  const sigmaIp = new Map(gridHands().map((h) => [h, 1]));
  const r = aggregateRegret(table, sigmaOop, sigmaIp);
  assert.ok(r.bb.se > 0, "flops that disagree must produce a positive error");
  assert.ok(
    Math.abs(r.bb.upper95 - (r.bb.crossFitted + Z95 * r.bb.se)) < 1e-12,
    "the interval is the estimate plus the one-sided quantile",
  );
  assert.ok(r.bb.lower95 >= 0, "a regret bound is never negative");
});

test("the combined error is estimated on the summed per-flop regret, not by adding SEs", () => {
  // BB and BTN move in OPPOSITE directions board by board, so their errors
  // cancel. Adding the two sides' standard errors would report the largest
  // uncertainty exactly where the total is most certain.
  const dir = fakeEvDir(FLOPS, (player, cls, flop) => {
    if (cls !== "AA") return BB_CALL_THRESHOLD - 30;
    const swing = flop % 2 === 0 ? 40 : -20;
    return player === 0 ? BB_CALL_THRESHOLD + swing : BB_CALL_THRESHOLD - swing + 60;
  });
  const table = loadEvTable(dir, EQUAL_WEIGHTS);
  const sigmaOop = new Map(gridHands().map((h) => [h, 0]));
  const sigmaIp = new Map(gridHands().map((h) => [h, 0]));
  const r = aggregateRegret(table, sigmaOop, sigmaIp);
  assert.ok(r.bb.se > 0 && r.btn.se > 0);
  assert.ok(
    r.combinedSe < r.bb.se + r.btn.se,
    `combined SE ${r.combinedSe} must not be the sum ${r.bb.se + r.btn.se}`,
  );
});

test("the stratified error pools a singleton stratum instead of calling it exact", () => {
  // The crowd must have spread of its own — a pooled variance is pooled FROM
  // somewhere, and three flops that agree exactly have nothing to lend.
  const dir = fakeEvDir(FLOPS, (player, cls, flop) =>
    cls === "AA" ? BB_CALL_THRESHOLD + [20, 35, 50, 60][flop] : BB_CALL_THRESHOLD - 30,
  );
  const table = loadEvTable(dir, EQUAL_WEIGHTS);
  const sigmaOop = new Map(gridHands().map((h) => [h, 0]));
  const sigmaIp = new Map(gridHands().map((h) => [h, 1]));
  // Three flops in one stratum, one alone in its own.
  const strata = new Map(FLOPS.map((f, i) => [f, i === 3 ? "lonely" : "crowd"]));
  const r = aggregateRegret(table, sigmaOop, sigmaIp, strata);
  assert.ok(r.bb.se > 0, "a stratum sampled once must not report zero error");
  assert.ok(Number.isFinite(r.bb.se));
});

test("one flop cannot estimate its own error", () => {
  const dir = fakeEvDir(["AcQcTd"], baseline);
  const table = loadEvTable(dir, EQUAL_WEIGHTS);
  const r = aggregateRegret(
    table,
    new Map(gridHands().map((h) => [h, 0])),
    new Map(gridHands().map((h) => [h, 1])),
  );
  assert.equal(r.bb.se, Number.POSITIVE_INFINITY);
  assert.equal(r.bb.lower95, 0, "an unbounded error can never be distinguishable from zero");
});

test("the representative baseline reports a regret the sample can resolve", (t) => {
  // The real thing, when the EVs are present: ranges-iter4 against the best
  // response to the 100-flop representative solve. Skipped where solver/ev is
  // absent, since it is git-ignored.
  const REPO = new URL("../..", import.meta.url).pathname;
  const dir = `${REPO}solver/ev/set100-iter4`;
  if (!existsSync(dir)) {
    t.skip("solver/ev/set100-iter4 is absent (git-ignored)");
    return;
  }
  const table = loadEvTable(dir, EQUAL_WEIGHTS);
  const sigma = JSON.parse(
    readFileSync(`${REPO}solver/ranges-iter4-srp-btn-bb.json`, "utf8"),
  );
  const r = aggregateRegret(table, parseRangeString(sigma.oop), parseRangeString(sigma.ip));
  assert.ok(r.combined > 0, "the biased ranges do leave EV on the table");
  assert.ok(Number.isFinite(r.combinedSe) && r.combinedSe > 0);
});
