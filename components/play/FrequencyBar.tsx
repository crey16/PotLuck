"use client";

/**
 * A solver frequency, drawn.
 *
 * **Never colour alone.** The bar carries the numeric percentage beside it and
 * a `title`, and the chosen action is marked with a glyph rather than only a
 * tint — the same rule `VerdictFlash` follows. A player who cannot distinguish
 * the accent from the surface must still be able to read a mixed node, and
 * "which action did I take" must never depend on seeing a highlight.
 *
 * The bar is deliberately not a chart: at four actions a row of proportional
 * bars is read faster than any pie or stacked strip, and it degrades to plain
 * text with no layout collapse when styles fail to load.
 */
export interface FrequencyBarProps {
  /** 0..1. */
  frequency: number;
  /** Renders the bar in the "this is a real part of the strategy" weight. */
  mixed?: boolean;
  /** Shown to screen readers in place of the raw number. */
  label: string;
}

export function FrequencyBar({ frequency, mixed = false, label }: FrequencyBarProps) {
  const pct = Math.round(frequency * 100);
  return (
    <span
      className="pt-freq"
      role="img"
      aria-label={`${label}: solver frequency ${pct}%`}
      title={`Solver plays this ${pct}% of the time`}
    >
      <span className="pt-freq-track" aria-hidden="true">
        <i style={{ width: `${Math.max(frequency > 0 ? 2 : 0, pct)}%` }} className={mixed ? "mixed" : ""} />
      </span>
      <span className="pt-freq-num" aria-hidden="true">
        {pct}%
      </span>
    </span>
  );
}
