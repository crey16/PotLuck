/**
 * Run with:  npx tsx --test lib/drill/outsQuestion.test.ts
 *
 * Pure unit tests for the outs-drill question builder. No React, no DOM —
 * a deterministic Rng is injected so results are reproducible (never
 * Math.random in tests).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Rng, Spot } from "../poker/engine.js";
import { hitProbability } from "../poker/engine.js";
import { buildOpts, buildOutsQuestion, withArticle } from "./outsQuestion.js";

/** A cycling deterministic Rng — avoids Math.random in tests entirely. */
function seqRng(values: number[]): Rng {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

function fakeSpot(overrides: Partial<Spot> = {}): Spot {
  return {
    hero: [0, 1],
    board: [8, 12, 16],
    street: "flop",
    outs: 9,
    outCards: [4, 20, 36],
    draw: "flush draw",
    unseen: 47,
    equity: hitProbability(9, "flop"),
    ...overrides,
  };
}

test("withArticle: consonant-leading label gets 'a'", () => {
  assert.equal(withArticle("gutshot"), "a gutshot");
});

test("withArticle: vowel-leading label gets 'an'", () => {
  assert.equal(withArticle("open-ended straight draw"), "an open-ended straight draw");
});

test("withArticle: combo draw label still gets 'a' (starts with 'flush')", () => {
  assert.equal(withArticle("flush draw + gutshot"), "a flush draw + gutshot");
});

test("buildOpts: always contains the answer exactly once", () => {
  const rng = seqRng([0.1, 0.9, 0.4, 0.6, 0.2, 0.8]);
  const n = 9;
  const candidates = [n - 1, n + 1, n - 2, n + 2, n + 3, n - 3, n + 6, Math.max(1, n - 4)];
  const opts = buildOpts(n, candidates, 4, rng);
  assert.equal(opts.filter((v) => v === n).length, 1);
});

test("buildOpts: 4 distinct options, all within 1..20", () => {
  const rng = seqRng([0.05, 0.77, 0.33, 0.61, 0.9, 0.12]);
  const n = 9;
  const candidates = [n - 1, n + 1, n - 2, n + 2, n + 3, n - 3, n + 6, Math.max(1, n - 4)];
  const opts = buildOpts(n, candidates, 4, rng);
  assert.equal(opts.length, 4);
  assert.equal(new Set(opts).size, 4);
  for (const v of opts) {
    assert.ok(v >= 1 && v <= 20, `${v} out of range`);
  }
});

test("buildOpts: works at the bottom edge of the level-2 range (n=4)", () => {
  const rng = seqRng([0.9, 0.1, 0.5, 0.3, 0.7]);
  const n = 4;
  const candidates = [n - 1, n + 1, n - 2, n + 2, n + 3, n - 3, n + 6, Math.max(1, n - 4)];
  const opts = buildOpts(n, candidates, 4, rng);
  assert.equal(opts.length, 4);
  assert.equal(new Set(opts).size, 4);
  assert.ok(opts.includes(n));
  for (const v of opts) assert.ok(v >= 1 && v <= 20);
});

test("buildOpts: works at the top edge of the level-2 range (n=12)", () => {
  const rng = seqRng([0.2, 0.4, 0.6, 0.8, 0.1]);
  const n = 12;
  const candidates = [n - 1, n + 1, n - 2, n + 2, n + 3, n - 3, n + 6, Math.max(1, n - 4)];
  const opts = buildOpts(n, candidates, 4, rng);
  assert.equal(opts.length, 4);
  assert.equal(new Set(opts).size, 4);
  assert.ok(opts.includes(n));
  for (const v of opts) assert.ok(v >= 1 && v <= 20);
});

test("buildOutsQuestion: options always contain the true answer exactly once", () => {
  const rng = seqRng([0.15, 0.55, 0.35, 0.95, 0.05]);
  const spot = fakeSpot({ outs: 9 });
  const q = buildOutsQuestion(spot, rng);
  assert.equal(q.answer, 9);
  assert.equal(q.options.filter((v) => v === q.answer).length, 1);
});

test("buildOutsQuestion: always 4 distinct options in 1..20", () => {
  const rng = seqRng([0.44, 0.11, 0.88, 0.22, 0.66]);
  const spot = fakeSpot({ outs: 7 });
  const q = buildOutsQuestion(spot, rng);
  assert.equal(q.options.length, 4);
  assert.equal(new Set(q.options).size, 4);
  for (const v of q.options) assert.ok(v >= 1 && v <= 20);
});

test("buildOutsQuestion: carries street, drawLabel (with article) and unseen through", () => {
  const rng = seqRng([0.5, 0.5, 0.5, 0.5]);
  const spot = fakeSpot({ outs: 8, draw: "open-ended straight draw", street: "turn", unseen: 46 });
  const q = buildOutsQuestion(spot, rng);
  assert.equal(q.street, "turn");
  assert.equal(q.drawLabel, "an open-ended straight draw");
  assert.equal(q.unseen, 46);
});

test("buildOutsQuestion: hitPct formatting matches reference pct — 9 outs flop => 35.0%", () => {
  const rng = seqRng([0.5, 0.5, 0.5, 0.5]);
  const spot = fakeSpot({ outs: 9, street: "flop", equity: hitProbability(9, "flop") });
  const q = buildOutsQuestion(spot, rng);
  assert.equal(q.hitPct, "35.0%");
});

test("buildOutsQuestion: hitPct formatting on the turn — 8 outs turn => 17.4%", () => {
  const rng = seqRng([0.5, 0.5, 0.5, 0.5]);
  const spot = fakeSpot({ outs: 8, street: "turn", equity: hitProbability(8, "turn") });
  const q = buildOutsQuestion(spot, rng);
  assert.equal(q.hitPct, "17.4%");
});
