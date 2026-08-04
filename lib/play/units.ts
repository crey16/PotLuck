/**
 * Big-blind display for the play mode.
 *
 * The solver exports chips as tenths of a big blind (lib/play/types.ts), and
 * `lib/play/actions.ts` renders them as dollars at $1 per chip. Dollars are
 * wrong for a table: every solver tool and every player discussing these spots
 * works in bb, stack depths only read correctly in bb, and the roadmap's M10B
 * says so explicitly. Persistence is unaffected — it already stores EV loss in
 * big blinds.
 */
import { EV_STEP_BB } from "./verdict";

/** Chips are tenths of a big blind: 25 chips = 2.5bb. */
export const chipsToBb = (chips: number): number => chips / 10;

/**
 * Trim to at most `decimals` places, with no trailing ".0" — "1bb", not
 * "1.0bb".
 */
function format(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Pots, bets and stacks. One decimal is exact: chips are tenths of a bb, so
 * every such value lands on a tenth already.
 */
export const bb = (chips: number): string => `${format(chipsToBb(chips), 1)}bb`;

/** "+2.5bb" / "−2.5bb" — true minus sign U+2212, as the drills use. */
export const signedBb = (chips: number): string => {
  const value = chipsToBb(chips);
  return (value >= 0 ? "+" : "−") + `${format(Math.abs(value), 1)}bb`;
};

/**
 * An exported EV-loss step (0.05bb each) as a bb string.
 *
 * TWO decimals, not one. EV losses land on half-tenths, so one decimal rounds
 * a 0.75bb loss to "0.8bb" — and 0.75bb is exactly the blunder threshold in
 * `verdict.ts`, so the display would contradict the verdict beside it. This is
 * the same trap `moneyExact` in actions.ts exists to avoid.
 */
export const bbLoss = (evStepLoss: number): string =>
  `${format(evStepLoss * EV_STEP_BB, 2)}bb`;
