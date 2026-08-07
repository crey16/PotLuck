import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { breakEvenFoldRate } from "../poker/math";
import {
  callBreakEvenEquity,
  callRange,
  shoveRange,
  type PushfoldPosition,
} from "../pushfold";

/**
 * Module 07 states numbers in its prose. CLAUDE.md's rule is that every one of
 * them comes from `lib/poker/math.ts` — and here also from the solved pack in
 * `lib/pushfold`, because a shoving range is not a formula.
 *
 * A lesson is the one place in the product where a number is never recomputed
 * at runtime, so it is the one place a wrong number can sit forever looking
 * plausible. This recomputes every figure and asserts the seed still says the
 * same thing. If the equilibrium is ever re-solved, this fails and the copy
 * has to be rewritten rather than quietly teaching the old ranges.
 */

const SEED = readFileSync(
  path.resolve(import.meta.dirname, "../../supabase/seed.sql"),
  "utf8",
);

/**
 * Just module 07's block, bounded at whatever comes next.
 *
 * Each module's seed block begins with its own `insert into public.modules`,
 * so that is the boundary rather than `select setval(` — bounding at setval
 * assumes this module is the last in the file, which is exactly the
 * assumption that broke module 06's suite when this one was appended.
 */
const MODULE_7 = (() => {
  const marker = "-- Module 07 — Short Stacks & Push/Fold";
  const start = SEED.indexOf(marker);
  assert.ok(start > 0, "the module 07 seed block is missing from supabase/seed.sql");
  // Skip PAST module 07's own insert before looking for the next module, or
  // the block collapses to its comment header and every assertion below
  // passes vacuously against an empty string.
  const ownInsert = SEED.indexOf("insert into public.modules", start);
  const ends = [
    SEED.indexOf("insert into public.modules", ownInsert + 1),
    SEED.indexOf("select setval(", start),
  ].filter((index) => index > ownInsert);
  assert.ok(ends.length > 0);
  return SEED.slice(start, Math.min(...ends));
})();

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const range = (position: PushfoldPosition, stack: number, ante: number) =>
  `${shoveRange(position, stack, ante).percent.toFixed(1)}%`;
const calls = (caller: PushfoldPosition, shover: PushfoldPosition, stack: number, ante: number) =>
  `${callRange(caller, shover, stack, ante).percent.toFixed(1)}%`;

const states = (value: string, what: string) => {
  assert.ok(MODULE_7.includes(value), `module 07 never states ${value}, ${what}`);
};

test("the extracted block is the real module, not an empty string", () => {
  // Every assertion below is `includes`, which passes vacuously against "".
  // Bounding this block wrongly has already happened once — it collapsed to
  // its comment header — so the extraction is checked before it is trusted.
  assert.ok(MODULE_7.length > 4000, `module 07 extracted as ${MODULE_7.length} chars`);
  assert.equal((MODULE_7.match(/"screens"/g) ?? []).length, 4, "expected four lessons");
  assert.ok(!MODULE_7.includes("Bluffing & Aggression"), "module 06 leaked into the block");
});

test("the break-even fold frequency for a jam comes from breakEvenFoldRate", () => {
  // The jam is a bet, so the reward is the pot BEFORE it — the 1.5bb of
  // blinds. Getting this backwards is CLAUDE.md's #1 source of wrong answers.
  states(pct1(breakEvenFoldRate(1.5, 10)), "the folds a 10bb jam needs into 1.5bb");
  states(pct1(breakEvenFoldRate(1.5, 20)), "the folds a 20bb jam needs into 1.5bb");
});

test("the calling prices are the pot odds the caller is actually getting", () => {
  // Big blind: the posted blind is already in the pot, so it is not part of
  // what the call costs. Forgetting that is the mistake the lesson exists to
  // correct, so the number had better be right.
  states(pct1(callBreakEvenEquity("BB", "BTN", 10, 0)), "the BB's price against a 10bb button jam");
  // A seat with nothing invested risks a whole stack and gets a worse price.
  states(pct1(callBreakEvenEquity("CO", "UTG", 10, 0)), "the CO's price against a 10bb UTG jam");
  assert.ok(
    callBreakEvenEquity("CO", "UTG", 10, 0) > callBreakEvenEquity("BB", "BTN", 10, 0),
    "an uninvested seat must be getting a worse price than the big blind",
  );
});

test("every shoving range quoted is the solved one", () => {
  // The monotonicity story in lesson 1.
  states(range("BTN", 20, 0), "the button's 20bb jam");
  states(range("BTN", 10, 0), "the button's 10bb jam");
  states(range("BTN", 5, 0), "the button's 5bb jam");
  // The ante story in lesson 4.
  states(range("UTG", 10, 0), "UTG's 10bb jam with no ante");
  states(range("UTG", 10, 1), "UTG's 10bb jam with an ante");
  states(range("SB", 5, 0), "the SB's 5bb jam with no ante");
  states(range("SB", 5, 1), "the SB's 5bb jam with an ante");
  states(range("SB", 20, 0), "the SB's 20bb jam with no ante");
  states(range("SB", 20, 1), "the SB's 20bb jam with an ante");
});

test("every calling range quoted is the solved one", () => {
  states(calls("BB", "BTN", 10, 0), "the BB's 10bb calling range with no ante");
  states(calls("BB", "BTN", 10, 1), "the BB's 10bb calling range with an ante");
  states(calls("CO", "UTG", 10, 0), "the CO's 10bb calling range");
});

test("the claims the lesson makes about direction are true of the pack", () => {
  // The lesson is not just quoting numbers, it is asserting a shape. If the
  // shape ever reverses, the prose becomes wrong even with the right figures.

  // Shorter stacks jam wider.
  assert.ok(shoveRange("BTN", 5, 0).percent > shoveRange("BTN", 10, 0).percent);
  assert.ok(shoveRange("BTN", 10, 0).percent > shoveRange("BTN", 20, 0).percent);

  // An ante widens a jam when there are players behind to fold out.
  assert.ok(shoveRange("UTG", 10, 1).percent > shoveRange("UTG", 10, 0).percent);

  // ...and TIGHTENS the small blind's at 5bb, which is the half of the rule
  // every training video leaves out. Lesson 4 teaches the exception, so if
  // this ever stopped being true the lesson would be teaching a fiction.
  assert.ok(
    shoveRange("SB", 5, 1).percent < shoveRange("SB", 5, 0).percent,
    "the ante must still tighten the SB's 5bb jam, or lesson 4 is wrong",
  );
  // The effect flips back deeper, which the same lesson also claims.
  assert.ok(shoveRange("SB", 20, 1).percent > shoveRange("SB", 20, 0).percent);

  // From an uninvested seat, calling is tighter than the jam it faces.
  assert.ok(
    callRange("CO", "UTG", 10, 0).percent < shoveRange("UTG", 10, 0).percent,
    "a call has no fold equity, so an uninvested seat must call tighter",
  );
  // The ante widens the big blind's defence.
  assert.ok(callRange("BB", "BTN", 10, 1).percent > callRange("BB", "BTN", 10, 0).percent);
});

test("the module states the chip-EV assumption", () => {
  assert.match(MODULE_7, /ICM/, "a push/fold lesson that never mentions ICM is dangerous");
  assert.match(MODULE_7, /chip EV/i);
});
