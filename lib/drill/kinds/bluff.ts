/**
 * "Bluff math" — a port of the reference trainer's Q.bluff
 * (poker-math-trainer.html lines 858-922) onto the M2 drill contract.
 *
 * Three sub-modes, picked as ["be","be","mdf","size"] so break-even shows up
 * twice as often as the other two:
 *   - "be"   how often villain must fold for a pure bluff to break even
 *   - "mdf"  what share of your range must continue against a bet
 *   - "size" what bet size is break-even against a stated fold frequency
 *
 * Betting convention (the trap in this drill): the reference calls its
 * variable `pot` throughout Q.bluff, but every formula treats it as the pot
 * BEFORE the bluff/bet — `bet / (potBefore + bet)`. This port names it
 * `potBefore` and passes it first into the math helpers, which expect
 * exactly that.
 */
import { breakEvenFoldRate, minDefenceFrequency, bluffSizeForFoldRate } from "../../poker/math";
import { pick, roundTo, buildOpts, money } from "../opts";
import { dealPotSpot, betSizePill } from "../money";
import type {
  DrillContext, DrillQuestion, ExplainNote, ExplainRow, Generator, ViewBlock,
} from "../contract";

type BluffMode = "be" | "mdf" | "size";

/** Level tables — copied exactly from reference lines 861-863. */
function dealPot(ctx: DrillContext): { potBefore: number; frac: number; bet: number } {
  const { level } = ctx;
  const potChoices = level === 1 ? [60, 80, 100, 120] : [75, 95, 130, 185, 240];
  const fracChoices = level === 1 ? [0.5, 0.75, 1] : [0.33, 0.5, 0.66, 0.75, 1, 1.5, 2];
  return dealPotSpot(ctx, potChoices, fracChoices, 5);
}

function buildBreakEven(ctx: DrillContext): DrillQuestion {
  const { potBefore, bet } = dealPot(ctx);
  const be = breakEvenFoldRate(potBefore, bet);
  const target = +(be * 100).toFixed(1);

  const candidates = [
    +((bet / potBefore) * 100).toFixed(1),
    +((100 * potBefore) / (potBefore + bet)).toFixed(1),
    +((100 * bet) / (potBefore + 2 * bet)).toFixed(1),
    +(target + 11).toFixed(1),
    +(target - 9).toFixed(1),
  ].filter((v) => v > 0 && v < 100 && Math.abs(v - target) > 1.2);

  const opts = buildOpts(target, candidates, 4, 1.2, ctx.rng);

  const body: ViewBlock[] = [
    {
      type: "money",
      items: [
        { label: "Pot", value: money(potBefore) },
        { label: "Your bluff", value: money(bet) },
        betSizePill({ potBefore, bet }),
      ],
    },
  ];

  const rows: ExplainRow[] = [
    { label: "Risk", value: money(bet) },
    { label: "Reward", value: money(potBefore) },
    {
      label: "Break-even folds = bet ÷ (pot + bet)",
      value: `${money(bet)} ÷ ${money(potBefore + bet)} = ${target.toFixed(1)}%`,
    },
  ];
  const notes: ExplainNote[] = [
    {
      tone: "plain",
      text:
        "Note the shape of the formula: risk ÷ (risk + reward). A half-pot bluff needs 33% folds, a pot-sized bluff needs 50%, a 2× pot bluff needs 67%. Bigger bluffs must work more often.",
    },
    {
      tone: "warn",
      title: "OMC leak:",
      text:
        `"I only bluff when I'm sure they fold." If you literally never get called, you are bluffing too little — you are leaving the ${target.toFixed(0)}% threshold far behind and giving up pots you could have taken.`,
    },
  ];

  return {
    kind: "bluff",
    kicker: "Bluff math",
    chip: "Break-even bluff",
    prompt: "How often must villain fold for this pure bluff to break even?",
    sub: "You have no equity if called — this bet only wins when they fold.",
    body,
    options: opts.map((v) => ({ label: v.toFixed(1) + "%", value: v })),
    answer: target,
    layout: "grid3",
    explain: () => ({ rows, notes }),
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      mode: "be" as BluffMode,
      potBefore,
      bet,
    },
  };
}

