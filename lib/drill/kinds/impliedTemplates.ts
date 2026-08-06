/**
 * Rule-backed templates for the implied-odds drill's **concept** mode.
 *
 * M5 completion, second half. The concept half of `implied` drew from a
 * six-item static bank, which meant a player who chose the concept branch
 * seven times had certainly seen a repeat — and unlike the eight procedural
 * drills, the anti-repeat window had nothing to re-roll into.
 *
 * Two of these templates are **imported from `conceptTemplates.ts` rather
 * than copied**. The original two banks genuinely overlapped: both taught
 * "implied odds are capped by the stack behind" and both taught "equity is
 * your share of the pot". Reimplementing them here would create the exact
 * failure CLAUDE.md warns about everywhere else in this codebase — two
 * implementations of one idea, drifting apart the first time one is edited.
 *
 * The reverse-implied-odds judgments the roadmap flagged ("constrained by
 * explicit tested rules rather than free-form plausible text") are handled by
 * deriving *nuttedness from the actual cards*: `nutDrawQuality` asks the
 * evaluator whether the hero's flush draw is to the ace, and the correct
 * answer flips accordingly. No template asserts a hand is "non-nut" as a
 * premise the player has to take on faith.
 */
import {
  rankOf,
  suitOf,
  dealDrawSpot,
  type Card,
  type Spot,
} from "../../poker/engine";
import {
  hitOnRiver,
  impliedOddsNeeded,
  requiredEquity,
} from "../../poker/math";
import { money, pick, roundTo, sampleStepped } from "../opts";
import {
  CONCEPT_TEMPLATES,
  type ConceptInstance,
  type ConceptTemplate,
} from "./conceptTemplates";
import type { DrillContext } from "../contract";

export type { ConceptInstance, ConceptTemplate };

const roundPct = (v: number): string => `${Math.round(v * 100)}%`;

/** Pull a shared template out of the concepts set by id — never re-author it. */
function shared(id: string): ConceptTemplate {
  const t = CONCEPT_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`impliedTemplates: shared template "${id}" no longer exists`);
  return t;
}

/**
 * Is the hero's flush draw to the ace? Answered from the cards, because
 * "you hold the second-nut flush draw" is exactly the kind of premise that
 * goes stale when the spot behind it is regenerated.
 *
 * Returns null when there is no flush draw at all — the caller re-deals.
 */
export function flushDrawQuality(
  hero: Card[],
  board: Card[]
): { suit: number; isNut: boolean; topCard: number } | null {
  const all = [...hero, ...board];
  for (const suit of new Set(hero.map(suitOf))) {
    const count = all.filter((c) => suitOf(c) === suit).length;
    if (count !== 4) continue;
    const heroRanks = hero.filter((c) => suitOf(c) === suit).map(rankOf);
    if (!heroRanks.length) continue;
    // The nut draw is the one holding the highest suited card still unseen —
    // with four of the suit visible, that is the ace unless the ace is on the
    // board, in which case the king plays, and so on.
    const seen = new Set(all.filter((c) => suitOf(c) === suit).map(rankOf));
    let best = 14;
    while (best >= 2 && seen.has(best) && !heroRanks.includes(best)) best--;
    const topCard = best;
    return { suit, isNut: heroRanks.includes(topCard), topCard };
  }
  return null;
}

/**
 * Deal a flop flush draw, retrying until one exists. Used by the two
 * templates whose lesson depends on draw quality rather than on price.
 */
function dealFlushDraw(ctx: DrillContext): { spot: Spot; quality: NonNullable<ReturnType<typeof flushDrawQuality>> } {
  for (let attempt = 0; attempt < 400; attempt++) {
    const spot = dealDrawSpot({ street: "flop", level: 3, rng: ctx.rng });
    const quality = flushDrawQuality(spot.hero, spot.board);
    if (quality) return { spot, quality };
  }
  throw new Error("impliedTemplates: no flush draw in 400 deals");
}

const RANK_WORD: Record<number, string> = {
  14: "ace", 13: "king", 12: "queen", 11: "jack", 10: "ten",
  9: "nine", 8: "eight", 7: "seven", 6: "six", 5: "five", 4: "four", 3: "three", 2: "two",
};

/**
 * Nut versus non-nut draw against an opponent who does not bluff. The answer
 * flips with the cards: a nut draw's implied odds are real, a second-best
 * draw's are the trap. The old bank could only ever ask the trap half.
 */
