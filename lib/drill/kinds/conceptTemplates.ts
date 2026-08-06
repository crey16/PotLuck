/**
 * Rule-backed templates for the "Common OMC math mistakes" concept drill.
 *
 * M5 finishes here. The drill used to draw from a 15-item static bank
 * (`CONCEPTS`), so the fifteenth question a player saw was guaranteed to be a
 * repeat of the first — the one hole the M5 anti-repeat window could not fill,
 * because there was nothing to re-roll into. Each bank item is now a
 * **template**: the same teaching point, with the cards, pot, bet, stack,
 * out count and action context dealt fresh every time.
 *
 * The rules this file obeys, all of them from CLAUDE.md and all of them
 * learned expensively:
 *
 * 1. **Every number comes from `lib/poker/math.ts` or the evaluator.** No
 *    template writes an arithmetic result into its own prose. The templates
 *    that quote a percentage compute it; the one that names a card asks
 *    `deadOuts` which card to name.
 * 2. **One betting convention.** `potBefore` is the pot before villain bets;
 *    `pot` is what you win, villain's bet included; `call` is what it costs.
 *    Templates name their locals accordingly.
 * 3. **The correct option is chosen by the math, not fixed by the author.**
 *    Several templates flip which option is right depending on what was
 *    dealt — `rule-choice` answers "×2" or "×4" by whether money is behind,
 *    `call-or-fold-price` answers call or fold by comparing real equity to
 *    the real price. A template whose answer never moves teaches players to
 *    pattern-match the option instead of the concept.
 *
 * Each `build` returns options with the correct answer already at a known
 * index; `concepts.ts` shuffles them. Distractors are built from mistakes
 * players actually make (quoting the pot before the bet, using ×4 with money
 * behind, counting implied odds against an all-in), not from arithmetic noise.
 */
import {
  cardStr,
  deadOuts,
  dealDrawSpot,
  deck,
  isPlausibleHand,
  outsVsHand,
  whoIsAhead,
  RANKS,
  SUITS,
  SUIT_GLYPH,
  type Card,
  type Spot,
} from "../../poker/engine";
import {
  breakEvenFoldRate,
  hitByRiver,
  hitOnRiver,
  impliedOddsNeeded,
  minDefenceFrequency,
  requiredEquity,
  ruleOf2And4,
  ruleOf4Corrected,
} from "../../poker/math";
import { money, pick, roundTo, sampleInt, sampleStepped, shuffled } from "../opts";
import type { DrillContext } from "../contract";

/** "Jh" -> "J♥". Display only; the engine's `cardStr` stays the data form. */
export const cardGlyph = (c: Card): string =>
  RANKS[c >> 2] + SUIT_GLYPH[SUITS[c & 3]];

const glyphs = (cards: Card[]): string => cards.map(cardGlyph).join("");

/** A ratio rendered the way a player says it out loud: "3.0 to 1". */
const asRatio = (a: number, b: number): string => `${(a / b).toFixed(1)} to 1`;

/** Percent with no decimal — for prose, where "24.6%" reads as false precision. */
const roundPct = (v: number): string => `${Math.round(v * 100)}%`;

export interface ConceptInstance {
  /** Stable template identity, carried into the payload and the signature. */
  templateId: string;
  prompt: string;
  /** Always four distinct strings. `concepts.ts` shuffles them. */
  options: string[];
  correct: number;
  /**
   * Indices that reach the same conclusion by other wording and so must also
   * grade as right. Kept from the static bank's finding L-7: telling a player
   * who reasoned correctly that they were wrong is worse than a repeat.
   */
  alsoAcceptable?: number[];
  explain: string;
  /**
   * What makes this "the same question" to a player — coarser than the
   * params. Two questions differing only in an option shuffle share it; two
   * differing in the dealt cards or the price do not.
   */
  signature: string;
  /** JSON-clean, and sufficient to re-derive the answer. */
  params: Record<string, unknown>;
}

export interface ConceptTemplate {
  id: string;
  /** Shown nowhere; it documents the teaching point in one line. */
  teaches: string;
  build: (ctx: DrillContext) => ConceptInstance;
}

