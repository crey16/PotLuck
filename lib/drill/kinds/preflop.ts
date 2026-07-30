/**
 * "Preflop range" — a port of the reference trainer's Q.preflop
 * (poker-math-trainer.html lines 1096-1130) onto the M2 drill contract.
 *
 * The only kind that uses `acceptable`: a hand the solver plays as a mix has
 * more than one defensible action. `answer` is the highest-frequency action;
 * `acceptable` holds every other action at >= MIX_THRESHOLD frequency. A pure
 * hand (one action at ~100%) has an empty `acceptable`.
 *
 * Level 1 only deals the five opening scenarios (SCENARIOS.slice(0, 5), all
 * raise-or-fold). Levels 2-3 deal from the full set, including the three
 * defence scenarios (3-bet / call / fold), and re-roll a pure-fold hand ~75%
 * of the time (reference lines 1099-1103) so higher levels drill borderline
 * hands instead of trivial folds.
 *
 * lib/poker/ranges.ts is the tested range engine and is never reimplemented
 * here — every frequency and percentage is derived from it.
 */
import {
  SCENARIOS,
  cellFrequency,
  combosOf,
  dealGridHand,
  handAt,
  type Action,
  type Scenario,
} from "../../poker/ranges";
import { pick, pct, rnd } from "../opts";
import type {
  DrillContext, DrillQuestion, ExplainNote, ExplainRow, Generator, ViewBlock,
} from "../contract";

export const MIX_THRESHOLD = 0.2;

const OPEN_SCENARIOS = SCENARIOS.slice(0, 5);

interface PreflopSpot {
  scenario: Scenario;
  hand: string;
}

function dealPreflopSpot(ctx: DrillContext): PreflopSpot {
  const pool = ctx.level === 1 ? OPEN_SCENARIOS : SCENARIOS;
  const scenario = pick(pool, ctx.rng);

  let hand = handAt(rnd(13, ctx.rng), rnd(13, ctx.rng));
  if (ctx.level > 1) {
    let tries = 0;
    while (cellFrequency(scenario, hand).f >= 0.999 && ctx.rng() < 0.75 && tries < 40) {
      hand = handAt(rnd(13, ctx.rng), rnd(13, ctx.rng));
      tries++;
    }
  }

  return { scenario, hand };
}

/** Highest-frequency action for a hand, ties broken by actions' display order. */
function bestAction(scenario: Scenario, hand: string): Action {
  const f = cellFrequency(scenario, hand);
  const keys = scenario.actions.map(([key]) => key);
  let best = keys[0];
  for (const key of keys) if (f[key] > f[best]) best = key;
  return best;
}

export const generatePreflop: Generator = (ctx): DrillQuestion => {
  const { scenario, hand } = dealPreflopSpot(ctx);
  const f = cellFrequency(scenario, hand);
  const answer = bestAction(scenario, hand);
  const acceptable = scenario.actions
    .map(([key]) => key)
    .filter((key) => key !== answer && f[key] >= MIX_THRESHOLD);

  const [c1, c2] = dealGridHand(hand, ctx.rng);
  const cards = [c1, c2];

  const body: ViewBlock[] = [{ type: "hand", label: hand, cards }];

  const isPure = f[answer] >= 0.999;

  return {
    kind: "preflop",
    kicker: "Preflop ranges",
    chip: scenario.name,
    prompt: `${scenario.name} — what do you do with ${hand}?`,
    sub: scenario.description,
    body,
    options: scenario.actions.map(([key, label]) => ({ label, value: key })),
    answer,
    acceptable,
    layout: scenario.actions.length === 2 ? "two" : "grid3",
    explain: () => {
      const rows: ExplainRow[] = scenario.actions.map(([key, label]) => ({
        label,
        value: pct(f[key]),
      }));
      rows.push({ label: "Hand", value: `${hand} — ${combosOf(hand)} combos` });
      rows.push({ label: "Scenario", value: scenario.name });

      const answerLabel = scenario.actions.find(([key]) => key === answer)?.[1] ?? "";

      const notes: ExplainNote[] = [
        {
          tone: "plain",
          title: isPure ? undefined : "This one is a mix.",
          text: isPure
            ? `This hand is a pure ${answerLabel.toLowerCase()} — no mixing.`
            : `Solvers split it — at the table that means pick either, but keep the split roughly honest ` +
              `across sessions rather than always defaulting to the same side. Any action at ${pct(MIX_THRESHOLD)} ` +
              "or higher is accepted here.",
        },
        {
          tone: "warn",
          title: "Reference ranges, not solver output.",
          text:
            "These are standard 6-max, 100bb reference ranges in the shape solvers produce, not live " +
            "solver output. Real solutions shift with rake, stack depth, open size and table dynamics — " +
            "this chart is accurate enough to build correct instincts and to drill against.",
        },
      ];

      return {
        rows,
        notes,
        blocks: [{ type: "grid", scenarioId: scenario.id, highlight: hand }],
      };
    },
    payload: {
      level: ctx.level,
      oppMode: ctx.oppMode,
      scenarioId: scenario.id,
      hand,
      cards,
    },
  };
};
