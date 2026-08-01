/**
 * M5 acceptance tests: a session must not repeat itself.
 *
 * Simulates exactly what DrillShell does per deal — a fresh mulberry32(seed +
 * dealCount) stream, generateFresh against the kind's rolling window, then the
 * answered question's signature pushed into the window — and asserts that no
 * question's signature reappears within the REPEAT_WINDOW answers before it.
 *
 * The concepts bank holds only 15 items, fewer than the window, so its
 * guarantee is necessarily weaker: the first 15 questions are all distinct
 * (the bank cycles rather than repeats early).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { GENERATORS } from "./registry";
import { generateFresh, pushSignature, questionSignature, REPEAT_WINDOW } from "./antirepeat";
import { mulberry32 } from "./rng";
import type { DrillKind, DrillLevel } from "./contract";

function sessionSignatures(
  kind: DrillKind,
  n: number,
  level: DrillLevel,
  seed: number
): string[] {
  let win: string[] = [];
  const sigs: string[] = [];
  for (let deal = 0; deal < n; deal++) {
    const rng = mulberry32(seed + deal);
    const q = generateFresh(GENERATORS[kind], { level, oppMode: "unknown", rng }, new Set(win));
    const s = questionSignature(q);
    sigs.push(s);
    win = pushSignature(win, s);
  }
  return sigs;
}

function repeatsWithinWindow(sigs: string[]): number {
  let repeats = 0;
  for (let i = 0; i < sigs.length; i++) {
    const lookback = sigs.slice(Math.max(0, i - REPEAT_WINDOW), i);
    if (lookback.includes(sigs[i])) repeats++;
  }
  return repeats;
}

const GENERATED_KINDS: DrillKind[] = [
  "outs", "rule24", "potodds", "decision", "implied", "ev", "bluff", "preflop",
];

for (const kind of GENERATED_KINDS) {
  test(`variety: a 50-question ${kind} session never repeats within the window`, () => {
    for (const level of [1, 2, 3] as DrillLevel[]) {
      for (const seed of [1000, 5000]) {
        const sigs = sessionSignatures(kind, 50, level, seed);
        assert.equal(
          repeatsWithinWindow(sigs), 0,
          `${kind} level ${level} seed ${seed} repeated a question`
        );
      }
    }
  });
}

test("variety: the first 15 concepts questions are all distinct (bank of 15)", () => {
  for (const seed of [1000, 5000]) {
    const sigs = sessionSignatures("concepts", 15, 2, seed);
    assert.equal(new Set(sigs).size, 15, `seed ${seed}: bank should cycle before repeating`);
  }
});

test("variety: preflop sweeps the grid — 50 questions reach many distinct hands", () => {
  const sigs = sessionSignatures("preflop", 50, 2, 1234);
  const hands = new Set(sigs.map((s) => s.split("|")[1]));
  assert.ok(hands.size >= 30, `only ${hands.size} distinct hands in 50 questions`);
});

test("variety: potodds level 1 stays on clean numbers while varying", () => {
  // Level 1's clean-number space is ~51 spots (17 pots × 3 fractions), so 50
  // fully distinct questions is not guaranteed — no repeats inside the window
  // is (covered above), plus a healthy distinct count here.
  const sigs = sessionSignatures("potodds", 50, 1, 777);
  assert.ok(new Set(sigs).size >= 35, `only ${new Set(sigs).size} distinct L1 spots`);
  for (const s of sigs) {
    const [potBefore, bet, extra] = s.split("|").map(Number);
    assert.equal(potBefore % 10, 0, `level 1 pot not on tens: ${potBefore}`);
    assert.equal(bet % 5, 0, `level 1 bet not on fives: ${bet}`);
    assert.equal(extra, 0, "level 1 must not deal raise spots");
  }
});