/* ------------------------------------------------------------------ *
 * Shared dealing helpers
 * ------------------------------------------------------------------ */

/** A flop draw whose out count the engine vouches for. */
const dealDraw = (ctx: DrillContext): Spot =>
  dealDrawSpot({ street: "flop", level: ctx.level, rng: ctx.rng });

/** A pot before the bet, in the range the money drills already use. */
const dealPotBefore = (ctx: DrillContext): number =>
  sampleStepped(60, 260, 10, ctx.rng);

/* ------------------------------------------------------------------ *
 * The templates
 * ------------------------------------------------------------------ */

/**
 * Which rule applies — and the answer genuinely flips. All-in means both
 * cards arrive with no further betting, so ×4 is honest. Money behind means
 * you are usually paying for one card, so ×2 is honest. The static bank only
 * ever asked the all-in half, which made "Rule of 4" the answer every time.
 */
const ruleChoice: ConceptTemplate = {
  id: "rule-choice",
  teaches: "×4 is only honest when no more betting can happen",
  build: (ctx) => {
    const spot = dealDraw(ctx);
    const allIn = ctx.rng() < 0.5;
    const potBefore = dealPotBefore(ctx);
    const bet = roundTo(potBefore * sampleStepped(0.5, 1, 0.05, ctx.rng), 5);

    const options = [
      "Rule of 4 — both cards are coming and no more betting can happen",
      "Rule of 2 — you are paying for one card at a time",
      "Neither — multiply your outs by 3 instead",
      "Rule of 4, then halve the result",
    ];
    const correct = allIn ? 0 : 1;

    const byRiver = hitByRiver(spot.outs);
    const byTurn = hitOnRiver(spot.outs);

    return {
      templateId: "rule-choice",
      prompt: allIn
        ? `You flop ${spot.draw} and villain shoves all-in for ${money(bet)} into ${money(potBefore)}. Which rule prices the call?`
        : `You flop ${spot.draw}. Villain bets ${money(bet)} into ${money(potBefore)} and you both have plenty behind. Which rule prices the call?`,
      options,
      correct,
      explain: allIn
        ? `All-in means the turn and the river both arrive with nothing more to pay, so the ×4 estimate is the honest one: ${spot.outs} outs is about ${roundPct(byRiver)} by the river. The mistake is using ×4 when there is still betting to come — then you are usually buying one card, not two.`
        : `With money behind you are buying the turn, not the runout. Price it with ×2: ${spot.outs} outs is about ${roundPct(byTurn)} for the next card. Reaching for ×4's ${roundPct(byRiver)} counts a river you have not paid for and will often be charged for again.`,
      signature: `rule-choice|${allIn ? "allin" : "behind"}|${spot.draw}`,
      params: { allIn, outs: spot.outs, draw: spot.draw, potBefore, bet },
    };
  },
};

/**
 * The misquoted price. The classic error is quoting the pot *before* the bet
 * — "$100 and he bets $50, I'm getting 2 to 1" — when villain's bet is
 * already part of what you win. Half the time the OMC quotes it correctly and
 * the answer becomes "the ratio is right, but a price is not a reason to
 * call", which is the second half of the same lesson.
 */
