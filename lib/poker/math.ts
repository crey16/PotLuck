/**
 * Poker betting math.
 *
 * ONE CONVENTION, USED EVERYWHERE — do not mix these up, it is the single
 * biggest source of wrong numbers in this domain:
 *
 *   pot  = the total pot AFTER villain's bet (their bet is already in it).
 *          This is what you win when you win.
 *   call = what it costs you to call.
 *
 * Functions that take `potBefore` are the exception and say so in the name:
 * when YOU are the one betting, the pot has not yet been raised by your bet.
 */

/** Equity you need for a call to break even. Half-pot bet -> 25%. Pot bet -> 33.3%. */
export const requiredEquity = (pot: number, call: number): number => call / (pot + call);

/** Expected value of calling, in chips. Positive means the call makes money. */
export const evOfCall = (equity: number, pot: number, call: number): number =>
  equity * pot - (1 - equity) * call;

/** How often villain must fold for a pure bluff to break even. Risk / (risk + reward). */
export const breakEvenFoldRate = (potBefore: number, bet: number): number =>
  bet / (potBefore + bet);

/** Minimum defence frequency — the share of your range you must continue with. */
export const minDefenceFrequency = (potBefore: number, bet: number): number =>
  potBefore / (potBefore + bet);

/** Bet size (as a fraction of pot) that breaks even at a given fold rate. */
export const bluffSizeForFoldRate = (foldRate: number): number => foldRate / (1 - foldRate);

/**
 * Extra money you must win on later streets for a call to break even when your
 * direct pot odds are not enough. Returns <= 0 when the call is already good.
 *
 * Capped in reality by the stack behind: implied odds are ZERO against an all-in.
 */
export const impliedOddsNeeded = (equity: number, pot: number, call: number): number =>
  (call * (1 - equity) - equity * pot) / equity;

/** Rule of 2 and 4, as taught. Accurate to ~1 point up to 8 outs. */
export const ruleOf2And4 = (outs: number, cardsToCome: 1 | 2): number =>
  outs * (cardsToCome === 2 ? 4 : 2);

/**
 * The correction worth knowing: above 8 outs the x4 rule double-counts the
 * runouts where you would have hit on both cards, so subtract one point per
 * out above 8. 15 outs -> 60% claimed, 53% corrected, 54% actual.
 */
export const ruleOf4Corrected = (outs: number): number =>
  outs > 8 ? 4 * outs - (outs - 8) : 4 * outs;

/** Exact chance of hitting with two cards to come, from 47 unseen. */
export const hitByRiver = (outs: number): number =>
  1 - ((47 - outs) * (46 - outs)) / (47 * 46);

/** Exact chance of hitting with one card to come, from 46 unseen. */
export const hitOnRiver = (outs: number): number => outs / 46;

/** Format equity as traditional odds, e.g. 0.25 -> "3.0 : 1". */
export const asOdds = (equity: number): string => `${((1 - equity) / equity).toFixed(1)} : 1`;

/**
 * Bet-size reference table. Percentages are of the pot BEFORE the bet.
 * Handy for UI and for sanity-checking any refactor of the formulas above.
 */
export const BET_SIZE_TABLE = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5, 2].map((fraction) => {
  const potBefore = 100;
  const bet = potBefore * fraction;
  return {
    fraction,
    label: `${Math.round(fraction * 100)}% pot`,
    callerNeeds: requiredEquity(potBefore + bet, bet),
    bluffNeedsFolds: breakEvenFoldRate(potBefore, bet),
    mdf: minDefenceFrequency(potBefore, bet),
  };
});
