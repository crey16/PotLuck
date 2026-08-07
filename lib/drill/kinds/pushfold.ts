/**
 * "Short stack" — jam-or-fold and call-or-fold against a computed
 * equilibrium, M8.7E.
 *
 * The tenth drill kind, and the one that closes the largest hole in the
 * product: every stack shorter than about 20bb was untrained, which is most
 * of a tournament and the depth where preflop study pays off fastest.
 *
 * ## Graded by EV loss, not correct/incorrect
 *
 * A jam that is 0.01bb from the threshold and a fold with aces are not the
 * same mistake, and M11's aggregates need the magnitude. So the drill reads
 * the signed EV edge — how much better acting is than folding — and the cost
 * of the wrong answer IS that number. `acceptable` carries the other action
 * whenever the pack cannot separate them, which keeps the drill from
 * inventing a distinction its own data does not support.
 *
 * ## Chip EV, said out loud, every question
 *
 * These ranges are correct in a chip-neutral spot and wrong on a tournament
 * bubble, where busting costs more than the chips say. A player drilling
 * push/fold is overwhelmingly likely to be a tournament player, so the
 * caveat is not a footnote — it is in the explain panel of every question.
 *
 * Everything numeric comes from `lib/pushfold` and `lib/poker/math.ts`. No
 * threshold is restated here.
 */
import { breakEvenFoldRate } from "../../poker/math";
import {
  callBreakEvenEquity,
  callEdgeBb,
  isIndifferent,
  positionsBehind,
  PUSHFOLD_ANTES,
  PUSHFOLD_CLASSES,
  PUSHFOLD_DEPTHS,
  PUSHFOLD_MODEL,
  shoveEdgeBb,
  SHOVE_POSITIONS,
  shoveRange,
  callRange,
  type PushfoldPosition,
} from "../../pushfold";
import { dealGridHand } from "../../poker/ranges";
import { pick, pct, sampleInt } from "../opts";
import type {
  DrillContext, DrillOption, DrillQuestion, ExplainNote, ExplainRow, Generator, ViewBlock,
} from "../contract";

/** Late positions, where a short stack's jam is most of the game. */
const LATE: PushfoldPosition[] = ["CO", "BTN", "SB"];

/**
 * Depths a beginner meets first. Not the shallowest — at 5bb almost
 * everything jams, which teaches nothing — and not the deepest, where the
 * ranges are tight enough to look like ordinary opening ranges.
 */
const LEVEL_1_DEPTHS = PUSHFOLD_DEPTHS.filter((d) => d >= 8 && d <= 15);

interface Spot {
  mode: "shove" | "call";
  hero: PushfoldPosition;
  /** Who jammed, for a calling decision. */
  shover: PushfoldPosition | null;
  stack: number;
  ante: number;
  handClass: string;
  edgeBb: number;
}

/**
 * Deal a spot, biased toward hands that are actually a decision at higher
 * levels.
 *
 * Level 1 re-rolls a hand whose edge is enormous, because "do you jam aces
 * for 10bb" is not a question. Level 3 does the opposite and hunts for the
 * boundary. Both re-roll by continuing the same seeded rng stream, so the
 * deal stays reproducible from (seed, dealCount) exactly as M5 requires.
 */
function dealSpot(ctx: DrillContext): Spot {
  const tries = 24;
  let spot: Spot | null = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    const mode: "shove" | "call" =
      ctx.level === 1 ? "shove" : ctx.rng() < (ctx.level === 2 ? 0.35 : 0.5) ? "call" : "shove";
    const ante = ctx.level === 1 ? 0 : pick(PUSHFOLD_ANTES, ctx.rng);
    const stack = ctx.level === 1
      ? pick(LEVEL_1_DEPTHS, ctx.rng)
      : PUSHFOLD_DEPTHS[sampleInt(0, PUSHFOLD_DEPTHS.length - 1, ctx.rng)];
    const handClass = PUSHFOLD_CLASSES[sampleInt(0, PUSHFOLD_CLASSES.length - 1, ctx.rng)];

    let hero: PushfoldPosition;
    let shover: PushfoldPosition | null = null;
    let edgeBb: number;
    if (mode === "shove") {
      hero = ctx.level === 1 ? pick(LATE, ctx.rng) : pick(SHOVE_POSITIONS, ctx.rng);
      edgeBb = shoveEdgeBb(hero, stack, ante, handClass);
    } else {
      shover = pick(SHOVE_POSITIONS, ctx.rng);
      hero = pick(positionsBehind(shover), ctx.rng);
      edgeBb = callEdgeBb(hero, shover, stack, ante, handClass);
    }

    const candidate: Spot = { mode, hero, shover, stack, ante, handClass, edgeBb };
    spot = candidate;
    const magnitude = Math.abs(edgeBb);
    // Level 1 wants a clear answer; level 3 wants a close one. Level 2 takes
    // whatever comes.
    if (ctx.level === 1 && magnitude >= 0.3) break;
    if (ctx.level === 2) break;
    if (ctx.level === 3 && magnitude <= 0.6) break;
  }
  return spot!;
}

const POSITION_NAME: Record<PushfoldPosition, string> = {
  UTG: "under the gun",
  HJ: "the hijack",
  CO: "the cutoff",
  BTN: "the button",
  SB: "the small blind",
  BB: "the big blind",
};

const bb = (value: number): string => `${value.toFixed(2)}bb`;