const potOddsQuote: ConceptTemplate = {
  id: "pot-odds-quote",
  teaches: "the pot you win includes villain's bet; a price is only a threshold",
  build: (ctx) => {
    const potBefore = dealPotBefore(ctx);
    const bet = roundTo(potBefore * sampleStepped(0.4, 1, 0.05, ctx.rng), 5);
    const pot = potBefore + bet;
    const call = bet;
    const misquotes = ctx.rng() < 0.6;

    const trueRatio = asRatio(pot, call);
    const wrongRatio = asRatio(potBefore, call);
    const quoted = misquotes ? wrongRatio : trueRatio;
    const need = requiredEquity(pot, call);

    const options = misquotes
      ? [
          `He is getting ${trueRatio}, not ${quoted} — villain's bet is already part of what he wins`,
          `He is getting ${quoted}, and that alone makes it a call`,
          "Pot odds do not apply until the river",
          "He needs to subtract the rake before quoting a price",
        ]
      : [
          `The ratio is right — but ${quoted} only means he needs ${roundPct(need)}, not that any hand calls`,
          `He is getting ${wrongRatio} — the bet he is calling does not count toward the pot`,
          "Pot odds do not apply until the river",
          "He needs to subtract the rake before quoting a price",
        ];

    return {
      templateId: "pot-odds-quote",
      prompt: `The pot is ${money(potBefore)} and villain bets ${money(bet)}. An OMC says "I'm getting ${quoted}, easy call." What is wrong?`,
      options,
      correct: 0,
      explain: misquotes
        ? `Calling ${money(call)} to win ${money(pot)} is ${trueRatio} — he quoted the pot before the bet and undersold his own price. Either way the ratio is only half the job: ${trueRatio} sets a ${roundPct(need)} threshold, and he still has to know whether his hand clears it.`
        : `The ratio is correct: ${money(call)} to win ${money(pot)} is ${trueRatio}. What it buys him is a threshold — he needs ${roundPct(need)} equity — not a call. "Easy call" skips the only part that was ever in question.`,
      signature: `pot-odds-quote|${misquotes ? "wrong" : "right"}|${potBefore}|${bet}`,
      params: { potBefore, bet, pot, call, misquotes, need },
    };
  },
};

/**
 * Name the card that is not an out. Fully engine-derived: the spot is dealt
 * until `deadOuts` finds a genuine dead out and `outsVsHand` supplies three
 * genuine clean ones, so the four options are checked facts rather than
 * authored guesses. The static bank's version of this item shipped wrong in
 * every direction and survived because nothing tied it to the evaluator.
 *
 * **Deals its own cards rather than calling `dealVsHandSpot`.** That helper
 * runs `equityVsHand` — a 990-runout enumeration — on every spot it returns,
 * and this template needs no equity at all. Rejection-sampling it until a
 * dead out appeared cost **2.1 seconds per question**, measured, against
 * ~4ms for every other template. The predicates below are the ones
 * `dealVsHandSpot` applies (plausible holdings, hero behind) plus the two
 * this question actually requires, and nothing else is computed.
 */
const deadOutPick: ConceptTemplate = {
  id: "dead-out-pick",
  teaches: "a card that improves you and improves them more is not an out",
  build: (ctx) => {
    for (let attempt = 0; attempt < 20000; attempt++) {
      // Relax the COSMETIC filter after a while, exactly as `dealDrawSpot`
      // and `dealVsHandSpot` do. Requiring both holdings to be hands a real
      // player would hold rejects 87% of deals (measured), and only ~4% of
      // the survivors contain a dead out — together that is one qualifying
      // spot per ~645 deals, so a fixed 3,000-deal cap failed roughly 1% of
      // the time and took down a whole drill session when it did.
      //
      // What is relaxed is realism; what is never relaxed is the two
      // predicates the QUESTION depends on. A cosmetically odd villain hand
      // makes a slightly strange spot. A spot without a genuine dead out
      // makes a question with no correct answer, which is the bug this
      // template was written to eliminate.
      const loose = attempt > 800;
      const d = shuffled(deck(), ctx.rng);
      const hero = [d[0], d[1]];
      const villain = [d[2], d[3]];
      const board = d.slice(4, 7);

      // Cheapest predicates first — each one that rejects early saves the
      // 45-card evaluator sweeps below.
      if (!loose && (!isPlausibleHand(hero) || !isPlausibleHand(villain))) continue;
      if (whoIsAhead(hero, villain, board) !== -1) continue; // hero must be drawing

      const dead = deadOuts(hero, villain, board);
      if (!dead.length) continue;
      const clean = outsVsHand(hero, villain, board).clean;
      if (clean.length < 3) continue;

      const bad = dead[Math.floor(ctx.rng() * dead.length)];
      // Three clean outs, taken from a shuffled view so the option order is
      // not a tell about which card the evaluator listed first.
      const good = shuffled(clean, ctx.rng).slice(0, 3);

      const options = [
        `The ${cardGlyph(bad.card)}`,
        ...good.map((c) => `The ${cardGlyph(c)}`),
      ];

      return {
        templateId: "dead-out-pick",
        prompt: `Which of these is NOT a real out when you hold ${glyphs(hero)} on ${glyphs(board)} against ${glyphs(villain)}?`,
        options,
        correct: 0,
        explain: `The ${cardGlyph(bad.card)} gives you ${bad.you}, but it hands villain ${bad.them} — you improve and still lose, so it never counted. The other three are live: against ${glyphs(villain)} this hand has ${clean.length} real out${clean.length === 1 ? "" : "s"}, not the ${clean.length + dead.length} the draw appears to have. Checking what a card does for THEM before adding it to your total is the most expensive habit in live poker.`,
        signature: `dead-out-pick|${cardStr(hero[0])}${cardStr(hero[1])}|${board.map(cardStr).join("")}|${villain.map(cardStr).join("")}`,
        params: {
          hero,
          board,
          villain,
          deadCard: cardStr(bad.card),
          cleanOuts: clean.length,
        },
      };
    }
    // Unreachable in practice once the filter relaxes. Failing loudly beats
    // falling through to a question whose "not an out" really is one.
    throw new Error("dead-out-pick: no spot with a dead out and three clean outs in 20000 deals");
  },
};

