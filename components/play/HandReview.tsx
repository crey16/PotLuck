import { HandSummary } from "./HandSummary";
import { buildReviewFromHistory } from "@/lib/play/review";
import type { PlayHandReview } from "@/lib/play/api";
import { PLAY_SOLVE_PACK_ID } from "@/lib/play/constants";
import {
  displayCards,
  formatEvBb,
  formatEvLossBb,
  formatFrequency,
  gradingCopy,
  statusCopy,
} from "@/lib/play/history";

const VERDICT_LABEL: Record<string, string> = {
  correct: "Correct",
  acceptable: "Also fine",
  inaccuracy: "Inaccuracy",
  blunder: "Blunder",
  ungraded: "Ungraded",
};

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export interface HandReviewProps {
  review: PlayHandReview;
  abandoning?: boolean;
  completing?: boolean;
  onAbandon?: () => void;
  onComplete?: () => void;
}

/** Complete, server-authored decision review used by both live and reloaded hands. */
export function HandReview({
  review,
  abandoning = false,
  completing = false,
  onAbandon,
  onComplete,
}: HandReviewProps) {
  const terminal = review.status === "completed";
  const canValidateCompletion = review.solve_pack_id === PLAY_SOLVE_PACK_ID;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <section className="blueprint" style={{ padding: "var(--space-6)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
          <span className={`tag ${terminal ? "tag-neutral" : "tag-outline"} tag-mono`}>
            {statusCopy(review.status)}
          </span>
          <span className="tag tag-outline tag-mono">
            {review.hero_position} vs {review.opponent_positions.join(" / ")}
          </span>
          <span className="mono-label" style={{ marginLeft: "auto" }}>
            {dateTime(review.started_at)}
          </span>
        </div>

        <h1 style={{ fontSize: 36, margin: "var(--space-3) 0 var(--space-2)" }}>
          {displayCards(review.hero_cards)} on {displayCards([
            ...review.initial_board_cards,
            ...review.runout_cards,
          ])}
        </h1>
        <p className="text-dim" style={{ margin: 0 }}>
          {review.spot} · {review.stack_depth_bb}bb · hand {review.hand_index + 1}
        </p>

        <div className={`note ${terminal ? "" : "warnl"}`} style={{ marginTop: "var(--space-4)" }}>
          <div className="note-title">
            {terminal ? "Durable hand review" : `${statusCopy(review.status)} hand`}
          </div>
          {terminal
            ? "This is the authoritative saved record. Frequencies, EVs, losses, and verdicts were derived by the server from the versioned solve data."
            : "This hand did not reach a validated terminal path. Saved decisions remain available below, but the hand is not counted as completed."}
        </div>

        <div
          className="mono-label"
          style={{ marginTop: "var(--space-4)", overflowWrap: "anywhere", lineHeight: 1.6 }}
        >
          Solve pack {review.solve_pack_id} · source {review.source_hand_id}
        </div>

        {!terminal && review.status !== "abandoned" && (
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-4)" }}>
            {onComplete && canValidateCompletion && (
              <button
                className="btn btn-primary blueprint btn-caps"
                disabled={completing || abandoning}
                onClick={onComplete}
              >
                {completing ? "Validating…" : "Validate completion"}
              </button>
            )}
            {onAbandon && (
              <button
                className="btn btn-secondary btn-caps"
                disabled={abandoning || completing}
                onClick={onAbandon}
              >
                {abandoning ? "Marking abandoned…" : "Mark hand abandoned"}
              </button>
            )}
          </div>
        )}
      </section>

      {/*
        The SAME review the live panel shows, rebuilt from the stored rows —
        score, street tabs, decision navigation and the node table. Before
        this, finishing a hand and reloading the identical hand gave two
        different views that disagreed about how much they could tell you.

        The audited per-decision list below is kept rather than replaced: it
        carries the provenance the summary deliberately omits (solve node ids,
        grading status and version, pack id), which is what makes a saved hand
        auditable rather than merely readable.
      */}
      {review.decisions.length > 0 && (
        <HandSummary model={buildReviewFromHistory(review)} />
      )}

      {review.decisions.length === 0 ? (
        <div className="blueprint" style={{ padding: "var(--space-6)" }}>
          <h2 style={{ fontSize: 25 }}>No saved decisions</h2>
          <p className="text-dim" style={{ margin: 0 }}>
            The hand was interrupted before an action reached the server.
          </p>
        </div>
      ) : (
        review.decisions.map((decision) => (
          <section key={decision.id} className="blueprint" style={{ padding: "var(--space-6)" }}>
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
              <span className="mono-label accent">
                Decision {decision.decision_index + 1} · {decision.street}
              </span>
              <span className="tag tag-outline tag-mono">
                {VERDICT_LABEL[decision.verdict] ?? decision.verdict}
              </span>
              <span className="tag tag-neutral tag-mono">
                {gradingCopy(decision)}
              </span>
              <span className="mono-label" style={{ marginLeft: "auto" }}>
                Board {displayCards(decision.board_cards)}
              </span>
            </div>

            <div
              style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: "var(--space-3)", margin: "var(--space-4) 0",
              }}
            >
              <div>
                <div className="mono-label">Chosen action</div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 600 }}>
                  {decision.actions.find((action) => action.is_chosen)?.action_label ?? decision.chosen_action_code}
                </div>
              </div>
              <div>
                <div className="mono-label">Frequency</div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 600 }}>
                  {formatFrequency(decision.chosen_frequency)}
                </div>
              </div>
              <div>
                <div className="mono-label">EV loss</div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 600 }}>
                  {formatEvLossBb(decision.ev_loss_bb)}
                </div>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 570, fontSize: 14 }}>
                <thead>
                  <tr className="mono-label" style={{ textAlign: "left" }}>
                    <th style={{ padding: "8px 6px" }}>Action</th>
                    <th style={{ padding: "8px 6px" }}>Frequency</th>
                    <th style={{ padding: "8px 6px" }}>Action EV</th>
                    <th style={{ padding: "8px 6px" }}>EV loss</th>
                  </tr>
                </thead>
                <tbody>
                  {decision.actions.map((action) => (
                    <tr
                      key={`${decision.id}:${action.action_code}`}
                      style={{
                        borderTop: "1px solid var(--color-divider)",
                        background: action.is_chosen
                          ? "color-mix(in srgb, var(--color-accent) 9%, transparent)"
                          : undefined,
                      }}
                    >
                      <td style={{ padding: "10px 6px", fontWeight: action.is_chosen ? 600 : 400 }}>
                        {action.action_label}{action.is_chosen ? " · chosen" : ""}
                      </td>
                      <td style={{ padding: "10px 6px", fontFamily: "var(--font-mono)" }}>
                        {formatFrequency(action.frequency)}
                      </td>
                      <td style={{ padding: "10px 6px", fontFamily: "var(--font-mono)" }}>
                        {formatEvBb(action.ev_bb, true)}
                      </td>
                      <td style={{ padding: "10px 6px", fontFamily: "var(--font-mono)" }}>
                        {formatEvLossBb(action.ev_loss_bb)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!decision.alternatives_complete && (
              <div className="note warnl" style={{ fontSize: 12.5 }}>
                This imported decision predates normalized history, so only the saved action is available.
              </div>
            )}

            <div className="mono-label" style={{ marginTop: "var(--space-3)", overflowWrap: "anywhere" }}>
              Node {decision.solve_node_id} · {decision.grading_status.replaceAll("_", " ")} · version {decision.grading_version ?? "unversioned"}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
