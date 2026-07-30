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
import { deadOuts, describeOuts, cardStr } from "../../poker/engine";
import { requiredEquity, evOfCall, ruleOf2And4 } from "../../poker/math";
import { pick, money, pct, signedMoney, roundTo } from "../opts";
import type {
  DrillContext, DrillQuestion, ExplainNote, ExplainRow, Generator, ViewBlock,
} from "../contract";

const POT_BEFORE_CHOICES = [60, 80, 100, 120, 150, 200];
const FRAC_CHOICES = [0.33, 0.5, 0.75, 1, 1.5];

export const generateDecision: Generator = (ctx): DrillQuestion => {
  const street = ctx.rng() < 0.5 ? "flop" : "turn";
  const spot = dealSpotOnStreet(ctx, street);
  const eq = spot.equity;

  const potBefore = pick(POT_BEFORE_CHOICES, ctx.rng);
  const close = ctx.rng() < 0.6;
  let frac: number;
  if (close) {
    const r = Math.min(0.45, Math.max(0.05, eq + (ctx.rng() - 0.5) * 0.06));
    frac = r / (1 - 2 * r);
  } else {
    frac = pick(FRAC_CHOICES, ctx.rng);
  }
  frac = Math.min(2, Math.max(0.2, frac));
  const bet = Math.max(5, roundTo(potBefore * frac, 5));

  const pot = potBefore + bet;
  const call = bet;
  const req = requiredEquity(pot, call);
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
        { label: "Bet size", value: `${Math.round(frac * 100)}% pot` },
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
    explain: (chosen) => {
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
        const dead = deadOuts(spot.hero, spot.villain!, spot.board);
        if (dead.length) {
          notes.push({
            tone: "warn",
            title: `Dead outs (${dead.length}).`,
            text:
              dead.map((d) => `${cardStr(d.card)} gives you ${d.you} but hands them ${d.them}`).join("; ") +
              ". These complete your draw and still lose, so they never counted. This is the most " +
              "expensive miscount in poker — always check what the card does for them before you " +
              "add it to your total.",
          });
        }
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