/**
 * Why ×4 overstates a big draw, with the size of the lie computed rather than
 * asserted. `ruleOf2And4` gives the claim, `hitByRiver` the truth and
 * `ruleOf4Corrected` the fix — the three numbers that CLAUDE.md rule 4 exists
 * to keep honest.
 */
const rule4Overstates: ConceptTemplate = {
  id: "rule4-overstates",
  teaches: "×4 double-counts the runouts that hit on both cards",
  build: (ctx) => {
    const outs = sampleInt(9, 15, ctx.rng);
    const claimed = ruleOf2And4(outs, 2);
    const exact = hitByRiver(outs) * 100;
    const corrected = ruleOf4Corrected(outs);

    return {
      templateId: "rule4-overstates",
      prompt: `You are all-in on the flop with ${outs} outs. The Rule of 4 says ${claimed}%. Why is that too high, and what is the honest number?`,
      options: [
        `It double-counts the runouts you would have hit on both cards — it is about ${Math.round(exact)}%`,
        `It ignores villain's outs — it is about ${Math.round(exact) - 8}%`,
        `Nothing is wrong with it — ${claimed}% is exact`,
        `It assumes only one card is coming — it is about ${claimed + 6}%`,
      ],
      correct: 0,
      explain: `Multiplying by 4 treats the turn and the river as separate additive chances, so every runout that would have hit on BOTH gets counted twice. With ${outs} outs the claim is ${claimed}% and the truth is ${exact.toFixed(1)}%. The table fix is to subtract one point per out above 8: ${claimed} − ${outs - 8} = ${corrected}%, which is close enough to act on and stops you talking yourself into a coinflip you are losing.`,
      signature: `rule4-overstates|${outs}`,
      params: { outs, claimed, exact, corrected },
    };
  },
};

/**
 * Call or fold at a real price, with a real draw. The answer moves with what
 * was dealt — this is the template that most directly punishes pattern
 * matching, because "9 outs" is a call at one price and a fold at another.
 */
