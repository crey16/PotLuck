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
 * - Concept mode builds from `IMPLIED_CONCEPT_TEMPLATES`. **M5 completion,
 *   2026-08-06:** this used to be a six-item static bank ported verbatim from
 *   the reference (lines 771-789), which meant the seventh concept question a
 *   player saw was a guaranteed repeat — the anti-repeat window can only
 *   re-roll a collision if there is something else to roll into. Each item is
 *   now a template that deals its own cards, pot, bet and stack, and two of
 *   them are the *same template objects* the `concepts` drill uses, because
 *   both original banks taught the same two ideas and two implementations of
 *   one idea is how they drift.
 */
import { dealSpotOnStreet } from "./outs";
import { impliedOddsNeeded, requiredEquity } from "../../poker/math";
import { shuffled, roundTo, money, pct, buildOpts, sampleStepped } from "../opts";
import { IMPLIED_CONCEPT_TEMPLATES } from "./impliedTemplates";
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

/* ------------------------------------------------------------------ *
 * Concept mode
 * ------------------------------------------------------------------ */

function buildConceptQuestion(ctx: DrillContext): DrillQuestion {
  const template =
    IMPLIED_CONCEPT_TEMPLATES[Math.floor(ctx.rng() * IMPLIED_CONCEPT_TEMPLATES.length)];
  const item = template.build(ctx);

  const opts = shuffled(
    item.options.map((label, i) => ({ label, value: label, isCorrect: i === item.correct })),
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
    options: opts.map((o) => ({ label: o.label, value: o.value })),
    answer: item.options[item.correct],
    ...(item.alsoAcceptable?.length
      ? { acceptable: item.alsoAcceptable.map((i) => item.options[i]) }
      : {}),
    layout: "one",
    explain: () => ({ rows: [], notes }),
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      mode: "concept",
      templateId: item.templateId,
      params: item.params,
    },
    // A repeat is the same template dealt to the same parameters, whatever
    // the option shuffle — see each template's `signature`.
    signature: `concept|${item.signature}`,
  };
}

export const generateImplied: Generator = (ctx): DrillQuestion => {
  const isMath = ctx.rng() < 0.62;
  return isMath ? buildMathQuestion(ctx) : buildConceptQuestion(ctx);
};
