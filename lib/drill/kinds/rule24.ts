/**
 * "Rule of 2 and 4" — a port of the reference trainer's Q.rule24
 * (poker-math-trainer.html lines 628-662) onto the M2 drill contract.
 *
 * The rule itself (outs x4 on the flop, x2 on the turn) is a fast estimate,
 * not the truth. The explanation always shows the true chance of hitting —
 * hitByRiver / hitOnRiver from the engine, never derived from the rule — and,
 * above 8 outs on the flop, the corrected figure from ruleOf4Corrected. Never
 * hand-compute either.
 */
import { dealSpotOnStreet } from "./outs";
import { hitByRiver, hitOnRiver, ruleOf2And4, ruleOf4Corrected } from "../../poker/math";
import { buildOpts, pct } from "../opts";
import { drawLine } from "../notes";
import type {
  DrillContext, DrillQuestion, ExplainNote, Generator, ViewBlock,
} from "../contract";
import type { Street } from "../../poker/engine";

/** Street choice for the rule-of-2-and-4 drill: flop or turn, 50/50. */
function pickStreet(ctx: DrillContext): Street {
  return ctx.rng() < 0.5 ? "flop" : "turn";
}

export const generateRule24: Generator = (ctx): DrillQuestion => {
  const street = pickStreet(ctx);
  const spot = dealSpotOnStreet(ctx, street);
  const n = spot.outs;
  const est = ruleOf2And4(n, street === "flop" ? 2 : 1);

  const candidates = [
    street === "flop" ? 2 * n : 4 * n,
    est + (street === "flop" ? 8 : 4),
    Math.max(1, est - (street === "flop" ? 8 : 4)),
    n,
    est + (street === "flop" ? 12 : 6),
    Math.max(1, est - 4),
  ].filter((v) => v > 0 && v <= 100);

  const options = buildOpts(est, candidates, 4, 1, ctx.rng).map(Math.round);

  const body: ViewBlock[] = [
    {
      type: "felt",
      hero: spot.hero,
      board: spot.board,
      street: spot.street,
      ...(ctx.oppMode === "shown" ? { villain: spot.villain } : {}),
    },
    { type: "text", text: drawLine(spot.draw, spot.street), center: true },
  ];

  return {
    kind: "rule24",
    kicker: "Rule of 2 and 4",
    chip: street === "flop" ? "Two cards to come" : "One card to come",
    prompt: `You have ${n} out${n === 1 ? "" : "s"}. What does the Rule of 2 and 4 give you?`,
    sub:
      street === "flop"
        ? "Two cards still to come (turn and river), so use the ×4 side of the rule."
        : "One card still to come (river only), so use the ×2 side of the rule.",
    body,
    options: options.map((v) => ({ label: `≈${v}%`, value: v })),
    answer: est,
    layout: "grid3",
    explain: () => {
      const tr = street === "flop" ? hitByRiver(n) : hitOnRiver(n);
      const err = est / 100 - tr;

      // Annotated as ExplainNote[]: without it, the first element's literal
      // `tone` narrows the array type and a later push of a different tone
      // fails to compile.
      const notes: ExplainNote[] = [];
      if (street === "flop" && n > 8) {
        const corrected = ruleOf4Corrected(n);
        notes.push({
          tone: "warn",
          title: "The ×4 rule drifts high above 8 outs.",
          text:
            `The ×4 rule drifts high above 8 outs. With ${n} outs it claims ${est}% but ` +
            `the real chance of hitting is ${pct(tr)}. Fix: subtract 1 point for every out ` +
            `above 8 — ${4 * n} − ${n - 8} = ${corrected}%.`,
        });
      } else if (street === "flop") {
        notes.push({
          tone: "plain",
          text:
            "×4 assumes you actually get to see both cards — that only holds when you're " +
            "all-in. If more betting is coming you will often pay again on the turn, so " +
            "price this street with ×2 instead.",
        });
      } else {
        notes.push({
          tone: "plain",
          text:
            "One card to come, so ×2 is the right side of the rule. The most common error " +
            "is reaching for ×4 here because it makes the call look better than it is.",
        });
      }

      return {
        rows: [
          { label: "Outs", value: String(n) },
          {
            label: "Rule applied",
            value: street === "flop" ? `outs × 4 = ${n} × 4` : `outs × 2 = ${n} × 2`,
          },
          { label: "Rule estimate", value: `${est}%` },
          { label: "True chance of hitting", value: pct(tr) },
          { label: "Estimate error", value: `${err >= 0 ? "+" : "−"}${Math.abs(err * 100).toFixed(1)} pts` },
        ],
        notes,
      };
    },
    payload: { level: ctx.level, oppMode: ctx.oppMode, street, spot },
    signature: `${spot.hero.join(",")}|${spot.board.join(",")}`,
  };
};
