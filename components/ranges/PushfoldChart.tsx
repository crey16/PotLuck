"use client";

/**
 * The push/fold chart — position x depth, jam and call — M8.7E.
 *
 * Reads the same bundled equilibrium the drill grades from (`lib/pushfold`),
 * so the chart a player studies and the question they are asked cannot
 * disagree. One module, one copy of the data: the standing rule that keeps
 * this project from growing a second course map or a second seat map.
 *
 * The grid itself is `components/ui/RangeGrid`, generalised rather than
 * forked. A push/fold range is a pure in-or-out strategy, so every cell is
 * fully jammed or fully folded — except the handful the pack cannot separate
 * from indifference at its own resolution, which are drawn as a mix because
 * that is honestly what they are.
 */
import { useState } from "react";

import { RangeGrid, type RangeGridSource } from "@/components/ui/RangeGrid";
// The grid's own row/column ordering, never a second copy of it.
import { handAt } from "@/lib/poker/ranges";
import {
  callBreakEvenEquity,
  callEdgeBb,
  isIndifferent,
  positionsBehind,
  PUSHFOLD_ANTES,
  PUSHFOLD_DEPTHS,
  PUSHFOLD_MODEL,
  shoveEdgeBb,
  SHOVE_POSITIONS,
  type PushfoldPosition,
} from "@/lib/pushfold";

type Mode = "jam" | "call";

const POSITION_LABEL: Record<PushfoldPosition, string> = {
  UTG: "UTG", HJ: "HJ", CO: "CO", BTN: "BTN", SB: "SB", BB: "BB",
};

export function PushfoldChart() {
  const [mode, setMode] = useState<Mode>("jam");
  const [stack, setStack] = useState(12);
  const [ante, setAnte] = useState(0);
  const [hero, setHero] = useState<PushfoldPosition>("BTN");
  const [shover, setShover] = useState<PushfoldPosition>("BTN");

  // Who can face a jam from `shover`. Changing the jammer can strand the
  // chosen caller, so it is corrected during render rather than in an effect
  // — the M2 rule against setState inside useEffect.
  const callers = positionsBehind(shover);
  const caller: PushfoldPosition =
    mode === "call" && callers.includes(hero) ? hero : callers[callers.length - 1];

  // Built during render rather than memoized by hand: the React Compiler
  // does it better, and a manual useMemo here defeats it (it cannot preserve
  // memoization across `caller`, which is itself derived during render).
  const source: RangeGridSource = (() => {
    const edge = (hand: string): number =>
      mode === "jam"
        ? shoveEdgeBb(hero, stack, ante, hand)
        : callEdgeBb(caller, shover, stack, ante, hand);
    const label = mode === "jam" ? "Jam all-in" : "Call all-in";
    const percentOf = (key: string): number => {
      if (key === "f") return 0;
      let combos = 0;
      let taken = 0;
      for (let i = 0; i < 13; i++) {
        for (let j = 0; j < 13; j++) {
          const hand = handAt(i, j);
          const size = hand.length === 2 ? 6 : hand.endsWith("s") ? 4 : 12;
          combos += size;
          const value = edge(hand);
          if (key === "r" && value > 0) taken += size;
          if (key === "c" && isIndifferent(value)) taken += size;
        }
      }
      return (100 * taken) / combos;
    };
    return {
      name:
        mode === "jam"
          ? `${hero} jam or fold, ${stack}bb`
          : `${caller} calling ${shover}'s jam, ${stack}bb`,
      // "r" is the aggressive action and "c" is borrowed for the indifferent
      // band, which the grid already renders as the lighter shade. A third
      // colour for "too close to call" would be a new visual vocabulary for
      // something the reference charts express the same way.
      actions: [
        ["r", label],
        ["c", "Too close to call"],
        ["f", "Fold"],
      ] as const,
      hasCall: true,
      frequencyOf: (hand: string) => {
        const value = edge(hand);
        if (isIndifferent(value)) return { r: 0, c: 1, f: 0 };
        return value > 0 ? { r: 1, c: 0, f: 0 } : { r: 0, c: 0, f: 1 };
      },
      percentOf,
    };
  })();

  const price =
    mode === "call" ? callBreakEvenEquity(caller, shover, stack, ante) : null;

  return (
    <div>
      <div className="pf-controls">
        <div className="pf-group" role="group" aria-label="Decision">
          {(["jam", "call"] as Mode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`scen${mode === value ? " on" : ""}`}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value === "jam" ? "Jamming" : "Calling a jam"}
            </button>
          ))}
        </div>

        <div className="pf-group" role="group" aria-label={mode === "jam" ? "Your seat" : "Who jammed"}>
          <span className="mono-label">{mode === "jam" ? "Seat" : "Jammer"}</span>
          {SHOVE_POSITIONS.map((position) => (
            <button
              key={position}
              type="button"
              className={`scen${(mode === "jam" ? hero : shover) === position ? " on" : ""}`}
              aria-pressed={(mode === "jam" ? hero : shover) === position}
              onClick={() => (mode === "jam" ? setHero(position) : setShover(position))}
            >
              {POSITION_LABEL[position]}
            </button>
          ))}
        </div>

        {mode === "call" && (
          <div className="pf-group" role="group" aria-label="Your seat">
            <span className="mono-label">You</span>
            {callers.map((position) => (
              <button
                key={position}
                type="button"
                className={`scen${caller === position ? " on" : ""}`}
                aria-pressed={caller === position}
                onClick={() => setHero(position)}
              >
                {POSITION_LABEL[position]}
              </button>
            ))}
          </div>
        )}

        <div className="pf-group">
          <label className="mono-label" htmlFor="pf-depth">
            Stack {stack}bb
          </label>
          <input
            id="pf-depth"
            type="range"
            min={PUSHFOLD_DEPTHS[0]}
            max={PUSHFOLD_DEPTHS[PUSHFOLD_DEPTHS.length - 1]}
            step={1}
            value={stack}
            onChange={(e) => setStack(Number(e.target.value))}
          />
        </div>

        <div className="pf-group" role="group" aria-label="Ante">
          {PUSHFOLD_ANTES.map((value) => (
            <button
              key={value}
              type="button"
              className={`scen${ante === value ? " on" : ""}`}
              aria-pressed={ante === value}
              onClick={() => setAnte(value)}
            >
              {value === 0 ? "No ante" : "BB ante"}
            </button>
          ))}
        </div>
      </div>

      <RangeGrid source={source} />

      <div className="pf-notes">
        {price !== null && (
          <p>
            <b>You need {(price * 100).toFixed(1)}% equity.</b> Calling costs you the rest of your
            stack to win what is already in the middle — a jam wins the pot outright whenever
            everyone folds, and a call never can. That price, not the jammer&rsquo;s range, is what
            sets this chart.
          </p>
        )}
        {mode === "jam" && (
          <p>
            <b>Shorter stacks jam wider.</b> The blinds do not shrink when your stack does, so the
            dead money you pick up uncontested is worth more relative to what you risk. A chart
            where a shorter stack jams <i>tighter</i> has not been computed — this one is checked
            for that on publication.
          </p>
        )}
        <p className="pf-warn">
          <b>Chip EV, not ICM.</b> This equilibrium counts chips. Near the money in a tournament,
          busting costs more than the chips say and calling ranges tighten sharply — a chip-EV
          chart used on a bubble is wrong in a way you cannot see from the chart.
        </p>
        <ul>
          {PUSHFOLD_MODEL.excludes
            .filter((line) => !line.startsWith("Chip EV"))
            .map((line) => (
              <li key={line}>{line}</li>
            ))}
        </ul>
      </div>
    </div>
  );
}
