import test from "node:test";
import assert from "node:assert/strict";
import {
  DECAY_BB,
  GTO_SCORE_VERSION,
  decisionScore,
  gtoScore,
  scoreBand,
  type ScoredDecision,
} from "./score";
import { verdictFor, EV_STEP_BB } from "./verdict";

const d = (evLossBb: number | null, verdict: ScoredDecision["verdict"] = "correct"): ScoredDecision =>
  ({ evLossBb, verdict });

test("decisionScore: a perfect decision is exactly 100", () => {
  assert.equal(decisionScore(0), 100);
});

test("decisionScore: is strictly decreasing in EV loss and never leaves (0, 100]", () => {
  let previous = decisionScore(0);
  for (let loss = 0.05; loss <= 20; loss += 0.05) {
    const score = decisionScore(loss);
    assert.ok(score < previous, `score did not fall at ${loss}bb`);
    assert.ok(score > 0, `score reached zero at ${loss}bb`);
    assert.ok(score <= 100, `score exceeded 100 at ${loss}bb`);
    previous = score;
  }
});

test("decisionScore: a negative loss cannot score above 100", () => {
  // The exporter cannot produce one, but a future grading source might, and
  // a score of 103 would be nonsense on screen.
  assert.equal(decisionScore(-1), 100);
});

test("decisionScore: the decay constant puts 100/e at DECAY_BB", () => {
  assert.ok(Math.abs(decisionScore(DECAY_BB) - 100 / Math.E) < 1e-9);
});

/**
 * The score and the verdict sit next to each other on screen. If the curve
 * ever moves so that a "correct" decision can score below a "blunder" one,
 * the two would contradict each other in front of the player.
 */
test("score and verdict never contradict each other", () => {
  let worstCorrect = 100;
  let bestBlunder = 0;
  for (let steps = 0; steps <= 200; steps++) {
    const lossBb = steps * EV_STEP_BB;
    const score = decisionScore(lossBb);
    // Frequency 255 (always played) is the friendliest case for the verdict.
    const verdict = verdictFor(255, steps);
    if (verdict === "correct") worstCorrect = Math.min(worstCorrect, score);
    if (verdict === "blunder") bestBlunder = Math.max(bestBlunder, score);
  }
  assert.ok(
    worstCorrect > bestBlunder,
    `worst "correct" scored ${worstCorrect.toFixed(1)} but best "blunder" scored ${bestBlunder.toFixed(1)}`
  );
});

test("gtoScore: averages the scored decisions", () => {
  const result = gtoScore([d(0), d(0), d(DECAY_BB)]);
  const expected = (100 + 100 + 100 / Math.E) / 3;
  assert.ok(Math.abs(result.raw! - expected) < 1e-9);
  assert.equal(result.score, Math.round(expected));
  assert.equal(result.scored, 3);
  assert.equal(result.unscored, 0);
});

/**
 * The rule this module exists to protect. A preflop decision graded against
 * reference ranges has no EV loss — not a loss of zero. Scoring it as perfect
 * would inflate every hand that contains one, which is every hand today.
 */
test("gtoScore: an unknown EV loss is excluded, not treated as zero", () => {
  const withUnknown = gtoScore([d(null), d(DECAY_BB)]);
  const withoutIt = gtoScore([d(DECAY_BB)]);

  assert.equal(withUnknown.raw, withoutIt.raw, "the unknown decision moved the mean");
  assert.equal(withUnknown.scored, 1);
  assert.equal(withUnknown.unscored, 1);

  // And specifically: it must not have been scored as a perfect decision.
  const asPerfect = gtoScore([d(0), d(DECAY_BB)]);
  assert.notEqual(withUnknown.raw, asPerfect.raw, "an unknown loss was scored as 0bb");
});

test("gtoScore: a hand with nothing EV-graded has no score at all", () => {
  const result = gtoScore([d(null), d(null)]);
  assert.equal(result.score, null);
  assert.equal(result.raw, null);
  assert.equal(result.scored, 0);
  assert.equal(result.unscored, 2);
  assert.equal(result.worstEvLossBb, null);
});

test("gtoScore: an empty hand has no score", () => {
  const result = gtoScore([]);
  assert.equal(result.score, null);
  assert.equal(result.totalEvLossBb, 0);
});

test("gtoScore: totals and worst loss come only from known losses", () => {
  const result = gtoScore([d(0.25), d(null), d(1.5), d(0.5)]);
  assert.ok(Math.abs(result.totalEvLossBb - 2.25) < 1e-9);
  assert.equal(result.worstEvLossBb, 1.5);
});

test("gtoScore: counts every verdict, including the unscored ones", () => {
  const result = gtoScore([
    d(0, "correct"),
    d(null, "acceptable"),
    d(0.6, "inaccuracy"),
    d(3, "blunder"),
    d(4, "blunder"),
  ]);
  assert.deepEqual(result.counts, {
    correct: 1,
    acceptable: 1,
    inaccuracy: 1,
    blunder: 2,
  });
});

test("gtoScore: stamps the version so a stored score stays interpretable", () => {
  assert.equal(gtoScore([d(0)]).version, GTO_SCORE_VERSION);
});

test("gtoScore: is reproducible from its stored inputs", () => {
  // The property M8 requires of every grade: given the same EV losses, the
  // same score comes back out.
  const inputs = [d(0.05), d(0.9), d(null), d(2.4)];
  assert.deepEqual(gtoScore(inputs), gtoScore(inputs.map((x) => ({ ...x }))));
});

test("scoreBand: a flawless hand is excellent and a blunder-carrying hand is not", () => {
  assert.equal(scoreBand(gtoScore([d(0), d(0.05)]).score!), "excellent");
  // 0.75bb is the blunder floor in verdict.ts.
  assert.notEqual(scoreBand(gtoScore([d(0.75)]).score!), "excellent");
  assert.equal(scoreBand(gtoScore([d(6), d(5)]).score!), "leaking");
});

test("scoreBand: is monotonic in the score", () => {
  const order = ["leaking", "loose", "solid", "excellent"];
  let previous = -1;
  for (let score = 0; score <= 100; score++) {
    const rank = order.indexOf(scoreBand(score));
    assert.ok(rank >= previous, `band went backwards at ${score}`);
    previous = rank;
  }
});
