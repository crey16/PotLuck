"use client";

/**
 * The practice setup screen — M10A / M8.7B.
 *
 * `/play` used to deal `srp-btn-bb` the moment the page opened. It now opens
 * here: the player chooses the shape of the hand, sees exactly what the
 * shipped solve does and does not cover, and starts training deliberately.
 *
 * Two rules this screen is built around, both from the roadmap:
 *
 * 1. **Reuse the seat map.** The positional selector is the same
 *    `PokerTable`/`Seat` the live table uses, in a selection mode. A second
 *    seat map would be two things to keep truthful about position order, the
 *    dealer button, and which seats folded — and they would diverge.
 *
 * 2. **Never offer what cannot be delivered — and never advertise it either.**
 *    Unbuilt options are not drawn. An axis whose options have all collapsed
 *    to one is not drawn at all, because a control with a single choice is a
 *    label pretending to be a control.
 *
 *    This reverses the original M10A treatment, which struck every unbuilt
 *    option through and printed the reason — including its roadmap milestone
 *    — underneath. That was written for a reader who wanted to know what was
 *    coming; it reads to a player as a product that mostly does not work, and
 *    `(M8.7D)` in a product string is a leak rather than an explanation.
 *
 *    **What did not change is the model.** `SUPPORT` in `lib/play/setup.ts`
 *    still lists every option with its availability, and `validateConfig`
 *    still refuses anything unavailable whatever route the configuration
 *    arrived by — a stale URL, a restored session, a future caller. Hiding is
 *    a rendering decision layered on top of a validator that never learned
 *    about it, which is the only arrangement in which hiding is safe.
 */
import { useState } from "react";
import { PokerTable } from "./PokerTable";
import {
  ACTION_FAMILY_LABEL,
  STACK_DEPTH_LABEL,
  STACK_DEPTHS,
  STOPPING_POINT_LABEL,
  SUPPORT,
  TABLE_SIZE_LABEL,
  solveAssumptions,
  validateConfig,
  type ActionFamily,
  type Position,
  type PracticeConfig,
  type StackDepth,
  type StoppingPoint,
  type TableSize,
} from "@/lib/play/setup";
import { PLAY_SOLVE_PACK_ID } from "@/lib/play/constants";

const TABLE_SIZES: TableSize[] = [2, 6, 9];
const FAMILIES: ActionFamily[] = [
  "single_raised_pot", "three_bet", "four_bet", "squeeze", "limped", "isolate",
];
const STOPS: StoppingPoint[] = ["preflop", "flop", "turn", "river"];
// Shallowest first, so the axis reads the way a tournament stack actually
// moves: the short depths are the ones a player is looking for.
const DEPTHS: StackDepth[] = [...STACK_DEPTHS];

interface ChoiceRowProps<T extends string | number> {
  legend: string;
  hint?: string;
  options: T[];
  value: T;
  label: (option: T) => string;
  availability: (option: T) => { available: boolean; reason?: string };
  onChange: (option: T) => void;
}