function buildMdf(ctx: DrillContext): DrillQuestion {
  const { potBefore, bet } = dealPot(ctx);
  const m = minDefenceFrequency(potBefore, bet);
  const target = +(m * 100).toFixed(1);
  const be = breakEvenFoldRate(potBefore, bet);

  const candidates = [
    +((100 * bet) / (potBefore + bet)).toFixed(1),
    +((100 * bet) / (potBefore + 2 * bet)).toFixed(1),
    +(target - 14).toFixed(1),
    +(target - 25).toFixed(1),
  ].filter((v) => v > 0 && v < 100 && Math.abs(v - target) > 1.2);

  const opts = buildOpts(target, candidates, 4, 1.2, ctx.rng);

  const body: ViewBlock[] = [
    {
      type: "money",
      items: [
        { label: "Pot", value: money(potBefore) },
        { label: "Their bet", value: money(bet) },
        betSizePill({ potBefore, bet }),
      ],
    },
  ];

  const rows: ExplainRow[] = [
    {
      label: "MDF = pot ÷ (pot + bet)",
      value: `${money(potBefore)} ÷ ${money(potBefore + bet)} = ${target.toFixed(1)}%`,
    },
    { label: "So you may fold at most", value: (100 - target).toFixed(1) + "%" },
    { label: "Their break-even bluff rate", value: `${(be * 100).toFixed(1)}%` },
  ];
  const notes: ExplainNote[] = [
    {
      tone: "plain",
      text:
        `MDF is the bluffer's break-even read backwards. Their bluff needs ${(be * 100).toFixed(1)}% folds to profit, so the moment you fold more than ${(100 - target).toFixed(0)}% of your range they can bluff you with anything. The bigger they bet, the more you are allowed to fold.`,
    },
    {
      tone: "warn",
      text:
        "MDF is a defence against a balanced, bluff-heavy opponent. Against the typical live player who never bluffs, over-folding is correct — exploit first, MDF second.",
    },
  ];

  return {
    kind: "bluff",
    kicker: "Bluff math",
    chip: "Defending",
    prompt: "What share of your range must you continue with to stop villain bluffing profitably?",
    sub: `Villain bets ${money(bet)} into ${money(potBefore)}. This is minimum defence frequency (MDF).`,
    body,
    options: opts.map((v) => ({ label: v.toFixed(1) + "%", value: v })),
    answer: target,
    layout: "grid3",
    explain: () => ({ rows, notes }),
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      mode: "mdf" as BluffMode,
      potBefore,
      bet,
    },
  };
}

function buildSize(ctx: DrillContext): DrillQuestion {
  const { potBefore } = dealPot(ctx);
  // 0.33/0.67 (finding L-13): bluffSizeForFoldRate(0.33) rounds to 49% pot,
  // contradicting the explain note's "1/2 pot needs 33%". The note's
  // thresholds are exact fractions (1/3, 1/2, 3/4, 1× pot), so the fold
  // rates fed in here must be too, or the rounded answer drifts off them.
  const need = pick([1 / 3, 0.4, 0.5, 0.6, 2 / 3], ctx.rng);
  const size = bluffSizeForFoldRate(need);
  const target = Math.round(size * 100);

  const candidates = [
    Math.round(need * 100),
    Math.round((1 - need) * 100),
    Math.round(target * 1.6),
    Math.round(target * 0.55),
  ].filter((v) => v > 0 && Math.abs(v - target) > 4);

  const opts = buildOpts(target, candidates, 4, 4, ctx.rng);

  const body: ViewBlock[] = [
    {
      type: "money",
      items: [
        { label: "Pot", value: money(potBefore) },
        { label: "Villain folds", value: (need * 100).toFixed(0) + "%" },
      ],
    },
  ];

  const rows: ExplainRow[] = [
    { label: "Break-even condition", value: `bet ÷ (pot + bet) = ${(need * 100).toFixed(0)}%` },
    { label: "Rearranged", value: "bet = pot × f ÷ (1 − f)" },
    {
      label: `= ${money(potBefore)} × ${need.toFixed(2)} ÷ ${(1 - need).toFixed(2)}`,
      value: `${money(potBefore * size)}  (${target}% pot)`,
    },
  ];
  const notes: ExplainNote[] = [
    {
      tone: "plain",
      text:
        "Rule of thumb worth owning: 1/3 pot needs 25% folds, 1/2 pot needs 33%, 3/4 pot needs 43%, pot needs 50%. Pick the smallest size that gets the job done — you risk less for the same pot.",
    },
  ];

  return {
    kind: "bluff",
    kicker: "Bluff math",
    chip: "Choosing a size",
    prompt: `You think villain folds exactly ${(need * 100).toFixed(0)}% here. What bet size is break-even?`,
    sub: "Express it as a percentage of the pot.",
    body,
    options: opts.map((v) => ({
      label: `${Math.round(v)}% pot  (${money(roundTo((potBefore * v) / 100, 1))})`,
      value: v,
    })),
    answer: target,
    layout: "grid3",
    explain: () => ({ rows, notes }),
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      mode: "size" as BluffMode,
      potBefore,
      foldRate: need,
    },
  };
}

export const generateBluff: Generator = (ctx): DrillQuestion => {
  const mode = pick<BluffMode>(["be", "be", "mdf", "size"], ctx.rng);
  if (mode === "be") return buildBreakEven(ctx);
  if (mode === "mdf") return buildMdf(ctx);
  return buildSize(ctx);
};
