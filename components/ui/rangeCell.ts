/**
 * How one 13x13 range cell paints: the fill that encodes its frequencies, and
 * the modifier class that keeps its label legible against that fill.
 *
 * Split out of RangeGrid so the three-case contract is unit-testable. The
 * explicit solid, fold, and mixed cases let CSS tune labels that sit on a full
 * fill, no fill, or both. In v2, mixed labels use dark ink with a light halo so
 * they stay legible across the split. See rangeCell.test.ts.
 */

/** Value steps of one hue in v2: raise/3-bet is the solid accent, call the
 *  light 200 step. */
const RAISE = "var(--color-accent)";
const CALL = "var(--color-accent-200)";

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

/* ------------------------------------------------------------------ *
 * Reading a cell — the touch path
 * ------------------------------------------------------------------ */

/**
 * A cell's action mix in words.
 *
 * Lives here rather than inline in `RangeGrid` because it now feeds two
 * places: the `title` (a mouse affordance) and the selected-cell detail row
 * (the touch and keyboard one). A tooltip was the ONLY way to read a cell's
 * frequencies, which meant that on a phone the exact mix of a hand was
 * unreachable — see M8.9A.
 *
 * `hasCall` distinguishes an open scenario (raise/fold) from a defence
 * (3-bet/call/fold); the label for the raise action differs accordingly.
 */
export function rangeCellDescription(
  hand: string,
  f: CellFrequency,
  hasCall: boolean
): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const parts = [`${pct(f.r)} ${hasCall ? "3-bet" : "raise"}`];
  if (hasCall) parts.push(`${pct(f.c)} call`);
  parts.push(`${pct(f.f)} fold`);
  return `${hand} — ${parts.join(", ")}`;
}

/**
 * Arrow-key movement across the 13x13 grid, as a flat index.
 *
 * The grid is a composite widget: 169 focusable cells would be 169 tab stops
 * between the page's real controls, so the cells carry a roving tabindex and
 * the arrows move within it. Movement CLAMPS at the edges rather than
 * wrapping — wrapping from the end of the suited row to the start of the next
 * reads as a jump when the thing on screen is a matrix.
 *
 * Returns the same index for keys it does not handle, so a caller can compare
 * and decide whether to preventDefault.
 */
export function moveGridSelection(index: number, key: string): number {
  const row = Math.floor(index / 13);
  const col = index % 13;
  switch (key) {
    case "ArrowRight": return row * 13 + Math.min(12, col + 1);
    case "ArrowLeft": return row * 13 + Math.max(0, col - 1);
    case "ArrowDown": return Math.min(12, row + 1) * 13 + col;
    case "ArrowUp": return Math.max(0, row - 1) * 13 + col;
    case "Home": return row * 13;
    case "End": return row * 13 + 12;
    default: return index;
  }
}