const callOrFoldPrice: ConceptTemplate = {
  id: "call-or-fold-price",
  teaches: "outs mean nothing until they are compared to the price",
  build: (ctx) => {
    // The verdict is chosen FIRST and the price is then built to produce it.
    //
    // Sampling the price freely and reporting whatever fell out looked
    // reasonable and was measurably broken: a turn draw of 4–12 outs is worth
    // 8.7%–26%, while a 30%–110% pot bet demands 18.8%–34.4%, so the honest
    // answer was "fold" in 93% of deals (140 of 150, caught by this
    // template's own test). A concept drill whose answer is nearly always the
    // same teaches players to skip the reasoning, which is the exact habit
    // this drill exists to break.
    //
    // The break-even bet fraction for equity e solves f/(1+2f) = e, i.e.
    // f* = e/(1−2e). Below it the call is right, above it the fold is. The
    // final verdict is still recomputed from the rounded numbers rather than
    // assumed — rounding the bet to $5 can cross the line.
    const wantCall = ctx.rng() < 0.5;
    let spot!: Spot;
    let potBefore = 0;
    let bet = 0;

    for (let attempt = 0; attempt < 60; attempt++) {
      spot = dealDrawSpot({ street: "turn", level: ctx.level, rng: ctx.rng });
      const e = hitOnRiver(spot.outs);
      const breakEvenFraction = e / (1 - 2 * e);
      // A draw too weak to ever be a call at a sane price cannot host the
      // "call" branch; re-deal rather than bend the price into absurdity.
      if (wantCall && breakEvenFraction < 0.2) continue;

      potBefore = dealPotBefore(ctx);
      const fraction = wantCall
        ? sampleStepped(0.15, Math.min(1.1, breakEvenFraction * 0.85), 0.05, ctx.rng)
        : sampleStepped(Math.max(0.2, breakEvenFraction * 1.2), 1.6, 0.05, ctx.rng);
      bet = Math.max(5, roundTo(potBefore * fraction, 5));

      if (e > requiredEquity(potBefore + bet, bet) === wantCall) break;
    }

    const outs = spot.outs;
    const pot = potBefore + bet;
    const call = bet;

    const equity = hitOnRiver(outs);
    const need = requiredEquity(pot, call);
    const isCall = equity > need;

    const options = [
      isCall
        ? `Call — the price needs ${roundPct(need)} and ${outs} outs is about ${roundPct(equity)}`
        : `Fold — the price needs ${roundPct(need)} and ${outs} outs is only about ${roundPct(equity)}`,
      `${isCall ? "Fold" : "Call"} — ${outs} outs is ${isCall ? "never" : "always"} enough on the turn`,
      `Call — ${outs} outs times 4 is ${ruleOf2And4(outs, 2)}%, comfortably above the price`,
      "Raise — the outs plus fold equity make it profitable either way",
    ];

    return {
      templateId: "call-or-fold-price",
      prompt: `The pot is ${money(pot)} after villain bets ${money(bet)} on the turn. You have ${spot.draw} — ${outs} outs, one card to come. Call or fold?`,
      options,
      correct: 0,
      explain: `One card to come, so price it with ×2: ${outs} outs is about ${(equity * 100).toFixed(1)}%. The price is ${money(call)} to win ${money(pot)}, which demands ${(need * 100).toFixed(1)}%. ${
        isCall
          ? `Equity clears the threshold, so the direct call is already profitable before any implied odds.`
          : `Equity falls short, so this is a fold on direct odds — the classic "but I have a draw!" trap. Only implied odds can rescue it, and they have to be real money you will actually collect.`
      } Note that ${outs} outs would be the opposite answer at a different price; the out count alone never decides anything.`,
      signature: `call-or-fold-price|${outs}|${potBefore}|${bet}`,
      params: { outs, draw: spot.draw, potBefore, bet, pot, call, equity, need, isCall },
    };
  },
};

/**
 * Which of four sampled bet sizes needs the fewest folds. The sizes vary, so
 * the answer is not permanently "1/3 pot" — but it is always the smallest,
 * which is the point `breakEvenFoldRate` makes.
 */
const cheapestBluff: ConceptTemplate = {
  id: "cheapest-bluff",
  teaches: "risk / (risk + reward) — small bluffs need to work least often",
  build: (ctx) => {
    const ladder = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5];
    const start = sampleInt(0, ladder.length - 4, ctx.rng);
    const sizes = ladder.slice(start, start + 4);
    const label = (f: number) =>
      f === 1 ? "Pot" : f === 1.5 ? "1.5× pot" : `${Math.round(f * 100)}% pot`;

    const options = sizes.map(label);
    // The smallest size always needs the fewest folds; find it by the formula
    // rather than by assuming the slice is ordered.
    let correct = 0;
    for (let i = 1; i < sizes.length; i++) {
      if (breakEvenFoldRate(100, 100 * sizes[i]) < breakEvenFoldRate(100, 100 * sizes[correct])) {
        correct = i;
      }
    }

    const table = sizes
      .map((f) => `${label(f)} needs ${roundPct(breakEvenFoldRate(100, 100 * f))}`)
      .join(", ");

    return {
      templateId: "cheapest-bluff",
      prompt: "Which of these bet sizes needs villain to fold least often for a pure bluff to break even?",
      options,
      correct,
      explain: `Risk ÷ (risk + reward): ${table}. The smallest bet always needs the fewest folds, which is why a small bluff can be run with a much wider range than a big one — and why "I bet big to make him fold" is backwards as a reason to size up.`,
      signature: `cheapest-bluff|${sizes.join(",")}`,
      params: { sizes, correctFraction: sizes[correct] },
    };
  },
};

