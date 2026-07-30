/**
 * "Pot odds" — a port of the reference trainer's Q.potodds
 * (poker-math-trainer.html lines 665-693) onto the M2 drill contract.
 *
 * Betting convention (the easiest thing to get wrong here): `potBefore` is
 * the pot before villain's bet, `bet` is villain's bet, `extra` is your own
 * already-committed money when villain has raised (0 when there is no
 * raise — never null, so the payload shape is stable). `pot` is the total
 * you stand to win: potBefore + bet + extra. `call` is what it costs you
 * *more* to continue: bet - extra. Money you already committed is dead
 * money that improves your price, not a cost of calling — that is the OMC
 * leak this drill teaches.
 */
import { requiredEquity, asOdds } from "../../poker/math";
import { pick, roundTo, buildOpts, money } from "../opts";
import type {
  DrillContext, DrillQuestion, ExplainNote, Generator, ViewBlock,
} from "../contract";

interface PotOddsSpot {
  potBefore: number;
  bet: number;
  extra: number;
}

/** Level tables — copied exactly from reference lines 667-670. */
function dealPotOddsSpot(ctx: DrillContext): PotOddsSpot {
  const { level, rng } = ctx;
  let potBefore: number;
  let bet: number;
  let extra = 0;

  if (level === 1) {
    potBefore = pick([60, 80, 100, 120, 200], rng);
    bet = roundTo(potBefore * pick([0.5, 1, 0.75], rng), 5);
  } else if (level === 2) {
    potBefore = pick([65, 85, 110, 135, 175, 240], rng);
    bet = roundTo(potBefore * pick([0.33, 0.5, 0.66, 0.75, 1, 1.25], rng), 5);
  } else {
    potBefore = pick([73, 118, 146, 214, 325], rng);
    bet = roundTo(potBefore * pick([0.4, 0.6, 0.85, 1.1, 1.5], rng), 1);
    if (rng() < 0.5) extra = roundTo(bet * pick([0.2, 0.3], rng), 1);
  }

  return { potBefore, bet, extra };
}

export const generatePotodds: Generator = (ctx): DrillQuestion => {
  const spot = dealPotOddsSpot(ctx);
  const { potBefore, bet, extra } = spot;
  const pot = potBefore + bet + extra;
  const call = bet - extra;
  const req = requiredEquity(pot, call);
  const target = +(req * 100).toFixed(1);

  const candidates = [
    +((call / pot) * 100).toFixed(1),
    +((call / (pot + 2 * call)) * 100).toFixed(1),
    +(target + 8).toFixed(1),
    +(target - 6).toFixed(1),
    +((100 * bet) / (potBefore + 2 * bet)).toFixed(1),
    +((100 * pot) / (pot + call)).toFixed(1),
  ].filter((v) => v > 0 && v < 70 && Math.abs(v - target) > 1.2);

  const opts = buildOpts(target, candidates, 4, 1.2, ctx.rng);

  const body: ViewBlock[] = [
    {
      type: "money",
      items: [
        { label: "Pot before bet", value: money(potBefore) },
        { label: "Villain bets", value: money(bet) },
        { label: "Pot now", value: money(pot) },
        { label: "To call", value: money(call) },
      ],
    },
  ];

  const isRaise = extra > 0;

  return {
    kind: "potodds",
    kicker: "Pot odds",
    chip: isRaise ? "Facing a raise" : "Facing a bet",
    prompt: "What equity do you need to break even on a call?",
    sub: isRaise
      ? `You bet ${money(extra)}, villain raised to ${money(bet)}. Your ${money(extra)} is already in the pot — it costs you ${money(call)} more to call.`
      : `Villain bets ${money(bet)} into a ${money(potBefore)} pot.`,
    body,
    options: opts.map((v) => ({ label: v.toFixed(1) + "%", value: v })),
    answer: target,
    layout: "grid3",
    explain: () => {
      // Annotated as ExplainNote[]: without it, the first element's literal
      // `tone` narrows the array type and every later push of a "warn" note
      // fails to compile.
      const notes: ExplainNote[] = [
        {
          tone: "plain",
          title: "The one line to memorise:",
          text:
            'required equity = call ÷ (pot + call), where "pot" already includes the bet you are facing. ' +
            "If you win more often than that number, calling makes money.",
        },
      ];
      if (isRaise) {
        notes.push({
          tone: "warn",
          title: "Classic OMC leak:",
          text:
            `money you already put in is not yours any more. Do not add your ${money(extra)} to the cost ` +
            "of calling — it is dead money in the pot and it actually improves your price.",
        });
      }
      return {
        rows: [
          { label: "Total pot after their bet", value: money(pot) },
          { label: "Cost to call", value: money(call) },
          {
            label: "Required equity = call ÷ (pot + call)",
            value: `${money(call)} ÷ ${money(pot + call)} = ${target.toFixed(1)}%`,
          },
          { label: "Same thing as odds", value: asOdds(req) },
        ],
        notes,
      };
    },
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      potBefore,
      bet,
      extra,
      pot,
      call,
    },
  };
};
