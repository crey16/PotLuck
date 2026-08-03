import test from "node:test";
import assert from "node:assert/strict";

import { rangeCellAppearance } from "./rangeCell";

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
