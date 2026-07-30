/**
 * How one 13x13 range cell paints: the fill that encodes its frequencies, and
 * the modifier class that keeps its label legible against that fill.
 *
 * Split out of RangeGrid so the three-case contract is unit-testable. It has
 * to be three cases, not two: `.gc` draws the label in the BACKGROUND colour
 * (reverse-out, correct on a cell filled edge to edge) and `.gc.dim` overrides
 * that for a pure fold. A partly-filled cell is neither — its label sits over
 * the transparent part — so without a third case it renders background on
 * background and disappears. See rangeCell.test.ts.
 */

/** Value steps of one hue: raise/3-bet is the dark accent, call the light one. */
const RAISE = "var(--color-accent-800)";
const CALL = "var(--color-accent-300)";

/** Frequencies for a single cell: raise, call, fold. They sum to 1. */
export interface CellFrequency {
  r: number;
  c: number;
  f: number;
}

export interface CellAppearance {
  /** CSS background: a solid colour, `transparent`, or a bottom-up gradient. */
  background: string;
  /** Modifier for `.gc` — "" (solid), "dim" (fold) or "mixed". */
  className: string;
}

/** Treat >=99.9% as pure, so rounding never puts a cell in two states at once. */
const PURE = 0.999;

export function rangeCellAppearance(f: CellFrequency): CellAppearance {
  if (f.f >= PURE) return { background: "transparent", className: "dim" };
  if (f.r >= PURE) return { background: RAISE, className: "" };
  if (f.c >= PURE) return { background: CALL, className: "" };

  const rp = (f.r * 100).toFixed(1);
  const cp = ((f.r + f.c) * 100).toFixed(1);
  return {
    background:
      `linear-gradient(to top, ${RAISE} 0 ${rp}%, ` +
      `${CALL} ${rp}% ${cp}%, transparent ${cp}% 100%)`,
    className: "mixed",
  };
}
