"use client";

import { bbLoss } from "@/lib/play/units";
import type { Verdict } from "@/lib/play/verdict";

const WORD: Record<Verdict, string> = {
  correct: "Correct",
  acceptable: "Also fine",
  inaccuracy: "Inaccuracy",
  blunder: "Blunder",
};

/** Never colour alone — each verdict carries a glyph and a wordmark too. */
const GLYPH: Record<Verdict, string> = {
  correct: "✓",
  acceptable: "≈",
  inaccuracy: "!",
  blunder: "✕",
};

export interface VerdictFlashProps {
  verdict: Verdict | null;
  /** Exported EV-loss steps, or null for reference-graded preflop. */
  lossSteps: number | null;
  /** Bumped per decision so a repeat verdict re-runs the animation. */
  nonce: number;
}

/**
 * The non-blocking verdict.
 *
 * Renders alongside the hand as it continues, and fades on its own — there is
 * no button and nothing waits for it. This replaces the `.fb` panel, which
 * stopped the hand five times per hand and was the single biggest reason
 * /play read as a quiz rather than a game.
 *
 * The `key={nonce}` is load-bearing: the same verdict twice in a row is the
 * same element, and React would keep it mounted with its animation already
 * finished, so the second decision would flash nothing at all.
 */
export function VerdictFlash({ verdict, lossSteps, nonce }: VerdictFlashProps) {
  if (!verdict) return null;
  return (
    <div key={nonce} className={`pt-flash ${verdict}`} role="status">
      <span className="pt-flash-glyph" aria-hidden="true">
        {GLYPH[verdict]}
      </span>
      <span className="pt-flash-word">{WORD[verdict]}</span>
      {lossSteps !== null && lossSteps > 0 && (
        <span className="pt-flash-cost">−{bbLoss(lossSteps)}</span>
      )}
    </div>
  );
}
