"use client";

/**
 * The post-hand review — M10C and M10D.
 *
 * The reference product's shape: a GTO score for the hand, a best-move
 * summary for the selected decision, street tabs, decision-by-decision
 * navigation, and a detail view listing every action that was available with
 * its solver frequency and EV cost. Plus the two continuations that make a
 * review actionable rather than a report — **Repeat Hand** and **Play From
 * Here**.
 *
 * Everything shown here is derived by `lib/play/review.ts` and
 * `lib/play/score.ts`, both pure and tested. This component owns only the
 * selection state, and even that is lifted no higher than it needs to be: the
 * selected decision index is the one piece of state, and the street tab is
 * *derived* from it rather than tracked separately. Two pieces of state that
 * must agree are two pieces of state that will eventually disagree.
 */
import { useMemo, useState } from "react";
import { FrequencyBar } from "./FrequencyBar";
import {
  firstDecisionOn,
  stepDecision,
  type HandReviewModel,
  type ReviewDecision,
  type ReviewStreet,
} from "@/lib/play/review";
import { SCORE_BAND_LABEL, gtoScore, scoreBand } from "@/lib/play/score";
import type { Verdict } from "@/lib/play/verdict";

const VERDICT_WORD: Record<Verdict, string> = {
  correct: "Best move",
  acceptable: "Also fine",
  inaccuracy: "Inaccuracy",
  blunder: "Blunder",
};

/** Colour is never the only cue — see VerdictFlash for the same rule. */
const VERDICT_GLYPH: Record<Verdict, string> = {
  correct: "✓",
  acceptable: "≈",
  inaccuracy: "!",
  blunder: "✕",
};

const VERDICT_TONE: Record<Verdict, string> = {
  correct: "good",
  acceptable: "good",
  inaccuracy: "warn",
  blunder: "crit",
};

const STREET_LABEL: Record<ReviewStreet, string> = {
  preflop: "Preflop",
  flop: "Flop",
  turn: "Turn",
  river: "River",
};

const bbText = (value: number | null, decimals = 2): string =>
  value === null ? "—" : `${Number(value.toFixed(decimals))}bb`;

export interface HandSummaryProps {
  model: HandReviewModel;
  /** Replays the whole hand from preflop with the identical cards and runout. */
  onRepeatHand?: () => void;
  /**
   * Forks a replay from the given decision, keeping every hero action before
   * it and re-opening that node. The original hand's record is never touched.
   */
  onPlayFrom?: (decision: ReviewDecision) => void;
  /** Disabled while the hand is still being finalised server-side. */
  busy?: boolean;
}

/**
 * Why the replay buttons say "not recorded".
 *
 * A second run at a hand whose runout you have already seen is practice, not
 * evidence. Counting it would inflate the session's accuracy and feed M11's
 * weakness analysis a sample that knows the answer. The roadmap specifies
 * this replay as *unscored* for exactly that reason, and saying so on the
 * button is the difference between a deliberate rule and a silent omission.
 */
const REPLAY_NOTE =
  "Replays are graded live but not recorded: you already know the runout, so they are practice rather than a measured sample.";

