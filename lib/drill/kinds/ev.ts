/**
 * "Expected value" — a port of the reference trainer's Q.ev
 * (poker-math-trainer.html lines 800-856) onto the M2 drill contract.
 *
 * Two modes, ~55% call / ~45% shove:
 *
 *   - "call": the ordinary betting convention used everywhere else in this
 *     codebase. `pot` = total pot AFTER villain's bet (what you win),
 *     `call` = what it costs you. Answer is evOfCall(equity, pot, call).
 *
 *   - "shove": the reference calls its variable `pot`, but it means the pot
 *     BEFORE your own bet — ported here as `potBefore` to keep the naming
 *     honest. `potIfCalled = potBefore + 2*bet` is used only to build one
 *     distractor option, never for the EV formula itself. The EV is the
 *     two-branch fold-equity expression: villain folds and you win
 *     potBefore outright, or villain calls and you run your equity against
 *     the bet.
 */
import { evOfCall, requiredEquity } from "../../poker/math";
import { pick, roundTo, buildOpts, money, pct, signedMoney } from "../opts";
import type {
  DrillContext, DrillQuestion, ExplainNote, Generator, ViewBlock,
} from "../contract";

type EvSpot =
  | { mode: "call"; potBefore: number; bet: number; pot: number; call: number; equity: number }
  | { mode: "shove"; potBefore: number; bet: number; foldRate: number; equityWhenCalled: number };

function dealEvSpot(ctx: DrillContext): EvSpot {
  const { level, rng } = ctx;

  if (rng() < 0.55) {
    const potBefore =
      level === 1 ? pick([80, 100, 120], rng) : pick([95, 140, 165, 220], rng);
    const bet = roundTo(potBefore * pick([0.5, 0.75, 1], rng), 5);
    const pot = potBefore + bet;
    const call = bet;
    const equity = +(
      pick(level === 1 ? [0.2, 0.25, 0.3, 0.35, 0.4] : [0.18, 0.22, 0.27, 0.31, 0.38, 0.44], rng)
    ).toFixed(2);
    return { mode: "call", potBefore, bet, pot, call, equity };
  }

  const potBefore = pick([60, 80, 100, 140], rng);
  const bet = roundTo(potBefore * pick([0.5, 0.75, 1], rng), 5);
  const foldRate = pick([0.4, 0.5, 0.55, 0.6, 0.65], rng);
  const equityWhenCalled = +(pick([0.2, 0.25, 0.3, 0.35], rng)).toFixed(2);
  return { mode: "shove", potBefore, bet, foldRate, equityWhenCalled };
}