/**
 * The concept that makes over-folding exploitable, with the actual defence
 * requirement computed from the sampled size.
 */
const mdfOverfold: ConceptTemplate = {
  id: "mdf-overfold",
  teaches: "minimum defence frequency",
  build: (ctx) => {
    const potBefore = dealPotBefore(ctx);
    const fraction = pick([0.33, 0.5, 0.66, 0.75, 1], ctx.rng);
    const bet = roundTo(potBefore * fraction, 5);
    const mdf = minDefenceFrequency(potBefore, bet);
    const bluffNeeds = breakEvenFoldRate(potBefore, bet);

    return {
      templateId: "mdf-overfold",
      prompt: `Villain bets ${money(bet)} into ${money(potBefore)} on every turn, and an OMC folds nearly all of them, saying "I can't call without the nuts." Which concept says this is exploitable?`,
      options: [
        "Minimum defence frequency",
        "Implied odds",
        "The rule of 2 and 4",
        "Reverse implied odds",
      ],
      correct: 0,
      explain: `Against a ${Math.round(fraction * 100)}%-pot bet, minimum defence frequency says you must continue with about ${roundPct(mdf)} of your range. Fold more than that and villain's bluffs print automatically: a bet of ${money(bet)} into ${money(potBefore)} only needs to work ${roundPct(bluffNeeds)} of the time, and an opponent who folds ${roundPct(1 - mdf)}-plus hands it to them with any two cards.`,
      signature: `mdf-overfold|${fraction}`,
      params: { potBefore, bet, fraction, mdf, bluffNeeds },
    };
  },
};

/**
 * What implied odds are worth given the stack actually behind. The answer
 * moves: sometimes the stack covers the shortfall, sometimes it cannot, and
 * sometimes calling is already all-in and the whole idea is void.
 */
const impliedCappedByStack: ConceptTemplate = {
  id: "implied-capped-by-stack",
  teaches: "implied odds are capped by the money still behind",
  build: (ctx) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const spot = dealDrawSpot({ street: "turn", level: ctx.level, rng: ctx.rng });
      const potBefore = dealPotBefore(ctx);
      const bet = roundTo(potBefore * sampleStepped(0.6, 1.4, 0.05, ctx.rng), 5);
      const pot = potBefore + bet;
      const call = bet;
      const equity = hitOnRiver(spot.outs);
      const need = impliedOddsNeeded(equity, pot, call);
      if (need <= 0) continue; // direct call already good — nothing to teach

      // Three worlds: all-in (nothing behind), a stack that cannot bridge the
      // gap, and one that can. Chosen explicitly so all three get taught.
      const world = sampleInt(0, 2, ctx.rng);
      const behind =
        world === 0 ? 0
          : world === 1 ? roundTo(need * sampleStepped(0.3, 0.7, 0.05, ctx.rng), 5)
            : roundTo(need * sampleStepped(1.6, 3, 0.1, ctx.rng), 5);

      const options =
        world === 0
          ? [
              "Nothing — calling puts you all-in, so there is no later street to collect on",
              `About ${money(pot)} — the size of the pot you are playing for`,
              `About ${money(call)} — you win back what you called`,
              "Double, because the draw is still live",
            ]
          : [
              behind >= need
                ? `Enough — you need about ${money(need)} more and there is ${money(behind)} behind`
                : `Not enough — you need about ${money(need)} more and there is only ${money(behind)} behind`,
              behind >= need
                ? `Not enough — ${money(behind)} behind can never bridge the gap`
                : `Enough — ${money(behind)} behind is plenty for a draw this good`,
              "Irrelevant — implied odds only apply on the flop",
              "Unlimited — a draw to the nuts always gets paid in full",
            ];

      const prompt =
        world === 0
          ? `Villain bets ${money(bet)} into ${money(potBefore)} on the turn and you have exactly ${money(call)} left. You hold ${spot.draw}. How much are your implied odds worth?`
          : `Villain bets ${money(bet)} into ${money(potBefore)} on the turn. You hold ${spot.draw} and there is ${money(behind)} behind after the call. Are your implied odds enough?`;

      const explain =
        world === 0
          ? `Implied odds are money you collect on a LATER street, and calling here leaves none — you are all-in, so the river is dealt with no betting. Price it on direct pot odds alone: ${money(call)} to win ${money(pot)} needs ${roundPct(requiredEquity(pot, call))}, and ${spot.outs} outs on the turn is about ${roundPct(equity)}.`
          : `Direct odds fall short: ${money(call)} to win ${money(pot)} demands ${roundPct(requiredEquity(pot, call))} and ${spot.outs} outs is about ${roundPct(equity)}. Closing that gap needs roughly ${money(need)} extra on the river, on average across every time you hit. There is ${money(behind)} behind, so the call ${behind >= need ? "can be justified — provided villain actually pays" : "cannot be rescued: the money simply is not there"}. Implied odds are always capped by the stack, never by how much you like your draw.`;

      return {
        templateId: "implied-capped-by-stack",
        prompt,
        options,
        correct: 0,
        explain,
        signature: `implied-capped-by-stack|${world}|${spot.outs}|${potBefore}|${bet}`,
        params: { world, outs: spot.outs, draw: spot.draw, potBefore, bet, pot, call, behind, need },
      };
    }
    throw new Error("implied-capped-by-stack: no spot needing implied odds in 200 deals");
  },
};

