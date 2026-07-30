/**
 * Shared "pick a pot, pick a bet-size fraction, round to a step" dealer.
 *
 * Before this file existed, bluff.ts, potodds.ts, ev.ts and decision.ts each
 * had a private copy of this routine, and two of them (decision, bluff) built
 * their "Bet size" pill from the pre-rounding fraction handed to the math
 * helpers rather than from the actual bet after `roundTo()` clamped it. When
 * `bet = Math.max(step, roundTo(potBefore * frac, step))` moves the bet away
 * from `potBefore * frac`, the pill silently disagreed with the number right
 * next to it (final-review finding CC-1).
 *
 * `frac` here is always recomputed from the rounded bet, so that bug is
 * unrepresentable. Level tables are genuinely different per drill and stay
 * local to each generator — only the pick/round/pill mechanics are shared.
 */
import { pick, roundTo } from "./opts";
import type { DrillContext } from "./contract";

export interface PotSpot {
  potBefore: number;
  bet: number;
  /** bet / potBefore, computed AFTER rounding — always the actual pot fraction. */
  frac: number;
}

export function dealPotSpot(
  ctx: DrillContext,
  potChoices: readonly number[],
  fracChoices: readonly number[],
  step = 5
): PotSpot {
  const potBefore = pick(potChoices, ctx.rng);
  const rawFrac = pick(fracChoices, ctx.rng);
  const bet = Math.max(step, roundTo(potBefore * rawFrac, step));
  return { potBefore, bet, frac: bet / potBefore };
}

/**
 * The "Bet size" pill, derived from the actual bet and pot — never from a
 * stored `frac` that might predate rounding.
 */
export function betSizePill(spot: {
  potBefore: number;
  bet: number;
}): { label: string; value: string } {
  return {
    label: "Bet size",
    value: `${Math.round((spot.bet / spot.potBefore) * 100)}% pot`,
  };
}
