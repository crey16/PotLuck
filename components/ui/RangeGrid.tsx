"use client";

import { useMemo, useRef, useState } from "react";

import {
  cellFrequency,
  getScenario,
  handAt,
  rangePercent,
  type Action,
} from "@/lib/poker/ranges";
import {
  moveGridSelection,
  rangeCellAppearance,
  rangeCellDescription,
} from "@/components/ui/rangeCell";

/**
 * Everything the grid needs to draw a range, without knowing where it came
 * from — M8.7E.
 *
 * The grid used to read `lib/poker/ranges.ts` directly, which meant the only
 * ranges that could ever be charted were the eight hand-authored reference
 * scenarios. Push/fold ranges are solved output at a stack depth, and forking
 * a second 13x13 grid to show them is exactly the duplication this codebase
 * keeps refusing (two course maps, two seat maps, two copies of the poker
 * math). So the grid takes a source instead, and the scenario path became one
 * implementation of it.
 */
export interface RangeGridSource {
  /** Named in the grid's accessible label. */
  name: string;
  /** Action key + legend label, in display order. */
  actions: readonly (readonly [string, string])[];
  /** Whether a distinct calling action exists, for the cell descriptions. */
  hasCall: boolean;
  /** Per-hand mix. Must sum to 1 across r + c + f. */
  frequencyOf(hand: string): { r: number; c: number; f: number };
  /** Combo-weighted share of all hands taking an action, 0..100. */
  percentOf(key: string): number;
}

export interface RangeGridProps {
  /** A reference scenario from lib/poker/ranges.ts. */
  scenarioId?: string;
  /** Any other range — solved push/fold output, for instance. */
  source?: RangeGridSource;
  highlight?: string;
}

/** The reference scenarios, as a grid source. */
function scenarioSource(scenarioId: string): RangeGridSource | null {
  const scenario = getScenario(scenarioId);
  if (!scenario) return null;
  return {
    name: scenario.name,
    actions: scenario.actions,
    hasCall: Boolean(scenario.c),
    frequencyOf: (hand) => cellFrequency(scenario, hand),
    percentOf: (key) => rangePercent(scenario, key as Action),
  };
}

/** Value steps of one hue, per the v2 redesign: raise/3-bet is the solid
 *  accent, call the light accent, fold transparent with a hairline border. Split
 *  cells are mixed frequencies, filled bottom-up — see rangeCell.ts for why
 *  those carry their own modifier class. */
const RAISE = "var(--color-accent)";
const CALL = "var(--color-accent-200)";

/**
 * The 13x13 preflop grid.
 *
 * **Why this is a client component (M8.9A).** A cell's exact action mix used
 * to live only in its `title`, which meant that on a phone it was unreachable
 * — there is no hover on touch. Cells are now selectable, and the selected
 * cell's mix is written out below the grid in text. The `title` stays as the
 * mouse shortcut; it is no longer the only way in.
 *
 * **Roving tabindex, not 169 tab stops.** The grid is a composite widget: if
 * every cell were focusable, a keyboard user would have to press Tab 169
 * times to get past it. One cell holds `tabIndex={0}` and the arrows move
 * within, which is the standard pattern for a grid and the only version of
 * "keyboard accessible" that is actually usable here.
 *
 * The grid deliberately does NOT scroll or become a list on small screens.
 * A range chart's whole value is seeing all 169 combos as one shape, and it
 * already fits — measured at 34px cells in a 500px viewport. What did not
 * work was the 8px label and the hover-only detail, so the label is now 9px
 * and only has to identify the cell; the exact mix lives in the row below.
 */
export function RangeGrid({ scenarioId, source, highlight }: RangeGridProps) {
  const resolved = useMemo(
    () => source ?? (scenarioId ? scenarioSource(scenarioId) : null),
    [source, scenarioId]
  );
  const gridRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const cells = useMemo(() => {
    if (!resolved) return [];
    const out: {
      hand: string; bg: string; mod: string; pick: boolean; title: string;
    }[] = [];
    for (let i = 0; i < 13; i++) {
      for (let j = 0; j < 13; j++) {
        const hand = handAt(i, j);
        const f = resolved.frequencyOf(hand);
        const { background, className } = rangeCellAppearance(f);
        out.push({
          hand,
          bg: background,
          mod: className,
          pick: hand === highlight,
          title: rangeCellDescription(hand, f, resolved.hasCall),
        });
      }
    }
    return out;
  }, [resolved, highlight]);

  if (!resolved) return null;

  const totalPlayed = resolved.percentOf("r") + resolved.percentOf("c");
  // The roving tab stop: the selected cell, or the first one before any
  // selection exists, so the grid is always reachable with exactly one Tab.
  const tabStop = selected ?? 0;

  const focusCell = (index: number) => {
    setSelected(index);
    const node = gridRef.current?.querySelectorAll<HTMLButtonElement>(".gc")[index];
    node?.focus();
  };

  return (
    <div>
      <div className="legend-line">
        {resolved.actions.map(([key, label]) => (
          <span key={key} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <i
              className="sw"
              style={
                key === "f"
                  ? { border: "1px solid var(--line)" }
                  : { background: key === "r" ? RAISE : CALL }
              }
            />
            {label}
            {key !== "f" && <b>&nbsp;{resolved.percentOf(key).toFixed(1)}%</b>}
          </span>
        ))}
        <span style={{ color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>
          Split cell = mixed frequency, filled bottom-up
        </span>
        <span style={{ marginLeft: "auto", color: "var(--color-accent-700)" }}>
          Total played <b>&nbsp;{totalPlayed.toFixed(1)}%</b>
        </span>
      </div>

      <div
        className="grid13"
        ref={gridRef}
        role="grid"
        aria-label={`${resolved.name} — 169 starting hands`}
        onKeyDown={(e) => {
          const next = moveGridSelection(tabStop, e.key);
          if (next === tabStop) return;
          e.preventDefault();
          focusCell(next);
        }}
      >
        {cells.map((c, i) => (
          <button
            key={c.hand}
            type="button"
            role="gridcell"
            className={`gc${c.mod ? ` ${c.mod}` : ""}${c.pick ? " pick" : ""}${
              selected === i ? " sel" : ""
            }`}
            style={{ background: c.bg }}
            title={c.title}
            // The label reads the whole mix, not just the hand: a screen
            // reader landing on "A5s" alone learns nothing about the range.
            aria-label={c.title}
            aria-selected={selected === i}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => setSelected(i)}
            onFocus={() => setSelected(i)}
          >
            {c.hand}
          </button>
        ))}
      </div>

      {/*
        The detail row. This is the touch equivalent of the tooltip, and it is
        always present rather than appearing on selection — a panel that pops
        into existence shifts the grid up and moves the cell out from under
        the finger that just tapped it.
      */}
      <div className="grid13-detail" aria-live="polite">
        {selected === null
          ? "Tap or arrow onto a hand to read its exact mix."
          : cells[selected].title}
      </div>

      <div
        style={{
          display: "flex", justifyContent: "space-between", marginTop: "var(--space-3)",
          fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
        }}
      >
        <span>Suited above the diagonal · pairs on it · offsuit below</span>
        {highlight && <span>{highlight} outlined — the hand you were dealt</span>}
      </div>
    </div>
  );
}
