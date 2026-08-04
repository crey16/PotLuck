/**
 * "Rule of 2 and 4" — a port of the reference trainer's Q.rule24
 * (poker-math-trainer.html lines 628-662) onto the M2 drill contract.
 *
 * The rule itself (outs x4 on the flop, x2 on the turn) is a fast estimate,
 * not the truth. The explanation always shows the true chance of hitting —
 * hitByRiver / hitOnRiver from the engine, never derived from the rule — and,
 * above 8 outs on the flop, the corrected figure from ruleOf4Corrected. Never
 * hand-compute either.
 *
 * M8.5D: the prompt no longer states the out count. It used to read "You have
 * N outs…", which reduced the drill to one multiplication and meant a player
 * could never get it wrong for the reason that actually costs money at the
 * table — miscounting. The player now counts from the felt, so the distractors
 * are built from the miscounts players really produce (see `miscounts`) and
 * the explanation shows the counted cards, not just the total.
 */
import { dealSpotOnStreet } from "./outs";
import { hitByRiver, hitOnRiver, ruleOf2And4, ruleOf4Corrected } from "../../poker/math";
import { buildOpts, pct } from "../opts";
import { drawLine, deadOutsNote } from "../notes";
import { DRAW_OUTS, deadOuts, describeOuts } from "../../poker/engine";
import type {
  DrillContext, DrillQuestion, ExplainNote, Generator, ViewBlock,
} from "../contract";
import type { Spot, Street } from "../../poker/engine";

/** Street choice for the rule-of-2-and-4 drill: flop or turn, 50/50. */
function pickStreet(ctx: DrillContext): Street {
  return ctx.rng() < 0.5 ? "flop" : "turn";
}

/**
 * Whether the draw's name may be printed beside the felt.
 *
 * Two conditions, both required, and both load-bearing:
 *
 *  - Level 1 only. From level 2 up the name is hidden, because a named draw
 *    with a canonical count ("flush draw") hands the player the number the
 *    drill is now asking them to produce. Level 1 keeps it as a scaffold.
 *  - The name and the true count must agree. This is the CLAUDE.md label/count
 *    rule. `dealDrawSpot` already enforces it, but `dealVsHandSpot` (face-up
 *    mode) does not: dead outs mean a hero holding a flush draw can have 7 live
 *    outs, not 9, and printing "flush draw" there would teach the wrong count.
 */
export function showsDrawLabel(spot: Spot, level: number): boolean {
  return level === 1 && DRAW_OUTS[spot.draw] === spot.outs;
}

/**
 * The out counts a player who miscounts this specific spot actually arrives
 * at. Distractors built from these are the point of the drill: an option list
 * of arithmetic slips around the right count only ever tests multiplication.
 *
 *  - `DRAW_OUTS[draw]` — the textbook count for the named draw, which is wrong
 *    exactly when dead outs or a shared board hand have eaten some of it.
 *  - the naive sum of a combo draw's parts — "flush draw + gutshot" is 12, not
 *    9 + 4, because three cards complete both.
 *  - `n + dead.length` — the count you get by never asking what the card does
 *    for the opponent. This is the expensive one.
 *
 * Returns counts, not percentages; the caller applies the rule.
 */
export function miscounts(spot: Spot, oppMode: string): number[] {
  const n = spot.outs;
  const out: number[] = [];

  const nominal = DRAW_OUTS[spot.draw];
  if (nominal !== undefined) out.push(nominal);

  const parts = spot.draw.split(" + ");
  if (parts.length > 1) {
    const sum = parts.reduce((a, p) => a + (DRAW_OUTS[p] ?? 0), 0);
    if (sum > 0) out.push(sum);
  }

  if (oppMode === "shown" && spot.villain) {
    const dead = deadOuts(spot.hero, spot.villain, spot.board);
    if (dead.length) out.push(n + dead.length);
  }

  // Plain over/under-counts, so the list is never thin on a spot whose draw has
  // no canonical name (face-up mode's "two overcards", "no obvious draw").
  out.push(n + 1, n - 1, n + 2, n - 2, n + 3);

  return out.filter((v) => v > 0 && v !== n);
}

export const generateRule24: Generator = (ctx): DrillQuestion => {
  const street = pickStreet(ctx);
  const spot = dealSpotOnStreet(ctx, street);
  const n = spot.outs;
  const cardsToCome = street === "flop" ? 2 : 1;
  const est = ruleOf2And4(n, cardsToCome);
  const showLabel = showsDrawLabel(spot, ctx.level);

  // Every distractor is the rule correctly applied to a plausible WRONG count,
  // plus the one arithmetic error worth drilling: reaching for the other side
  // of the rule (x4 with one card to come is what makes a bad call look good).
  const candidates = [
    ...miscounts(spot, ctx.oppMode).map((m) => ruleOf2And4(m, cardsToCome)),
    street === "flop" ? 2 * n : 4 * n,
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
  ];
  if (showLabel) {
    body.push({ type: "text", text: drawLine(spot.draw, spot.street), center: true });
  }

  return {
    kind: "rule24",
    kicker: "Rule of 2 and 4",
    chip: street === "flop" ? "Two cards to come" : "One card to come",
    prompt: "Count your outs. What does the Rule of 2 and 4 give you?",
    sub:
      (ctx.oppMode === "shown"
        ? "Count only the cards that actually beat their hand, then apply the rule. "
        : "Count the cards that complete your draw, then apply the rule. ") +
      (street === "flop"
        ? "Two cards still to come (turn and river), so use the ×4 side."
        : "One card still to come (river only), so use the ×2 side."),
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
      const notes: ExplainNote[] = [
        // The count comes first now: it is the half of the answer the prompt
        // stopped giving away, so a wrong pick must teach the count and not
        // only the multiplication.
        { tone: "plain", title: `Your ${n} out${n === 1 ? "" : "s"}:`, text: describeOuts(spot.outCards) },
      ];
      if (ctx.oppMode === "shown") {
        const dead = deadOutsNote(spot.hero, spot.villain!, spot.board);
        if (dead) notes.push(dead);
      }
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
          { label: "Your draw", value: spot.draw },
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