export function HandSummary({ model, onRepeatHand, onPlayFrom, busy = false }: HandSummaryProps) {
  const [selected, setSelected] = useState(0);
  // Detail is a view of the SELECTED decision, not a second selection — so
  // closing it returns to the summary with the same decision still chosen.
  const [showDetail, setShowDetail] = useState(false);

  const score = useMemo(() => gtoScore(model.decisions), [model.decisions]);
  const total = model.decisions.length;
  const index = Math.min(selected, Math.max(0, total - 1));
  const decision: ReviewDecision | undefined = model.decisions[index];
  const activeStreet = decision?.street ?? "preflop";

  if (total === 0) {
    return (
      <section className="blueprint" style={{ padding: "var(--space-6)" }}>
        <div className="mono-label accent">Hand review</div>
        <p className="text-dim" style={{ margin: "var(--space-2) 0 0" }}>
          No decisions were recorded for this hand.
        </p>
      </section>
    );
  }

  return (
    <section className="pt-review blueprint">
      {/* — score header — */}
      <header className="pt-review-head">
        <div className="pt-score">
          <div className="mono-label accent">GTO score</div>
          <div className="pt-score-value">
            {score.score === null ? "—" : score.score}
            {score.score !== null && <span className="pt-score-max">/100</span>}
          </div>
          <div className="pt-score-band">
            {score.score === null
              ? "Not enough solver-graded decisions"
              : SCORE_BAND_LABEL[scoreBand(score.score)]}
          </div>
        </div>

        <dl className="pt-score-facts">
          <div>
            <dt>EV lost</dt>
            <dd>{score.totalEvLossBb > 0 ? `−${bbText(score.totalEvLossBb)}` : "0bb"}</dd>
          </div>
          <div>
            <dt>Worst decision</dt>
            <dd>{score.worstEvLossBb ? `−${bbText(score.worstEvLossBb)}` : "—"}</dd>
          </div>
          <div>
            <dt>Best moves</dt>
            <dd>
              {score.counts.correct + score.counts.acceptable}/{total}
            </dd>
          </div>
          <div>
            <dt>Blunders</dt>
            <dd>{score.counts.blunder}</dd>
          </div>
        </dl>
      </header>

      {/*
        The score's own caveat, stated where the score is — not in a footnote.
        Preflop is graded against reference ranges today, so it has no EV and
        cannot be scored; saying so is the difference between a number and a
        number that can be trusted.
      */}
      {score.unscored > 0 && (
        <p className="pt-review-caveat">
          {/* The noun agrees with the TOTAL, not the count: "1 of 4 decisions",
              never "1 of 4 decision". */}
          {score.unscored} of {total} decision{total === 1 ? "" : "s"} could not be scored:
          preflop is graded against reference ranges, not solver EVs, so{" "}
          {score.unscored === 1 ? "its cost is" : "their costs are"} unknown rather than zero.
        </p>
      )}

      {/* — street tabs — */}
      <nav className="pt-streets" aria-label="Streets">
        {model.streets.map((group) => {
          const disabled = !group.reached;
          const target = firstDecisionOn(model, group.street);
          const isActive = group.street === activeStreet;
          return (
            <button
              key={group.street}
              type="button"
              className={`pt-street${isActive ? " active" : ""}`}
              disabled={disabled || target === null}
              aria-current={isActive ? "step" : undefined}
              title={
                disabled
                  ? "The hand ended before this street"
                  : target === null
                    ? "This street was reached, but you had no decision on it"
                    : undefined
              }
              onClick={() => {
                if (target !== null) setSelected(target);
              }}
            >
              {STREET_LABEL[group.street]}
              {/* A street that was reached but had no decision still reads as
                  live — the card that arrived there decided the hand. */}
              <span className="pt-street-count" aria-hidden="true">
                {disabled ? "—" : group.decisions.length || "·"}
              </span>
            </button>
          );
        })}
      </nav>

      {/* — the selected decision — */}
      {decision && (
        <div className="pt-decision">
          <div className="pt-decision-nav">
            <button
              type="button"
              className="btn btn-secondary btn-caps"
              disabled={index === 0}
              onClick={() => setSelected(stepDecision(model, index, -1))}
            >
              ‹ Prev
            </button>
            <span className="mono-label">
              Decision {index + 1} of {total} · {STREET_LABEL[decision.street]}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-caps"
              disabled={index === total - 1}
              onClick={() => setSelected(stepDecision(model, index, 1))}
            >
              Next ›
            </button>
          </div>

          {/* Context stays visible while a node is inspected — M10D. */}
          <div className="pt-decision-context mono-label">
            <span>Board {decision.board.length ? decision.board.join(" ") : "—"}</span>
            <span>Pot {bbText(decision.potBb, 1)}</span>
            {decision.toCallBb !== null && decision.toCallBb > 0 && (
              <span>To call {bbText(decision.toCallBb, 1)}</span>
            )}
            <span>Behind {bbText(decision.behindBb, 1)}</span>
          </div>

          <div className={`pt-verdict ${VERDICT_TONE[decision.verdict]}`}>
            <span className="pt-verdict-glyph" aria-hidden="true">
              {VERDICT_GLYPH[decision.verdict]}
            </span>
            <div>
              <div className="pt-verdict-word">{VERDICT_WORD[decision.verdict]}</div>
              <div className="pt-verdict-detail">
                You played <strong>{decision.chosenLabel}</strong>
                {decision.evLossBb === null
                  ? " · EV unknown (reference range)"
                  : decision.evLossBb > 0
                    ? ` · −${bbText(decision.evLossBb)}`
                    : " · the solver's own choice"}
              </div>
            </div>
            {decision.actions.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-caps pt-verdict-toggle"
                aria-expanded={showDetail}
                onClick={() => setShowDetail((open) => !open)}
              >
                {showDetail ? "Hide detail" : "Node detail"}
              </button>
            )}
          </div>

          {/* — M10D: every action, its frequency and its EV cost — */}
          {showDetail && decision.actions.length > 0 && (() => {
            const bestCount = decision.actions.filter((a) => a.isBest).length;
            const indifferent = bestCount > 1;
            return (
            <div className="pt-nodetable">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Action</th>
                    <th scope="col">Solver frequency</th>
                    <th scope="col" className="num">
                      EV vs best
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/*
                    "Solver's pick" claims uniqueness, so it is only shown when
                    exactly one action is best. At a genuinely mixed node —
                    check 78% / bet 22% with identical EV — several actions tie,
                    and tagging them all "solver's pick" reads as a bug while
                    also hiding the actual lesson, which is that the node is
                    indifferent.
                  */}
                  {decision.actions.map((action) => (
                    <tr key={action.code} className={action.isChosen ? "chosen" : undefined}>
                      <th scope="row" style={{ fontWeight: action.isChosen ? 700 : 400 }}>
                        <span className="pt-action-mark" aria-hidden="true">
                          {action.isChosen ? "▸" : action.isBest ? "★" : " "}
                        </span>
                        {action.label}
                        {action.isChosen && <span className="pt-action-tag">you</span>}
                        {action.isBest && !indifferent && (
                          <span className="pt-action-tag">solver&apos;s pick</span>
                        )}
                        {action.isMixed && (!action.isBest || indifferent) && (
                          <span className="pt-action-tag">mixed</span>
                        )}
                      </th>
                      <td>
                        <FrequencyBar
                          frequency={action.frequency}
                          mixed={action.isMixed}
                          label={action.label}
                        />
                      </td>
                      <td className="num">
                        {action.evLossBb > 0 ? `−${bbText(action.evLossBb)}` : "best"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="pt-nodetable-note">
                {indifferent && (
                  <>
                    <strong>This node is indifferent:</strong> {bestCount} actions have the same
                    EV, so the solver mixes between them and none of them is a mistake.{" "}
                  </>
                )}
                Costs are shown against the best action at this node, which is what the solve
                exports. Absolute action EVs are not published in this pack, so none is shown
                rather than one being inferred.
              </p>
            </div>
            );
          })()}

          {/* — continuations — */}
          <div className="pt-review-actions">
            {onRepeatHand && (
              <button
                type="button"
                className="btn btn-secondary btn-caps"
                disabled={busy}
                onClick={onRepeatHand}
                title="Replay this hand from preflop — same cards, same runout, same solve"
              >
                Repeat hand
                <span className="keyhint">R</span>
              </button>
            )}
            {onPlayFrom && decision.replayPrefix !== null && (
              <button
                type="button"
                className="btn btn-secondary btn-caps"
                disabled={busy}
                onClick={() => onPlayFrom(decision)}
                title="Start a new hand from this decision, keeping everything before it"
              >
                Play from here
              </button>
            )}
            {onPlayFrom && decision.replayPrefix === null && (
              <span className="pt-review-hint">
                Preflop restarts the whole hand — use Repeat hand.
              </span>
            )}
            {(onRepeatHand || onPlayFrom) && (
              <span className="pt-review-hint">{REPLAY_NOTE}</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
