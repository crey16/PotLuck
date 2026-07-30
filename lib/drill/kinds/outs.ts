/**
 * "Count your outs" — a port of the reference trainer's Q.outs
 * (poker-math-trainer.html lines 601-625) and makeSpot (585-595) onto the
 * M2 drill contract.
 *
 * Unknown mode: outs are the cards that complete your draw, and a spot is
 * only dealt when the named draw's count matches DRAW_OUTS — the label can
 * never disagree with the answer. Face-up mode: outs are the cards that
 * actually beat the villain's hand, so dead outs are stripped and named.
 */
import {
  dealDrawSpot, dealVsHandSpot, deadOuts, describeOuts, cardStr,
  type Spot, type Street,
} from "../../poker/engine";
import { intOptsInRange, pct, withArticle } from "../opts";
import type {
  DrillContext, DrillQuestion, ExplainNote, Generator, ViewBlock,
} from "../contract";

/**
 * The spot a question is built on, in whichever opponent mode is active.
 *
 * Both engine dealers already return a fully-populated Spot — `dealVsHandSpot`
 * derives outs/outCards/unseen/equity from `outsVsHand` and `equityVsHand`
 * itself (engine.ts:419-447), so face-up mode needs no post-processing here.
 * Recomputing them would duplicate engine math for identical results.
 */
export function dealSpotOnStreet(ctx: DrillContext, street: Street): Spot {
  const opts = { street, level: ctx.level, rng: ctx.rng };
  return ctx.oppMode === "shown" ? dealVsHandSpot(opts) : dealDrawSpot(opts);
}

/** Street choice for the outs drill: turns appear from level 2 upward. */
export function dealOutsSpot(ctx: DrillContext): Spot {
  const street = ctx.level >= 2 && ctx.rng() < 0.4 ? "turn" : "flop";
  return dealSpotOnStreet(ctx, street);
}

const COUNT_PROMPT = "How many outs do you have?";
const SUB_UNKNOWN =
  "Count the cards that complete your draw: the ones that give you a straight, a flush, or better.";
const SUB_SHOWN =
  "Count only the cards that actually beat them — a card that completes your draw but improves their hand more is not an out.";

export const generateOuts: Generator = (ctx): DrillQuestion => {
  const spot = dealOutsSpot(ctx);
  const n = spot.outs;
  const candidates = [n - 1, n + 1, n - 2, n + 2, n + 3, n - 3, n + 6, Math.max(1, n - 4)];
  const options = intOptsInRange(n, candidates, 4, 1, 20, ctx.rng);

  const body: ViewBlock[] = [
    {
      type: "felt",
      hero: spot.hero,
      board: spot.board,
      street: spot.street,
      ...(ctx.oppMode === "shown" ? { villain: spot.villain } : {}),
    },
    { type: "text", text: `You have ${withArticle(spot.draw)}.`, center: true },
  ];

  const chanceLabel =
    ctx.oppMode === "shown"
      ? "Exact equity vs their hand"
      : spot.street === "flop"
        ? "Chance of hitting by the river"
        : "Chance of hitting on the river";

  return {
    kind: "outs",
    kicker: "Counting outs",
    chip: spot.street === "flop" ? "Flop" : "Turn",
    prompt: COUNT_PROMPT,
    sub: ctx.oppMode === "shown" ? SUB_SHOWN : SUB_UNKNOWN,
    body,
    options: options.map((v) => ({ label: `${v} out${v === 1 ? "" : "s"}`, value: v })),
    answer: n,
    layout: "grid3",
    explain: () => {
      // Annotated as ExplainNote[]: without it, the first element's literal
      // `tone` narrows the array type and every later push of a "warn" note
      // fails to compile.
      const notes: ExplainNote[] = [
        { tone: "plain", title: "Your outs:", text: describeOuts(spot.outCards) },
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
      } else {
        notes.push({
          tone: "warn",
          title: "Next step, when you are ready.",
          text:
            "These are the cards that complete your draw. Against a real hand some of them can be " +
            "dead — a card that makes your flush can pair the board and give them a full house. " +
            "Flip Opponent in the header to face-up and the drills will start stripping those out " +
            "and showing you which ones.",
        });
      }
      return {
        rows: [
          { label: "Your draw", value: spot.draw },
          { label: "Unseen cards", value: String(spot.unseen) },
          { label: "Outs", value: String(n) },
          { label: chanceLabel, value: pct(spot.equity) },
        ],
        notes,
      };
    },
    payload: { level: ctx.level, oppMode: ctx.oppMode, spot },
  };
};
