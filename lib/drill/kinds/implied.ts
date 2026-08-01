/**
 * "Implied odds" — a port of the reference trainer's Q.implied
 * (poker-math-trainer.html lines 739-797) onto the M2 drill contract.
 *
 * Two modes, chosen once per question (~62% math, else concept):
 *
 * - Math mode is always a turn spot — one card to come. Betting convention:
 *   `potBefore` is the pot before villain's bet, `bet` is villain's bet,
 *   `pot` = potBefore + bet (what you win), `call` = bet (what it costs).
 *   The question only makes sense when the direct call is losing — i.e.
 *   `impliedOddsNeeded(...) > 0` and `equity < requiredEquity(pot, call)`.
 *   The reference bumps the bet to 1.75x potBefore when the first roll does
 *   not clear that bar (line 746); ported below, and if it still does not
 *   clear it, the spot is re-dealt rather than asking a degenerate question.
 *
 * - Concept mode draws one of six prose items from CONCEPT_BANK, verbatim
 *   from the reference bank at lines 771-789. Every item's correct option is
 *   `options[0]` (the reference's `a:0` for all six) — shuffled at
 *   generation time with the correct label carried along as `answer`.
 */
import { dealSpotOnStreet } from "./outs";
import { impliedOddsNeeded, requiredEquity } from "../../poker/math";
import { pick, shuffled, roundTo, money, pct, buildOpts, sampleStepped } from "../opts";
import type { Spot } from "../../poker/engine";
import type {
  DrillContext, DrillQuestion, ExplainNote, ExplainRow, Generator, ViewBlock,
} from "../contract";

interface ImpliedMathSpot {
  spot: Spot;
  potBefore: number;
  bet: number;
  pot: number;
  call: number;
  need: number;
}

/**
 * Deals a turn spot and a bet size such that the direct call is losing and
 * implied odds are genuinely needed. Retries (re-dealing the whole spot,
 * not just the bet) when even the 1.75x-pot bump does not clear that bar —
 * this keeps the question meaningful instead of asking "how much more do
 * you need" when you are already ahead.
 */
function dealImpliedMathSpot(ctx: DrillContext): ImpliedMathSpot {
  for (let attempt = 0; attempt < 50; attempt++) {
    const spot = dealSpotOnStreet(ctx, "turn");
    const eq = spot.equity;
    // M5: sampled ranges instead of the fixed five-pot / four-fraction tables.
    const potBefore = sampleStepped(70, 240, 10, ctx.rng);
    let bet = roundTo(potBefore * sampleStepped(0.7, 1.6, 0.05, ctx.rng), 5);
    if (impliedOddsNeeded(eq, potBefore + bet, bet) <= 0) {
      bet = roundTo(potBefore * 1.75, 5);
    }
    const pot = potBefore + bet;
    const call = bet;
    const need = impliedOddsNeeded(eq, pot, call);
    if (need > 0 && eq < requiredEquity(pot, call)) {
      return { spot, potBefore, bet, pot, call, need };
    }
  }
  throw new Error("implied: could not deal a meaningful math spot after 50 attempts");
}

function buildMathQuestion(ctx: DrillContext): DrillQuestion {
  const { spot, potBefore, bet, pot, call, need } = dealImpliedMathSpot(ctx);
  const eq = spot.equity;
  const req = requiredEquity(pot, call);
  const target = Math.max(5, roundTo(need, 5));

  const candidates = [
    roundTo(need * 0.5, 5),
    roundTo(need * 1.8, 5),
    roundTo(need * 0.25, 5),
    call,
    roundTo(need * 1.35, 5),
  ].filter((v) => v > 0);

  const opts = buildOpts(target, candidates, 4, 4, ctx.rng);

  const body: ViewBlock[] = [
    {
      type: "felt",
      hero: spot.hero,
      board: spot.board,
      street: spot.street,
      ...(ctx.oppMode === "shown" ? { villain: spot.villain } : {}),
    },
    {
      type: "money",
      items: [
        { label: "Pot now", value: money(pot) },
        { label: "To call", value: money(call) },
        { label: "Your equity", value: pct(eq) },
        { label: "Need directly", value: pct(req) },
      ],
    },
  ];

  return {
    kind: "implied",
    kicker: "Implied odds",
    chip: "Turn",
    prompt: "How much more must you win on the river to make this call break even?",
    sub:
      `Villain bets ${money(bet)} into ${money(potBefore)}. Your direct pot odds are not enough — so you ` +
      "are calling on implied odds.",
    body,
    options: opts.map((v) => ({ label: money(v), value: v })),
    answer: target,
    layout: "grid3",
    explain: () => {
      const rows: ExplainRow[] = [
        { label: "Your draw", value: spot.draw },
        { label: "Your equity", value: `${pct(eq)}  (${spot.outs} outs, one card to come)` },
        { label: "Required by pot odds", value: pct(req) },
        {
          label: "Shortfall",
          value: `${((req - eq) * 100).toFixed(1)} pts — direct call is losing`,
        },
        {
          label: "Extra needed = (call×(1−eq) − eq×pot) ÷ eq",
          value: `(${money(call)}×${(1 - eq).toFixed(2)} − ${eq.toFixed(2)}×${money(pot)}) ÷ ${eq.toFixed(2)}`,
        },
        { label: "Break-even implied win", value: `${money(need)}  (≈ ${money(target)})` },
      ];

      const notes: ExplainNote[] = [
        {
          tone: "plain",
          title: "Implied odds:",
          text:
            "the money you expect to win on later streets when you hit. This call is only break-even if, " +
            `on average across all the times you hit, you collect about ${money(target)} more. Ask two ` +
            "questions before you count on it: does villain have that much left, and will they actually " +
            "pay you off?",
        },
        {
          tone: "warn",
          title: "Reverse implied odds:",
          text:
            "are the mirror image — money you lose after you hit. A non-nut draw (second-best flush, low " +
            "end of a straight) can hit and still pay off a bigger hand. Discount your implied odds hard " +
            "when your draw isn't to the nuts.",
        },
      ];

      return { rows, notes };
    },
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      mode: "math",
      spot,
      potBefore,
      bet,
      pot,
      call,
    },
    signature: `math|${spot.hero.join(",")}|${spot.board.join(",")}|${potBefore}|${bet}`,
  };
}

