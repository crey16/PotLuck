import test from "node:test";
import assert from "node:assert/strict";

import { rangeCellAppearance, rangeCellDescription, moveGridSelection } from "./rangeCell";

/**
 * A range cell can be fully filled, empty, or split between actions. The v2
 * palette keeps those three states explicit so solid cells use the accent,
 * folds stay open, and mixed cells can receive their own legibility treatment.
 */

const only = (r: number, c: number, f: number) => ({ r, c, f });

test("rangeCellAppearance: fully-filled cells use the v2 solid palette", () => {
  const pure = rangeCellAppearance(only(1, 0, 0));
  assert.equal(pure.className, "", "a solid cell needs no modifier");
  assert.equal(pure.background, "var(--color-accent)");

  const call = rangeCellAppearance(only(0, 1, 0));
  assert.equal(call.className, "");
  assert.equal(call.background, "var(--color-accent-200)");
});

test("rangeCellAppearance: a pure fold is dim", () => {
  const fold = rangeCellAppearance(only(0, 0, 1));
  assert.equal(fold.className, "dim");
  assert.equal(fold.background, "transparent");
});

test("rangeCellAppearance: a mixed cell is flagged so its label stays legible", () => {
  for (const f of [only(0.5, 0, 0.5), only(0.4, 0, 0.6), only(0.25, 0.25, 0.5), only(0, 0.5, 0.5)]) {
    const a = rangeCellAppearance(f);
    assert.match(
      a.className,
      /\bmixed\b/,
      `partly-filled cell (r=${f.r} c=${f.c} f=${f.f}) must be marked mixed`,
    );
    assert.notEqual(a.className, "dim", "a mixed cell is not a fold");
  }
});

test("rangeCellAppearance: the fill still encodes the frequencies bottom-up", () => {
  const a = rangeCellAppearance(only(0.4, 0, 0.6));
  assert.match(a.background, /linear-gradient\(to top/);
  assert.match(a.background, /var\(--color-accent\)/);
  assert.match(a.background, /var\(--color-accent-200\)/);
  assert.match(a.background, /40\.0%/, "raise share should stop at 40%");
});

/** Rounding must not leave a cell in two states at once. */
test("rangeCellAppearance: near-pure frequencies resolve to a single state", () => {
  assert.equal(rangeCellAppearance(only(0.9995, 0, 0.0005)).className, "");
  assert.equal(rangeCellAppearance(only(0.0005, 0, 0.9995)).className, "dim");
});

/* ------------------------------------------------------------------ *
 * Reading a cell — the touch path (M8.9A)
 * ------------------------------------------------------------------ */

test("rangeCellDescription: an open scenario reads raise/fold", () => {
  assert.equal(
    rangeCellDescription("AA", { r: 1, c: 0, f: 0 }, false),
    "AA — 100% raise, 0% fold"
  );
});

test("rangeCellDescription: a defence reads 3-bet/call/fold", () => {
  assert.equal(
    rangeCellDescription("A5s", { r: 0.25, c: 0.5, f: 0.25 }, true),
    "A5s — 25% 3-bet, 50% call, 25% fold"
  );
});

test("rangeCellDescription: never states a call for a scenario without one", () => {
  // The open scenarios have no call action; printing "0% call" would invent a
  // choice the player does not have.
  const text = rangeCellDescription("72o", { r: 0, c: 0, f: 1 }, false);
  assert.doesNotMatch(text, /call/);
});

test("moveGridSelection: arrows move one cell within the 13x13", () => {
  // Index 0 is the top-left (AA); 14 is one row down, one column right.
  assert.equal(moveGridSelection(0, "ArrowRight"), 1);
  assert.equal(moveGridSelection(0, "ArrowDown"), 13);
  assert.equal(moveGridSelection(14, "ArrowLeft"), 13);
  assert.equal(moveGridSelection(14, "ArrowUp"), 1);
});

/**
 * Clamping, not wrapping. The grid is a matrix on screen, so running off the
 * end of a row and reappearing at the start of the next reads as a jump —
 * and would silently change which hand class you are looking at.
 */
test("moveGridSelection: clamps at every edge instead of wrapping", () => {
  assert.equal(moveGridSelection(0, "ArrowLeft"), 0, "left edge");
  assert.equal(moveGridSelection(0, "ArrowUp"), 0, "top edge");
  assert.equal(moveGridSelection(12, "ArrowRight"), 12, "right edge of row 0");
  assert.equal(moveGridSelection(168, "ArrowRight"), 168, "bottom-right corner");
  assert.equal(moveGridSelection(168, "ArrowDown"), 168, "bottom edge");
  // Crucially: the right edge must not roll into the next row.
  assert.equal(moveGridSelection(25, "ArrowRight"), 25, "end of row 1 stays in row 1");
});

test("moveGridSelection: Home and End move within the row only", () => {
  assert.equal(moveGridSelection(20, "Home"), 13);
  assert.equal(moveGridSelection(20, "End"), 25);
});

test("moveGridSelection: returns the same index for keys it does not handle", () => {
  // The caller compares before calling preventDefault, so an unhandled key
  // must be indistinguishable from no movement or Tab would be swallowed.
  for (const key of ["Tab", "Enter", " ", "a", "Escape", "PageDown"]) {
    assert.equal(moveGridSelection(40, key), 40, key);
  }
});

test("moveGridSelection: every cell stays in range under any key sequence", () => {
  let i = 0;
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  for (let step = 0; step < 2000; step++) {
    i = moveGridSelection(i, keys[step % keys.length]);
    assert.ok(i >= 0 && i < 169, `index ${i} left the grid at step ${step}`);
  }
});
