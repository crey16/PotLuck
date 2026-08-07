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

/**
 * A module's own seed block, bounded at whatever comes next.
 *
 * Bounding it at `select setval(` alone assumed the module was the LAST thing
 * in the file, which stopped being true the moment another module was
 * appended — module 06's block then swallowed module 07's lessons and this
 * suite started asserting things about the wrong copy. Each module's block
 * begins with its own `insert into public.modules`, so that is the boundary.
 */
function moduleBlock(seed: string, marker: string): string {
  const start = seed.indexOf(marker);
  assert.ok(start > 0, `${marker} is missing from supabase/seed.sql`);
  // Skip PAST this module's own insert before looking for the next one, or
  // the block collapses to its comment header.
  const ownInsert = seed.indexOf("insert into public.modules", start);
  assert.ok(ownInsert > start, `${marker} has no module insert after it`);
  const ends = [
    seed.indexOf("insert into public.modules", ownInsert + 1),
    seed.indexOf("select setval(", start),
  ].filter((index) => index > ownInsert);
  assert.ok(ends.length > 0, `no end boundary found after ${marker}`);
  return seed.slice(start, Math.min(...ends));
}

/** Just the M8.6A block, so no other module's copy can satisfy an assertion. */
const MODULE_6 = moduleBlock(SEED, "-- M8.6A — Module 06");

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
