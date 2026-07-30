/**
 * "Call or fold" — a port of the reference trainer's Q.decision
 * (poker-math-trainer.html lines 698-736) onto the M2 drill contract.
 *
 * The reference deliberately makes ~60% of spots close: the bet size is
 * derived from the hero's actual equity so the required-equity line sits near
 * the hero's real equity, rather than always being lopsidedly easy. Line
 * 704-709 there is the load-bearing part; it is ported exactly below,
 * including the clamp to [0.2, 2] and the Math.max(5, roundTo(...,5)) bet.
 */
import { dealSpotOnStreet } from "./outs";
import { describeOuts } from "../../poker/engine";
import { requiredEquity, evOfCall, ruleOf2And4 } from "../../poker/math";
import { pick, money, pct, signedMoney, roundTo } from "../opts";
import { betSizePill } from "../money";
import { deadOutsNote } from "../notes";
import type {
  DrillQuestion, ExplainNote, ExplainRow, Generator, ViewBlock,
} from "../contract";

const POT_BEFORE_CHOICES = [60, 80, 100, 120, 150, 200];
const FRAC_CHOICES = [0.33, 0.5, 0.75, 1, 1.5];

/**
 * The `close` path derives the bet from the hero's own equity so the
 * required-equity line sits near it, on purpose (see file comment). Without
 * a floor this can land the two numbers on top of each other — sometimes
 * exactly equal — producing an undecidable coin-flip spot that still feeds
 * XP, streaks and adaptive difficulty (final-review finding L-1). Re-roll
 * the pot/bet with fresh randomness until the margin clears 1.5 points;
 * bounded so a pathological equity can never spin forever.
 */
const MIN_MARGIN = 0.015;
const MAX_DEAL_ATTEMPTS = 50;

export const generateDecision: Generator = (ctx): DrillQuestion => {
  const street = ctx.rng() < 0.5 ? "flop" : "turn";
  const spot = dealSpotOnStreet(ctx, street);
  const eq = spot.equity;

  let potBefore = 0;
  let bet = 0;
  let pot = 0;
  let call = 0;
  let req = 0;
  for (let attempt = 0; attempt < MAX_DEAL_ATTEMPTS; attempt++) {
    potBefore = pick(POT_BEFORE_CHOICES, ctx.rng);
    const close = ctx.rng() < 0.6;
    let frac: number;
    if (close) {
      const r = Math.min(0.45, Math.max(0.05, eq + (ctx.rng() - 0.5) * 0.06));
      frac = r / (1 - 2 * r);
    } else {
      frac = pick(FRAC_CHOICES, ctx.rng);
    }
    frac = Math.min(2, Math.max(0.2, frac));
    bet = Math.max(5, roundTo(potBefore * frac, 5));

    pot = potBefore + bet;
    call = bet;
    req = requiredEquity(pot, call);
    if (Math.abs(eq - req) >= MIN_MARGIN) break;
  }

  const answer = eq >= req ? "call" : "fold";
  const ev = evOfCall(eq, pot, call);

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
        betSizePill({ potBefore, bet }),
      ],
    },
  ];

  const chanceLabel =
    ctx.oppMode === "shown" ? "Exact equity vs their hand" : "Chance of hitting";

  return {
    kind: "decision",
    kicker: "Call or fold",
    chip: street === "flop" ? "Flop" : "Turn",
    prompt: `Villain bets ${money(bet)} into ${money(potBefore)}. Call or fold?`,
    sub:
      "Count your outs, turn them into equity with the rule of 2 and 4, then compare that to the price. Assume this is the last bet — no more betting, cards run out.",
    body,
    options: [
      { label: "Call", value: "call" },
      { label: "Fold", value: "fold" },
    ],
    answer,
    layout: "two",
    // This drill's feedback is the same whichever side you picked — the work
    // table shows the price and the margin either way — so `chosen` is unused.
    explain: () => {
      const rows: ExplainRow[] = [
        { label: "Your draw", value: spot.draw },
        { label: `Outs — ${describeOuts(spot.outCards)}`, value: String(spot.outs) },
        {
          label: `Rule of ${street === "flop" ? "4" : "2"} estimate`,
          value: `${ruleOf2And4(spot.outs, street === "flop" ? 2 : 1)}%`,
        },
        { label: chanceLabel, value: pct(eq) },
        { label: `Required equity (${money(call)} ÷ ${money(pot + call)})`, value: pct(req) },
        {
          label: "Margin",
          value: `${eq >= req ? "+" : "−"}${Math.abs((eq - req) * 100).toFixed(1)} pts`,
        },
        { label: "EV of calling", value: signedMoney(ev) },
      ];

      const notes: ExplainNote[] = [
        {
          tone: answer === "call" ? "good" : "plain",
          text:
            answer === "call"
              ? `Your ${pct(eq)} clears the ${pct(req)} you need, so calling wins about ${money(Math.abs(ev))} every time you take this line.`
              : `You need ${pct(req)} and only have ${pct(eq)}. Calling burns about ${money(Math.abs(ev))} each time. Folding is not weak — it is the profitable play.`,
        },
      ];

      if (ctx.oppMode === "shown") {
        const note = deadOutsNote(spot.hero, spot.villain!, spot.board);
        if (note) notes.push(note);
      }

      notes.push({
        tone: "warn",
        text:
          "This question deliberately strips out implied odds. In a real hand, extra money you could win " +
          "later can turn a marginal fold into a call — and reverse implied odds can turn a marginal call " +
          "into a fold.",
      });

      return { rows, notes };
    },
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      spot,
      potBefore,
      bet,
      pot,
      call,
    },
  };
};