/**
 * Results versus decisions, asked about a concrete call at a concrete price
 * so the abstraction has something to bite on.
 */
const resultsOriented: ConceptTemplate = {
  id: "results-oriented",
  teaches: "one result says nothing about one decision",
  build: (ctx) => {
    const potBefore = dealPotBefore(ctx);
    const bet = roundTo(potBefore * sampleStepped(0.4, 1, 0.05, ctx.rng), 5);
    const pot = potBefore + bet;
    const need = requiredEquity(pot, bet);
    const held = Math.min(0.9, need + sampleStepped(0.05, 0.25, 0.01, ctx.rng));
    const street = pick(["turn", "river"], ctx.rng);

    return {
      templateId: "results-oriented",
      prompt: `You call a ${money(bet)} ${street} bet into ${money(potBefore)} holding about ${roundPct(held)} equity, and you lose. Was the call a mistake?`,
      options: [
        `No — the price needed ${roundPct(need)} and you had about ${roundPct(held)}; the card is not the evidence`,
        "Yes — you lost money, so the call was wrong",
        `Yes — you should never call a ${street} bet without the nuts`,
        "Can't say — it depends whether villain would have shown you the bluff",
      ],
      correct: 0,
      explain: `The price demanded ${roundPct(need)} and you held about ${roundPct(held)}, so the call made money the moment it was made. It also loses roughly ${roundPct(1 - held)} of the time — that is what "${roundPct(held)}" means, not a promise. Judge the decision by the price and your equity; a single result is a sample of one and carries no information about either.`,
      signature: `results-oriented|${street}|${potBefore}|${bet}`,
      params: { potBefore, bet, pot, need, held, street },
    };
  },
};

/**
 * What equity actually is, with the worked example dealt fresh so the number
 * in the explanation is never the same one twice.
 */