function ChoiceRow<T extends string | number>({
  legend, hint, options, value, label, availability, onChange,
}: ChoiceRowProps<T>) {
  const offered = options.filter((option) => availability(option).available);
  // One option is not a choice, and zero would be an empty fieldset with a
  // heading over it. Either way the axis is a fact about the pack, not a
  // question for the player — the Solve assumptions panel already states it.
  if (offered.length < 2) return null;

  return (
    <fieldset className="pt-setup-field">
      <legend className="mono-label accent">{legend}</legend>
      {hint && <p className="pt-setup-hint">{hint}</p>}
      <div className="pt-choices">
        {offered.map((option) => {
          const selected = option === value;
          return (
            <button
              key={String(option)}
              type="button"
              className={`pt-choice${selected ? " selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onChange(option)}
            >
              {label(option)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface PracticeSetupProps {
  config: PracticeConfig;
  onChange: (config: PracticeConfig) => void;
  onStart: () => void;
  /** True while the manifest is still loading. */
  loading?: boolean;
}

export function PracticeSetup({ config, onChange, onStart, loading = false }: PracticeSetupProps) {
  const [showAssumptions, setShowAssumptions] = useState(false);
  const validation = validateConfig(config);
  const assumptions = solveAssumptions(PLAY_SOLVE_PACK_ID);

  const villain: Position = config.heroPosition === "BTN" ? "BB" : "BTN";

  return (
    <div className="drill-layout">
      <div>
        <section className="blueprint pt-setup">
          <div className="mono-label accent" style={{ letterSpacing: ".14em" }}>
            Set up your practice
          </div>
          <h1 style={{ fontSize: 32, lineHeight: 1.06, margin: "var(--space-2) 0 var(--space-4)" }}>
            Choose the hand you want to train.
          </h1>

          <ChoiceRow
            legend="Table size"
            options={TABLE_SIZES}
            value={config.tableSize}
            label={(t) => TABLE_SIZE_LABEL[t]}
            availability={(t) => SUPPORT.tableSize[t]}
            onChange={(tableSize) => onChange({ ...config, tableSize })}
          />

          {/*
            The positional selector IS the play table. Clicking a seat picks
            the hero position, and the villain seat updates to show the matchup.

            **The four folded seats stay.** They are not unbuilt options being
            advertised — they are the hand: everyone folded round to the
            button, which is the spot being trained. Removing them would draw
            a two-handed table for a 6-max game and misstate the thing the
            player is about to practise. What went is the caption that framed
            them as a missing feature and named a roadmap milestone for it.
          */}
          <fieldset className="pt-setup-field">
            <legend className="mono-label accent">Your position</legend>
            <p className="pt-setup-hint">
              Pick your seat. The rest of the table has folded round to the button.
            </p>
            <div className="pt-setup-table">
              <PokerTable
                heroPosition={config.heroPosition}
                villainPosition={villain}
                heroCards={[]}
                villainCards={[]}
                showdown={false}
                board={[]}
                potChips={15}
                heroStackChips={1000}
                villainStackChips={1000}
                activeSeat={null}
                bets={{ hero: 0, villain: 0 }}
                chipFlight={null}
                spotLabel="Choose a seat"
                selectPosition={{
                  selected: config.heroPosition,
                  // Availability still comes from SUPPORT — an unsolved seat
                  // stays unclickable — but the REASON is dropped, so a folded
                  // seat does not explain itself as a missing feature on
                  // hover. It reads as what it is: a player who has folded.
                  availability: (position) => ({
                    available: SUPPORT.heroPosition[position as Position].available,
                  }),
                  onSelect: (position) =>
                    onChange({ ...config, heroPosition: position as Position }),
                }}
              />
            </div>
          </fieldset>

          <ChoiceRow
            legend="Preflop action"
            hint="Which preflop story the hand starts from."
            options={FAMILIES}
            value={config.actionFamily}
            label={(f) => ACTION_FAMILY_LABEL[f]}
            availability={(f) => SUPPORT.actionFamily[f]}
            onChange={(actionFamily) => onChange({ ...config, actionFamily })}
          />

          <ChoiceRow
            legend="Effective stack"
            hint="Below about 20bb the tree collapses to jam or fold — a different game with its own solved equilibrium."
            options={DEPTHS}
            value={config.stackDepth}
            label={(d) => STACK_DEPTH_LABEL[d]}
            availability={(d) => SUPPORT.stackDepth[d]}
            onChange={(stackDepth) => onChange({ ...config, stackDepth })}
          />

          <ChoiceRow
            legend="How far the hand goes"
            hint="Where a hand stops before the next one is dealt."
            options={STOPS}
            value={config.stoppingPoint}
            label={(s) => STOPPING_POINT_LABEL[s]}
            availability={(s) => SUPPORT.stoppingPoint[s]}
            onChange={(stoppingPoint) => onChange({ ...config, stoppingPoint })}
          />

          {!validation.ok && (
            <div className="note critl pt-setup-blocked">
              <div className="note-title">This configuration cannot start</div>
              <ul>
                {validation.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-setup-start">
            <button
              type="button"
              className="btn btn-primary blueprint btn-caps"
              disabled={!validation.ok || loading}
              onClick={onStart}
            >
              {loading ? "Loading solves…" : "Start training"}
              <span className="keyhint">Enter</span>
            </button>
          </div>
        </section>
      </div>

      <aside className="drill-rail">
        <div className="blueprint" style={{ padding: "var(--space-4)" }}>
          <div className="mono-label" style={{ letterSpacing: ".12em", marginBottom: "var(--space-3)" }}>
            Solve assumptions
          </div>
          {/*
            On screen, not in a footnote. A solve is an equilibrium of ONE
            modelled game; presenting its output as "GTO" without saying which
            game is the failure the roadmap names explicitly.
          */}
          <dl className="pt-assumptions">
            {assumptions.lines.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            className="btn btn-secondary btn-caps"
            style={{ marginTop: "var(--space-3)" }}
            aria-expanded={showAssumptions}
            onClick={() => setShowAssumptions((open) => !open)}
          >
            {showAssumptions ? "Hide what it excludes" : "What it does not cover"}
          </button>
          {showAssumptions && (
            <ul className="pt-setup-reasons" style={{ marginTop: "var(--space-3)" }}>
              {assumptions.limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          )}
          <div className="mono-label" style={{ marginTop: "var(--space-3)", overflowWrap: "anywhere" }}>
            {assumptions.packId}
          </div>
        </div>
      </aside>
    </div>
  );
}
