import test from "node:test";
import assert from "node:assert/strict";

import { rangeCellAppearance } from "./rangeCell";

/**
 * A range cell's label is drawn either ON a fill or ON the page background,
 * and those are opposite luminances. `.gc` sets `color: var(--color-bg)` —
 * reverse-out text, correct for a cell filled edge to edge. `.gc.dim` (a pure
 * fold, no fill at all) overrides it to a page-legible colour.
 *
 * A MIXED-frequency cell matched neither: it is only partly filled, the label
 * sits over the transparent part, and it kept the reverse-out colour — so it
 * rendered background-coloured text on the background. Invisible, and
 * symmetrically so in both themes (dark-on-dark in dark mode, light-on-light
 * in light mode). It affected 29 cells across the 8 scenarios, and they are
 * precisely the cells a user most needs to read.
 *
 * So the appearance contract has three cases, not two, and every cell must
 * declare which one it is.
 */

const only = (r: number, c: number, f: number) => ({ r, c, f });

test("rangeCellAppearance: a fully-filled cell keeps reverse-out text", () => {
  const pure = rangeCellAppearance(only(1, 0, 0));
  assert.equal(pure.className, "", "a solid cell needs no modifier");
  assert.notEqual(pure.background, "transparent");

  const call = rangeCellAppearance(only(0, 1, 0));
  assert.equal(call.className, "");
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
      `partly-filled cell (r=${f.r} c=${f.c} f=${f.f}) must be marked mixed, ` +
        `or its label is drawn in the background colour on the background`,
    );
    assert.notEqual(a.className, "dim", "a mixed cell is not a fold");
  }
});

test("rangeCellAppearance: the fill still encodes the frequencies bottom-up", () => {
  const a = rangeCellAppearance(only(0.4, 0, 0.6));
  assert.match(a.background, /linear-gradient\(to top/);
  assert.match(a.background, /40\.0%/, "raise share should stop at 40%");
});

/** Rounding must not leave a cell in two states at once. */
test("rangeCellAppearance: near-pure frequencies resolve to a single state", () => {
  assert.equal(rangeCellAppearance(only(0.9995, 0, 0.0005)).className, "");
  assert.equal(rangeCellAppearance(only(0.0005, 0, 0.9995)).className, "dim");
});