const nutDrawQuality: ConceptTemplate = {
  id: "nut-draw-quality",
  teaches: "reverse implied odds are a property of the hand, not of the draw type",
  build: (ctx): ConceptInstance => {
    const { spot, quality } = dealFlushDraw(ctx);
    const suitName = ["spades", "hearts", "diamonds", "clubs"][quality.suit];
    const nutCard = `${RANK_WORD[quality.topCard]} of ${suitName}`;

    const options = quality.isNut
      ? [
          "Count them close to full — when this draw hits, nothing beats it",
          "Discount them hard — you will often hit and still be second best",
          "Ignore them; only direct pot odds ever matter",
          "Treat them as zero against an opponent who does not bluff",
        ]
      : [
          "Discount them hard — the times they pay you are the times you are beaten",
          "Count them close to full — a flush is a flush",
          "Ignore them; only direct pot odds ever matter",
          "Raise your estimate, because a straightforward opponent always pays",
        ];

    return {
      templateId: "nut-draw-quality",
      prompt: `You flop a flush draw in ${suitName} against an opponent who only bets made hands, and there is plenty behind. ${
        quality.isNut
          ? `You hold the ${nutCard}.`
          : `The ${nutCard} is not in your hand.`
      } How should you treat your implied odds?`,
      options,
      correct: 0,
      explain: quality.isNut
        ? `You hold the ${nutCard}, so when the suit arrives you hold the best possible flush — there is no version of this hand where you complete your draw and pay off a bigger one. That is the case where implied odds are genuinely collectable, and against an opponent who only bets made hands it is also the case where they will be paid: they cannot fold a strong second-best hand fast enough. Note this is the exception, not the rule; the same draw without the ${nutCard} is the trap in the next paragraph.`
        : `You do not hold the ${nutCard}, so the suit arriving is not the end of the story — someone holding it beats you, and against an opponent who only bets made hands, the streets where they keep betting after your card lands are disproportionately those streets. You win a small pot and lose a big one. That asymmetry is reverse implied odds, and it means the future money you were counting on is worth far less than the stack size suggests. Price the call on direct odds and treat the implied portion as near zero.`,
      signature: `nut-draw-quality|${quality.isNut ? "nut" : "second"}|${quality.suit}|${quality.topCard}`,
      params: {
        hero: spot.hero,
        board: spot.board,
        outs: spot.outs,
        suit: quality.suit,
        topCard: quality.topCard,
        isNut: quality.isNut,
      },
    };
  },
};

/**
 * Facing an all-in: implied odds are exactly zero, and the ×4 rule becomes
 * fully valid at the same moment. Numbers dealt fresh so the lesson is not
 * attached to one memorised pot.
 */
const allInNoImplied: ConceptTemplate = {
  id: "allin-no-implied",
  teaches: "no later street means no later money — and ×4 finally tells the truth",
  build: (ctx): ConceptInstance => {
    const spot = dealDrawSpot({ street: "flop", level: ctx.level, rng: ctx.rng });
    const potBefore = sampleStepped(60, 240, 10, ctx.rng);
    const bet = roundTo(potBefore * sampleStepped(0.6, 1.3, 0.05, ctx.rng), 5);
    const pot = potBefore + bet;
    const call = bet;
    const need = requiredEquity(pot, call);

    return {
      templateId: "allin-no-implied",
      prompt: `Villain shoves ${money(bet)} into ${money(potBefore)} on the flop and you hold ${spot.draw}. How much are your implied odds worth?`,
      options: [
        "Zero — there is no later street on which to win anything more",
        "Double, because two cards are still coming",
        "The same as any other flop call of this size",
        `About ${money(Math.round(bet / 2))} — half of what villain shoved`,
      ],
      correct: 0,
      explain: `Implied odds are money collected on a LATER street. An all-in removes every later street, so the figure is exactly zero and the call must stand on direct odds alone: ${money(call)} to win ${money(pot)} needs ${roundPct(need)}, and ${spot.outs} outs with both cards coming is about ${roundPct(spot.equity)}. This is also the one spot where the ×4 rule is fully honest, because you are genuinely guaranteed to see both cards — everywhere else it quietly assumes a free river.`,
      signature: `allin-no-implied|${spot.outs}|${potBefore}|${bet}`,
      params: {
        outs: spot.outs, draw: spot.draw, equity: spot.equity,
        potBefore, bet, pot, call, need,
      },
    };
  },
};

/**
 * Which draw actually collects. Implied odds depend on being invisible when
 * you hit; the four candidates are sampled so the answer is not always the
 * same phrase in the same position.
 */