export interface ConceptItem {
  prompt: string;
  options: string[];
  explain: string;
}

/**
 * Verbatim from the reference bank (lines 771-789). `options[0]` is always
 * the correct choice for every item, matching the reference's `a:0`.
 */
export const CONCEPT_BANK: ConceptItem[] = [
  {
    prompt:
      "You have a gutshot to the idiot end of a straight on a two-flush board. Deep stacks. How should you treat implied odds?",
    options: [
      "Discount them heavily — reverse implied odds are large",
      "Increase them — deep stacks always mean big implied odds",
      "They don’t apply to straights, only flushes",
      "Ignore them; only direct pot odds matter",
    ],
    explain:
      "Hitting the low end of a straight on a board where a flush and a bigger straight are both live is " +
      "exactly when you win a small pot and lose a big one. Deep stacks amplify reverse implied odds too, " +
      "not just implied odds.",
  },
  {
    prompt: "Villain is all-in on the flop. How much are your implied odds worth?",
    options: [
      "Zero — there is no more money to win",
      "Double, because two cards are coming",
      "The same as any other flop call",
      "Half of villain’s stack",
    ],
    explain:
      "No more betting can happen, so there is no future money. Facing an all-in you price the call on " +
      "direct pot odds alone — and this is the one spot where the ×4 rule is fully valid, because you are " +
      "guaranteed to see both cards.",
  },
  {
    prompt:
      "You hold the nut flush draw against a short stack with 1/3 of a pot-sized bet left behind. You need 28% to call and you have 19%.",
    options: [
      "Fold — there isn’t enough money left to bridge the gap",
      "Call — nut draws always have implied odds",
      "Call — you can bluff the river when you miss",
      "Raise — fold equity replaces implied odds",
    ],
    explain:
      "Implied odds are capped by the money actually behind. A short stack cannot pay you enough to close " +
      "a 9-point equity gap, no matter how good your draw is.",
  },
  {
    prompt: "Which draw has the best implied odds against a tight opponent who only pays off with strong hands?",
    options: [
      "A well-disguised gutshot",
      "A four-flush on a monotone board",
      "Top pair with a weak kicker",
      "An open-ender on a paired board",
    ],
    explain:
      "Implied odds depend on your hand being invisible when you hit. Obvious draws — a third suit landing, " +
      "a fourth straight card — shut down the action. A hidden straight gets paid; an obvious flush does not.",
  },
  {
    prompt: "You call a turn bet purely on implied odds, hit your card, and villain checks the river. What did you get wrong?",
    options: [
      "You overestimated how often the implied money actually materialises",
      "Nothing — you won the pot anyway",
      "You should have raised the turn",
      "Implied odds only apply to the flop",
    ],
    explain:
      "Implied odds are an average over all the times you hit — including the times villain shuts down or " +
      "your hand is obvious. If you assumed a full stack every time, you were pricing the call with money " +
      "that never shows up.",
  },
  {
    prompt: "What actually is your ‘equity’ in a pot?",
    options: [
      "The share of the pot that belongs to you right now, based on how often you win",
      "The amount of money you have invested",
      "The chance villain folds",
      "The size of the pot divided by the bet",
    ],
    explain:
      "Equity is your fair share of the pot. With 30% equity in a $200 pot, $60 of it is yours — that is " +
      "the number every other calculation is built on.",
  },
];

function buildConceptQuestion(ctx: DrillContext): DrillQuestion {
  const ids = CONCEPT_BANK.map((_, i) => i);
  const conceptId = pick(ids, ctx.rng);
  const item = CONCEPT_BANK[conceptId];
  const correctLabel = item.options[0];

  const opts = shuffled(
    item.options.map((label) => ({ label, value: label })),
    ctx.rng
  );

  const notes: ExplainNote[] = [{ tone: "plain", text: item.explain }];

  return {
    kind: "implied",
    kicker: "Implied / reverse implied odds",
    chip: "Concept",
    prompt: item.prompt,
    sub: "",
    body: [],
    options: opts,
    answer: correctLabel,
    layout: "one",
    explain: () => ({ rows: [], notes }),
    payload: { level: ctx.level, oppMode: ctx.oppMode, mode: "concept", conceptId },
    // A repeat is the same bank item coming back, whatever the option shuffle.
    signature: `concept|${conceptId}`,
  };
}

export const generateImplied: Generator = (ctx): DrillQuestion => {
  const isMath = ctx.rng() < 0.62;
  return isMath ? buildMathQuestion(ctx) : buildConceptQuestion(ctx);
};