export const generatePushfold: Generator = (ctx): DrillQuestion => {
  const spot = dealSpot(ctx);
  const { mode, hero, shover, stack, ante, handClass, edgeBb } = spot;
  const aggressive = mode === "shove" ? "jam" : "call";
  const answer = edgeBb > 0 ? aggressive : "fold";
  // An edge of zero means the pack cannot separate the two actions at its own
  // resolution. Grading one of them wrong would be a verdict the data does
  // not carry — the same rule the M8.7A preflop pack applies with its
  // standard error.
  const acceptable = isIndifferent(edgeBb) ? [answer === "fold" ? aggressive : "fold"] : [];

  const [c1, c2] = dealGridHand(handClass, ctx.rng);
  const cards = [c1, c2];

  const anteLabel = ante > 0 ? `${ante}bb big-blind ante` : "no ante";
  const options: DrillOption[] = [
    { label: mode === "shove" ? "Jam all-in" : "Call all-in", value: aggressive },
    { label: "Fold", value: "fold" },
  ];

  const body: ViewBlock[] = [
    { type: "hand", label: handClass, cards },
    {
      type: "money",
      items: [
        { label: "Effective stacks", value: `${stack}bb` },
        { label: "Blinds", value: `0.5 / 1bb, ${anteLabel}` },
        { label: "Your seat", value: hero },
        ...(shover ? [{ label: "Jammed", value: `${shover} for ${stack}bb` }] : []),
      ],
    },
  ];

  const prompt = shover
    ? `${shover} jams all-in for ${stack}bb. You are in ${POSITION_NAME[hero]} with ${handClass}.`
    : `${stack}bb effective, folded to you in ${POSITION_NAME[hero]} with ${handClass}.`;

  return {
    kind: "pushfold",
    kicker: "Short stack",
    chip: `${stack}bb${ante > 0 ? " + ante" : ""}`,
    prompt,
    sub: shover
      ? "Call off your stack, or fold and keep it?"
      : "Jam or fold — there is no raise small enough to fold to.",
    body,
    options,
    answer,
    acceptable,
    layout: "two",
    explain: () => {
      const rows: ExplainRow[] = [];
      const range = shover
        ? callRange(hero, shover, stack, ante)
        : shoveRange(hero, stack, ante);
      rows.push({
        label: answer === "fold" ? "Folding is worth" : `${aggressive === "jam" ? "Jamming" : "Calling"} is worth`,
        value: `${bb(Math.abs(edgeBb))} more`,
      });
      rows.push({
        label: shover ? `${hero} calls ${shover}` : `${hero} jams`,
        value: `${range.percent.toFixed(1)}% of hands`,
      });

      const notes: ExplainNote[] = [];

      if (shover) {
        // The calling side is the half players get wrong, and the reason is
        // always the same: they compare their hand to the jamming range
        // instead of to the price.
        const required = callBreakEvenEquity(hero, shover, stack, ante);
        const post = hero === "SB" ? 0.5 : hero === "BB" ? 1 + ante : 0;
        rows.push({ label: "You still have to put in", value: bb(stack - post) });
        rows.push({ label: "Equity you need", value: pct(required) });
        notes.push({
          tone: "plain",
          title: "Calling has no fold equity in it.",
          text:
            `A jam wins the pot outright whenever everyone folds, so it can show a profit with hands ` +
            `that are behind. A call cannot — it needs ${pct(required)} raw equity against the range ` +
            `already all-in. ` +
            (post > 0
              ? `You are risking ${bb(stack - post)} rather than ${bb(stack)}, because ${bb(post)} of ` +
                "your stack is already in the pot, and that is why a blind defends so much wider than " +
                "anyone jams."
              : "With nothing invested you are risking a full stack, so this is much tighter than the jam it faces."),
        });
      } else {
        // Fold equity is the whole of the shoving side, and break-even fold
        // frequency is the standard way to see it — from lib/poker/math.ts,
        // never re-derived here.
        const risk = stack - (hero === "SB" ? 0.5 : 0);
        const pot = 0.5 + 1 + ante;
        // risk / (pot + risk) — the same helper the bluff drill uses.
        const needed = breakEvenFoldRate(pot, risk);
        rows.push({ label: "Dead money in the middle", value: bb(pot) });
        rows.push({ label: "You are risking", value: bb(risk) });
        rows.push({ label: "Break-even fold frequency", value: pct(needed) });
        notes.push({
          tone: "plain",
          title: "A jam is priced by how often it just wins.",
          text:
            `Risking ${bb(risk)} to pick up ${bb(pot)} needs everyone to fold ${pct(needed)} of the ` +
            "time to break even on its own — and every time you get called you still have your " +
            "equity in the pot, which is why the real jamming range is wider than that number alone " +
            "suggests. Shorter stacks jam wider because the dead money does not shrink when your " +
            "stack does.",
        });
        if (ante > 0) {
          notes.push({
            tone: "plain",
            title: "What the ante actually does.",
            text:
              "It adds dead money without adding to what your jam risks, so with players left to fold " +
              "out every jamming range gets wider. Blind versus blind at these depths it can do the " +
              "opposite: the ante is posted by the big blind, so it improves the price THEY are " +
              "getting to call, and below about 8bb that outweighs the extra fold equity.",
          });
        }
      }

      notes.push({
        tone: "warn",
        title: "Chip EV, not ICM.",
        text:
          "This equilibrium counts chips. In a tournament near the money, busting costs more than the " +
          "chips say and every calling range tightens sharply — a chip-EV chart used on a bubble is " +
          "wrong in a way you cannot see from the chart. " +
          PUSHFOLD_MODEL.excludes.filter((line) => !line.startsWith("Chip EV")).join(" "),
      });

      return { rows, notes };
    },
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      mode,
      hero,
      shover,
      stack,
      ante,
      handClass,
      cards,
      edgeBb,
    },
    // A repeat is the same decision, whatever suits were dealt: same seat,
    // same jammer, same depth, same ante, same hand class.
    signature: `${mode}|${hero}|${shover ?? "-"}|${stack}|${ante}|${handClass}`,
  };
};