const disguisedGetsPaid: ConceptTemplate = {
  id: "disguised-gets-paid",
  teaches: "implied odds need the draw to be invisible when it completes",
  build: (ctx): ConceptInstance => {
    const hidden = pick(
      [
        "a well-disguised gutshot",
        "a middle-pin double gutshot",
        "bottom two pair looking to fill up",
      ],
      ctx.rng
    );
    const obvious = [
      "a four-flush on a monotone board",
      "an open-ender on a board that already pairs",
      "the obvious straight card everyone at the table can see",
      "top pair with a weak kicker",
    ];
    // Three visible draws, sampled, so the distractor set moves too.
    const shuffledObvious = obvious.slice();
    for (let i = shuffledObvious.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      [shuffledObvious[i], shuffledObvious[j]] = [shuffledObvious[j], shuffledObvious[i]];
    }

    const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

    return {
      templateId: "disguised-gets-paid",
      prompt: "Against a tight opponent who only pays off with strong hands, which of these has the best implied odds?",
      options: [cap(hidden), ...shuffledObvious.slice(0, 3).map(cap)],
      correct: 0,
      explain: `Implied odds are the money you collect after you hit, and you only collect it if your opponent does not see it coming. ${cap(hidden)} completes without changing what the board looks like, so a tight player keeps betting their strong hand into you. The others announce themselves: a third suit landing, a fourth straight card, an obvious pair — a tight opponent shuts down the moment those arrive, and the extra money you were pricing the call with never appears. Note the shape of the mistake: the biggest draw is usually the one with the WORST implied odds, because it is the most visible.`,
      signature: `disguised-gets-paid|${hidden}|${shuffledObvious.slice(0, 3).sort().join("/")}`,
      params: { hidden, distractors: shuffledObvious.slice(0, 3) },
    };
  },
};

/**
 * You called on implied odds, hit, and villain checked. The lesson is that
 * implied odds are an average over every time you hit — including the times
 * nobody pays. The shortfall is computed so the size of the miscalculation
 * is concrete.
 */
const impliedMoneyMaterialises: ConceptTemplate = {
  id: "implied-money-materialises",
  teaches: "implied odds are an average, not a promise",
  build: (ctx): ConceptInstance => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const spot = dealDrawSpot({ street: "turn", level: ctx.level, rng: ctx.rng });
      const potBefore = sampleStepped(70, 240, 10, ctx.rng);
      const bet = roundTo(potBefore * sampleStepped(0.7, 1.5, 0.05, ctx.rng), 5);
      const pot = potBefore + bet;
      const call = bet;
      const equity = hitOnRiver(spot.outs);
      const need = impliedOddsNeeded(equity, pot, call);
      if (need <= 0) continue;

      return {
        templateId: "implied-money-materialises",
        prompt: `You call a ${money(bet)} turn bet into ${money(potBefore)} purely on implied odds with ${spot.draw}, hit your card, and villain checks the river and folds to your bet. What did you get wrong?`,
        options: [
          `You overestimated how often the extra ${money(need)} actually turns up`,
          "Nothing — you won the pot, so the call worked",
          "You should have raised the turn instead of calling",
          "Implied odds only apply on the flop, never the turn",
        ],
        correct: 0,
        explain: `The call needed roughly ${money(need)} extra on the river to break even — that is what ${money(call)} to win ${money(pot)} with about ${roundPct(equity)} equity demands. But that figure is an AVERAGE across every time you hit, and this is one of the times villain shuts down and pays nothing. If you priced the call assuming a full stack every time you got there, you were calling with money that only shows up in some of those runouts. Winning this particular pot does not vindicate the arithmetic; it just means the shortfall was invisible.`,
        signature: `implied-money-materialises|${spot.outs}|${potBefore}|${bet}`,
        params: {
          outs: spot.outs, draw: spot.draw, potBefore, bet, pot, call, equity, need,
        },
      };
    }
    throw new Error("implied-money-materialises: no spot needing implied odds in 200 deals");
  },
};

/**
 * The full concept set for the implied drill.
 *
 * `implied-capped-by-stack` and `equity-meaning` are the SAME template
 * objects the concepts drill uses. Both banks taught both ideas; sharing the
 * implementation is what keeps them from drifting.
 */
export const IMPLIED_CONCEPT_TEMPLATES: ConceptTemplate[] = [
  nutDrawQuality,
  allInNoImplied,
  shared("implied-capped-by-stack"),
  disguisedGetsPaid,
  impliedMoneyMaterialises,
  shared("equity-meaning"),
];
