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
 * 2. **Never offer what cannot be delivered.** Every unsupported option is
 *    visibly disabled with the reason on it, sourced from `lib/play/setup.ts`
 *    and asserted by its tests. Nothing is silently substituted, and nothing
 *    is hidden — a player must be able to tell what the product does not do
 *    yet from what it will never do.
 */
import { useState } from "react";
import { PokerTable } from "./PokerTable";
import {
  ACTION_FAMILY_LABEL,
  SIX_MAX_POSITIONS,
  STOPPING_POINT_LABEL,
  SUPPORT,
  TABLE_SIZE_LABEL,
  solveAssumptions,
  validateConfig,
  type ActionFamily,
  type Position,
  type PracticeConfig,
  type StoppingPoint,
  type TableSize,
} from "@/lib/play/setup";
import { PLAY_SOLVE_PACK_ID } from "@/lib/play/constants";

const TABLE_SIZES: TableSize[] = [2, 6, 9];
const FAMILIES: ActionFamily[] = [
  "single_raised_pot", "three_bet", "four_bet", "squeeze", "limped", "isolate",
];
const STOPS: StoppingPoint[] = ["preflop", "flop", "turn", "river"];

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
  return (
    <fieldset className="pt-setup-field">
      <legend className="mono-label accent">{legend}</legend>
      {hint && <p className="pt-setup-hint">{hint}</p>}
      <div className="pt-choices">
        {options.map((option) => {
          const { available, reason } = availability(option);
          const selected = option === value;
          return (
            <button
              key={String(option)}
              type="button"
              className={`pt-choice${selected ? " selected" : ""}${available ? "" : " unavailable"}`}
              disabled={!available}
              aria-pressed={selected}
              // The reason travels on the control itself. A disabled option
              // whose explanation lives elsewhere reads as a broken button.
              title={reason}
              onClick={() => onChange(option)}
            >
              {label(option)}
              {!available && (
                <span className="pt-choice-lock" aria-hidden="true">
                  ✕
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Spelled out below the row as well as in the tooltip: a tooltip is
          invisible on touch and to a keyboard user who has not focused the
          control. */}
      {options.some((o) => !availability(o).available) && (
        <ul className="pt-setup-reasons">
          {options
            .filter((o) => !availability(o).available)
            .map((o) => (
              <li key={String(o)}>
                <strong>{label(o)}</strong> — {availability(o).reason}
              </li>
            ))}
        </ul>
      )}
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
            the hero position; seats with no solve behind them are disabled
            with their reason, and the villain seat updates to show the
            matchup the pack actually contains.
          */}
          <fieldset className="pt-setup-field">
            <legend className="mono-label accent">Your position</legend>
            <p className="pt-setup-hint">
              Pick a seat. Only the BTN-versus-BB matchup is solved so far, so the other four
              seats are shown but cannot be selected.
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
                  availability: (position) => SUPPORT.heroPosition[position as Position],
                  onSelect: (position) =>
                    onChange({ ...config, heroPosition: position as Position }),
                }}
              />
            </div>
            <ul className="pt-setup-reasons">
              {SIX_MAX_POSITIONS.filter((p) => !SUPPORT.heroPosition[p].available).length > 0 && (
                <li>
                  <strong>UTG, HJ, CO, SB</strong> — {SUPPORT.heroPosition.UTG.reason}
                </li>
              )}
            </ul>
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