export const generateEv: Generator = (ctx): DrillQuestion => {
  const spot = dealEvSpot(ctx);

  if (spot.mode === "call") {
    const { potBefore, bet, pot, call, equity: e } = spot;
    const ev = evOfCall(e, pot, call);
    const target = +ev.toFixed(1);

    const candidates = [
      +(e * pot).toFixed(1),
      +(e * (pot + call) - (1 - e) * call).toFixed(1),
      +(-target).toFixed(1),
      +(e * pot - call).toFixed(1),
      +(e * (pot + call)).toFixed(1),
    ].filter((v) => Math.abs(v - target) > 1.5);

    const opts = buildOpts(target, candidates, 4, 1.5, ctx.rng);

    const body: ViewBlock[] = [
      {
        type: "money",
        items: [
          { label: "Pot now", value: money(pot) },
          { label: "To call", value: money(call) },
          { label: "Your equity", value: (e * 100).toFixed(0) + "%" },
        ],
      },
    ];

    return {
      kind: "ev",
      kicker: "Expected value",
      chip: "EV of a call",
      prompt: "What is the EV of calling?",
      sub: `You win the pot ${(e * 100).toFixed(0)}% of the time. Work out what this call is worth on average.`,
      body,
      options: opts.map((v) => ({ label: signedMoney(v), value: v })),
      answer: target,
      layout: "grid3",
      explain: () => {
        const notes: ExplainNote[] = [
          {
            tone: "plain",
            title: "EV in one sentence:",
            text:
              "what you win times how often you win it, minus what you lose times how often you lose it. " +
              "Everything else in poker math is a special case of this.",
          },
          {
            tone: "warn",
            text:
              "A losing call is not a mistake because you lost the hand — it is a mistake because the average is negative. " +
              (ev >= 0
                ? `This one averages ${signedMoney(ev)}, so make it every single time, including the many times it loses.`
                : `This one averages ${signedMoney(ev)}, so it is a leak even on the occasions it wins.`),
          },
        ];
        return {
          rows: [
            { label: `When you win (${(e * 100).toFixed(0)}%)`, value: `you gain ${money(pot)}` },
            { label: `When you lose (${((1 - e) * 100).toFixed(0)}%)`, value: `you lose ${money(call)}` },
            {
              label: `EV = ${e.toFixed(2)} × ${money(pot)} − ${(1 - e).toFixed(2)} × ${money(call)}`,
              value: `${money(e * pot)} − ${money((1 - e) * call)} = ${signedMoney(ev)}`,
            },
            { label: "Break-even equity here", value: pct(requiredEquity(pot, call)) },
          ],
          notes,
        };
      },
      payload: {
        level: ctx.level,
        oppMode: ctx.oppMode,
        mode: "call",
        potBefore,
        bet,
        pot,
        call,
        equity: e,
      },
    };
  }

  const { potBefore, bet, foldRate, equityWhenCalled } = spot;
  const potIfCalled = potBefore + 2 * bet;
  const called = equityWhenCalled * (potBefore + bet) - (1 - equityWhenCalled) * bet;
  const ev = foldRate * potBefore + (1 - foldRate) * called;
  const target = +ev.toFixed(1);

  const candidates = [
    +(foldRate * potBefore).toFixed(1),
    +(-bet).toFixed(1),
    +(foldRate * potBefore - (1 - foldRate) * bet).toFixed(1),
    +(target * 1.9).toFixed(1),
    +(foldRate * potBefore + (1 - foldRate) * equityWhenCalled * potIfCalled).toFixed(1),
  ].filter((v) => Math.abs(v - target) > 1.5);

  const opts = buildOpts(target, candidates, 4, 1.5, ctx.rng);

  const body: ViewBlock[] = [
    {
      type: "money",
      items: [
        { label: "Pot", value: money(potBefore) },
        { label: "Your bet", value: money(bet) },
        { label: "Fold %", value: (foldRate * 100).toFixed(0) + "%" },
        { label: "Equity when called", value: (equityWhenCalled * 100).toFixed(0) + "%" },
      ],
    },
  ];

  return {
    kind: "ev",
    kicker: "Expected value",
    chip: "Semi-bluff with fold equity",
    prompt: `What is the EV of betting ${money(bet)} into ${money(potBefore)}?`,
    sub: `Villain folds ${(foldRate * 100).toFixed(0)}% of the time. When they call, you win the hand ${(equityWhenCalled * 100).toFixed(0)}% of the time.`,
    body,
    options: opts.map((v) => ({ label: signedMoney(v), value: v })),
    answer: target,
    layout: "grid3",
    explain: () => {
      const notes: ExplainNote[] = [
        {
          tone: "plain",
          title: "This is why semi-bluffing beats calling.",
          text:
            "You get two ways to win: they fold now, or you hit later. A pure call only has the second one.",
        },
      ];
      return {
        rows: [
          {
            label: `They fold (${(foldRate * 100).toFixed(0)}%)`,
            value: `you win ${money(potBefore)}  →  ${money(foldRate * potBefore)}`,
          },
          {
            label: `They call (${((1 - foldRate) * 100).toFixed(0)}%) and you win (${(equityWhenCalled * 100).toFixed(0)}%)`,
            value: `+${money(potBefore + bet)}`,
          },
          { label: "They call and you lose", value: `−${money(bet)}` },
          { label: "Called branch average", value: signedMoney(called) },
          { label: "Total EV", value: signedMoney(ev) },
        ],
        notes,
      };
    },
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      mode: "shove",
      potBefore,
      bet,
      foldRate,
      equityWhenCalled,
    },
  };
};