const equityMeaning: ConceptTemplate = {
  id: "equity-meaning",
  teaches: "equity is your share of the pot, not your investment",
  build: (ctx) => {
    const pot = sampleStepped(120, 400, 20, ctx.rng);
    const equity = sampleStepped(0.2, 0.65, 0.05, ctx.rng);
    const share = Math.round(pot * equity);

    return {
      templateId: "equity-meaning",
      prompt: `In a ${money(pot)} pot you have about ${roundPct(equity)} equity. What does that actually mean?`,
      options: [
        `About ${money(share)} of that pot is already yours in the long run`,
        `You have ${money(share)} invested in the hand so far`,
        `You can expect to win about ${money(share)} more on later streets`,
        `Your stack is about ${roundPct(equity)} of the pot`,
      ],
      correct: 0,
      explain: `Equity is an ownership share, not an investment and not a future profit. ${roundPct(equity)} of ${money(pot)} is ${money(share)}, and that ${money(share)} is yours right now in expectation — every other calculation in poker compares it against what staying in costs. Note it says nothing about what you have already put in: that money is the pot's, not yours, which is exactly why it cannot justify a call.`,
      signature: `equity-meaning|${pot}|${equity.toFixed(2)}`,
      params: { pot, equity, share },
    };
  },
};

/**
 * The break-even identity, phrased against a live price so the player has to
 * recognise the formula rather than recite it.
 */
const breakEvenIdentity: ConceptTemplate = {
  id: "break-even-identity",
  teaches: "equity = call / (pot + call) is the line between printing and leaking",
  build: (ctx) => {
    const potBefore = dealPotBefore(ctx);
    const bet = roundTo(potBefore * sampleStepped(0.4, 1.2, 0.05, ctx.rng), 5);
    const pot = potBefore + bet;
    const call = bet;
    const need = requiredEquity(pot, call);

    return {
      templateId: "break-even-identity",
      prompt: `Facing ${money(call)} to win ${money(pot)}, what makes your call exactly break-even?`,
      options: [
        `Your equity equals call ÷ (pot + call) — ${roundPct(need)} here`,
        "You win exactly half the time",
        `The pot is twice the bet`,
        `Your outs times 2 equals the bet size`,
      ],
      correct: 0,
      explain: `${money(call)} ÷ (${money(pot)} + ${money(call)}) = ${(need * 100).toFixed(1)}%. That single identity is where pot odds, equity and EV meet: above the threshold the call prints, below it the call leaks, and the size of the gap is the size of the mistake. Note the pot in the denominator already contains villain's bet — mixing that up is the most common way this formula is misapplied.`,
      signature: `break-even-identity|${potBefore}|${bet}`,
      params: { potBefore, bet, pot, call, need },
    };
  },
};

/**
 * Reverse implied odds against an opponent who does not bluff, with the draw
 * dealt so "non-nut" is a property of the actual hand rather than a stated
 * premise.
 */
const reverseImplied: ConceptTemplate = {
  id: "reverse-implied",
  teaches: "hitting is not winning when only better hands pay you",
  build: (ctx) => {
    const spot = dealDraw(ctx);
    const opponent = pick(
      ["who has not bluffed once all night", "who only ever bets made hands", "who checks back every marginal hand"],
      ctx.rng
    );

    return {
      templateId: "reverse-implied",
      prompt: `You hold ${spot.draw} — but not to the nuts — against an opponent ${opponent}. How should you treat your implied odds?`,
      options: [
        "Discount them hard — the times you get paid are the times you are beaten",
        "Raise them — a player this straightforward always pays you off",
        "Ignore the opponent — a made hand is a made hand",
        "Fold every draw against this player type",
      ],
      correct: 0,
      explain: `Implied odds assume that hitting means collecting. Against someone ${opponent}, the streets where they keep betting after your card arrives are disproportionately the streets where they have you beaten — you win a small pot and lose a big one. That is reverse implied odds, and a non-nut ${spot.draw} is exactly the holding it punishes. The fix is not to fold every draw: it is to price the call on direct odds and treat the future money as close to zero.`,
      signature: `reverse-implied|${spot.draw}|${opponent}`,
      params: { draw: spot.draw, outs: spot.outs, opponent },
    };
  },
};

/**
 * The full set. Order is stable so `payload.templateId` stays comparable
 * across releases; append new templates rather than inserting.
 */
export const CONCEPT_TEMPLATES: ConceptTemplate[] = [
  ruleChoice,
  potOddsQuote,
  deadOutPick,
  rule4Overstates,
  callOrFoldPrice,
  cheapestBluff,
  mdfOverfold,
  impliedCappedByStack,
  resultsOriented,
  equityMeaning,
  breakEvenIdentity,
  reverseImplied,
];
