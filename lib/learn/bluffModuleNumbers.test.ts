import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  breakEvenFoldRate,
  evOfCall,
  hitByRiver,
  minDefenceFrequency,
  requiredEquity,
} from "../poker/math";

/**
 * The M8.6A Bluffing module states numbers in its prose. CLAUDE.md's
 * poker-math rules say every one of them must come from `lib/poker/math.ts`,
 * because a hand-written figure in a lesson is exactly the kind of confidently
 * wrong answer that looks completely plausible — and unlike a drill, nothing
 * recomputes it at runtime to catch the drift.
 *
 * So this test recomputes them and asserts the seed still says the same thing.
 * If a formula in math.ts changes, this fails and the lesson copy has to be
 * rewritten rather than quietly teaching the old rule.
 */

const SEED = readFileSync(
  path.resolve(import.meta.dirname, "../../supabase/seed.sql"),
  "utf8",
);

/** Just the M8.6A block, so module 1–5 copy cannot satisfy an assertion. */
const MODULE_6 = (() => {
  const start = SEED.indexOf("-- M8.6A — Module 06");
  assert.ok(start > 0, "the M8.6A seed block is missing from supabase/seed.sql");
  const end = SEED.indexOf("select setval(", start);
  assert.ok(end > start);
  return SEED.slice(start, end);
})();

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

test("break-even bluff frequencies match breakEvenFoldRate", () => {
  // The player is BETTING, so the pot is the pot BEFORE their bet.
  for (const bet of [33, 50, 66, 100]) {
    const value = pct(breakEvenFoldRate(100, bet));
    assert.ok(
      MODULE_6.includes(value),
      `module 6 never states ${value}, the break-even fold rate for a ${bet} bet into 100`,
    );
  }
});

test("minimum defence frequencies match minDefenceFrequency", () => {
  for (const bet of [33, 50, 66, 100]) {
    const value = pct(minDefenceFrequency(100, bet));
    assert.ok(
      MODULE_6.includes(value),
      `module 6 never states ${value}, the MDF against a ${bet} bet into 100`,
    );
  }
});

test("the bluff-catcher threshold matches requiredEquity", () => {
  // The player is CALLING, so `pot` is the total AFTER villain's bet.
  assert.ok(MODULE_6.includes(pct(requiredEquity(200, 100))));
});

test("the bluff-catcher EV figures match evOfCall", () => {
  assert.equal(Math.round(evOfCall(0.25, 200, 100)), -25);
  assert.equal(Math.round(evOfCall(0.5, 200, 100)), 50);
  assert.ok(MODULE_6.includes("−25 chips"), "the losing-call figure is missing");
  assert.ok(MODULE_6.includes("+50"), "the winning-call figure is missing");
  // Break-even at exactly the required equity is the pedagogical point.
  assert.ok(Math.abs(evOfCall(requiredEquity(200, 100), 200, 100)) < 1e-9);
});

test("the semi-bluff equity matches hitByRiver for nine outs", () => {
  assert.ok(MODULE_6.includes(pct(hitByRiver(9))));
});

test("MDF and the break-even fold rate are stated as complements", () => {
  // The lesson claims the two columns add to 100%. Hold the seed to it.
  for (const bet of [33, 50, 66, 100]) {
    const sum = breakEvenFoldRate(100, bet) + minDefenceFrequency(100, bet);
    assert.ok(Math.abs(sum - 1) < 1e-9, `they do not sum to 1 for a ${bet} bet`);
  }
});

test("no tempting-but-wrong rounding appears in the copy", () => {
  // Each of these is what someone "tidying up" the prose would write. They are
  // all wrong, and all wrong in the direction that makes a bluff look better
  // or a defence look cheaper than it is.
  for (const wrong of ["24.5%", "25.2%", "39.5%", "40.0%", "60.0%", "75.0%", "34.0%", "36.0%"]) {
    assert.ok(
      !MODULE_6.includes(wrong),
      `module 6 states ${wrong}, which is not what lib/poker/math.ts computes`,
    );
  }
});

test("every module 6 lesson is tagged with the bluff drill's canonical tag", () => {
  // `skill_tag_for("bluff") === "bluffing"` — recommendations route on this,
  // so an untagged lesson is unreachable from a diagnosed weakness.
  const lessonBlocks = MODULE_6.split('"skill_tags"').slice(1);
  assert.equal(lessonBlocks.length >= 6, true, "expected at least 6 tagged lessons");
  for (const block of lessonBlocks) {
    const tags = block.slice(0, block.indexOf("]"));
    assert.ok(tags.includes("bluffing"), `a module 6 lesson is missing the "bluffing" tag: ${tags}`);
  }
});
