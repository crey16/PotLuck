/**
 * The reviewable model of a played hand: streets, decisions, and every action
 * that was available at each one with its solver frequency and EV cost.
 *
 * Pure and total, like `timeline.ts` — no React, no time, no fetching. The
 * live shell and the reloaded-history page can therefore build the same
 * review from the same instance, which is the only way the two can be
 * guaranteed to agree.
 *
 * Three things this module is careful about:
 *
 * 1. **A street that was never reached is not the same as a street with no
 *    decisions.** A hand that ended on the flop has no turn — its turn tab
 *    must be disabled, not empty. A hand where the hero checked through the
 *    turn reached it and has a decision there. `reached` and
 *    `decisions.length` are separate fields because they answer separate
 *    questions.
 *
 * 2. **EV difference, not absolute EV.** The pack exports per-action EV
 *    *loss* against the best action at that node (`PlayNode.l`), which is
 *    what a player needs and what `verdict.ts` grades on. It does not export
 *    absolute action EVs, so this module never invents one — a column of
 *    plausible absolute numbers derived by addition would be a fiction with
 *    a decimal point.
 *
 * 3. **Preflop's EV is unknown, not zero.** `lib/play/preflop.ts` grades the
 *    preflop decision against reference ranges. Its `evLossBb` is null all
 *    the way through, and `score.ts` excludes it from the mean. When M8.7A
 *    replaces that with real solver output, the null becomes a number and
 *    nothing else here has to change.
 */
import { actionLabelBb } from "./labels";
import { boardFrom, potAfter, timeline, toCallAt, type HandEvent } from "./timeline";
import { chipsToBb } from "./units";
import { EV_STEP_BB, verdictFor, type Verdict } from "./verdict";
import type { PlayInstance, PlayNode } from "./types";
import type { PlayDecisionReview, PlayHandReview } from "./api";
import { cardStr, type Card } from "../poker/engine";

export type ReviewStreet = "preflop" | "flop" | "turn" | "river";

export const REVIEW_STREETS: ReviewStreet[] = ["preflop", "flop", "turn", "river"];

/** Solver frequency at or above which an action counts as genuinely mixed. */
export const MIXED_FREQ = 51 / 255; // ~20%, the same bar verdict.ts uses

export interface ReviewAction {
  code: string;
  label: string;
  /** 0..1. */
  frequency: number;
  /** Big blinds given up against the best action at this node. >= 0. */
  evLossBb: number;
  isChosen: boolean;
  /** Ties are possible: two actions can both be indifferent-best. */
  isBest: boolean;
  /** The solver plays it often enough to be a real part of the strategy. */
  isMixed: boolean;
}

export interface ReviewDecision {
  /** 0-based position in the hand, across all streets. */
  index: number;
  street: ReviewStreet;
  /** Node path within the instance, or "preflop". */
  key: string;
  /** "solver" grades from the pack; "reference" from lib/poker/ranges.ts. */
  gradingSource: "solver" | "reference";
  /** Board visible when the decision was made. */
  board: string[];
  potBb: number | null;
  toCallBb: number | null;
  behindBb: number | null;
  actions: ReviewAction[];
  chosenLabel: string;
  /** "ungraded" only reaches here from M8's legacy archive. */
  verdict: Verdict | "ungraded";
  /** Null when the grading source carries no EV — see the header. */
  evLossBb: number | null;
  /**
   * Hero actions leading up to (and excluding) this decision, so the hand can
   * be replayed from here. Null for preflop, which restarts the whole hand
   * rather than forking mid-tree.
   */
  replayPrefix: number[] | null;
}

export interface ReviewStreetGroup {
  street: ReviewStreet;
  /** False for a street the hand ended before. */
  reached: boolean;
  decisions: ReviewDecision[];
}

export interface HandReviewModel {
  streets: ReviewStreetGroup[];
  decisions: ReviewDecision[];
}

const POSTFLOP_STREET: ReviewStreet[] = ["flop", "turn", "river"];

const cards = (list: Card[]): string[] => list.map(cardStr);

function buildActions(
  node: PlayNode,
  chosen: number,
  potChips: number,
  toCallChips: number
): ReviewAction[] {
  const minLoss = Math.min(...node.l);
  return node.a.map((code, i) => ({
    code,
    label: actionLabelBb(code, { potChips, toCallChips }),
    frequency: node.f[i] / 255,
    evLossBb: node.l[i] * EV_STEP_BB,
    isChosen: i === chosen,
    // Compare against the node's own minimum rather than assuming it is 0:
    // at a rarely-reached node the exporter's clamping can leave every
    // action with a small positive loss, and marking none of them "best"
    // would read as though the solver had no preference at all.
    isBest: node.l[i] === minLoss,
    isMixed: node.f[i] / 255 >= MIXED_FREQ,
  }));
}

export interface PreflopReviewInput {
  /** Button label of what the hero picked. */
  chosenLabel: string;
  verdict: Verdict;
}

export interface BuildReviewInput {
  inst: PlayInstance;
  flop: string;
  /** Starting pot in chips (tenths of a bb). */
  startPot: number;
  /** Starting stack in chips. */
  stack: number;
  /** Hero action indices actually taken, in order. */
  chosen: readonly number[];
  /** Omitted when the hero has not answered the preflop step yet. */
  preflop?: PreflopReviewInput;
}

/**
 * Build the review model for a hand played to `chosen`.
 *
 * Works mid-hand as well as at the end: decisions the hero has answered are
 * included, the one they are currently facing is not. That is what lets the
 * same model drive both a live "what did I just do" panel and the completed
 * hand summary.
 */
export function buildHandReview(input: BuildReviewInput): HandReviewModel {
  const { inst, flop, startPot, stack, chosen, preflop } = input;
  const decisions: ReviewDecision[] = [];

  if (preflop) {
    decisions.push({
      index: 0,
      street: "preflop",
      key: "preflop",
      gradingSource: "reference",
      board: [],
      potBb: chipsToBb(startPot),
      toCallBb: null,
      behindBb: chipsToBb(stack),
      actions: [],
      chosenLabel: preflop.chosenLabel,
      verdict: preflop.verdict,
      evLossBb: null,
      replayPrefix: null,
    });
  }

  const events: HandEvent[] = timeline(inst, chosen);
  // Board grows as the timeline is walked, so each decision records what was
  // actually visible when it was made rather than the final runout.
  const seen: HandEvent[] = [];
  let answered = 0;

  for (const event of events) {
    seen.push(event);
    if (event.type !== "decision" || event.chosen === undefined) continue;

    const node = event.node;
    const potChips = potAfter(startPot, node.tb);
    const toCallChips = toCallAt(node, inst.hero);
    const actions = buildActions(node, event.chosen, potChips, toCallChips);

    decisions.push({
      index: decisions.length,
      street: POSTFLOP_STREET[node.st],
      key: event.key || "root",
      gradingSource: "solver",
      board: cards(boardFrom(flop, seen)),
      potBb: chipsToBb(potChips),
      toCallBb: chipsToBb(toCallChips),
      behindBb: chipsToBb(stack - node.tb[inst.hero]),
      actions,
      chosenLabel: actions[event.chosen].label,
      verdict: verdictFor(node.f[event.chosen], node.l[event.chosen]),
      evLossBb: node.l[event.chosen] * EV_STEP_BB,
      replayPrefix: chosen.slice(0, answered),
    });
    answered += 1;
  }

  return { streets: groupByStreet(decisions, inst, chosen, preflop !== undefined), decisions };
}

/**
 * Which streets the hand actually reached.
 *
 * A street counts as reached when a decision happened on it OR when a card
 * for it was dealt — the hero can be all-in with a runout still to come and
 * no further decisions, and calling that river "never reached" would hide
 * the card that decided the hand.
 */
function reachedStreets(
  inst: PlayInstance,
  chosen: readonly number[],
  hasPreflop: boolean
): Set<ReviewStreet> {
  const reached = new Set<ReviewStreet>();
  if (hasPreflop) reached.add("preflop");

  const events = timeline(inst, chosen);
  let dealt = 0;
  for (const event of events) {
    if (event.type === "card") {
      dealt += 1;
      // The flop arrives with the street itself; dealt cards are turn, then
      // river.
      reached.add(dealt === 1 ? "turn" : "river");
    } else if (event.type === "decision") {
      reached.add(POSTFLOP_STREET[event.node.st]);
    }
  }
  // Any postflop event at all means the flop was seen.
  if (events.length > 0) reached.add("flop");
  return reached;
}

function groupByStreet(
  decisions: readonly ReviewDecision[],
  inst: PlayInstance,
  chosen: readonly number[],
  hasPreflop: boolean
): ReviewStreetGroup[] {
  const reached = reachedStreets(inst, chosen, hasPreflop);
  return REVIEW_STREETS.map((street) => ({
    street,
    reached: reached.has(street),
    decisions: decisions.filter((d) => d.street === street),
  }));
}

/** The street a decision index belongs to, for keeping a tab in sync. */
export function streetOf(model: HandReviewModel, index: number): ReviewStreet | null {
  return model.decisions[index]?.street ?? null;
}

/**
 * The next/previous decision index, clamped. Returns the same index at the
 * ends rather than wrapping: wrapping from the river back to preflop reads
 * as a bug when the player is stepping through a hand.
 */
export function stepDecision(model: HandReviewModel, index: number, delta: number): number {
  if (model.decisions.length === 0) return 0;
  return Math.min(model.decisions.length - 1, Math.max(0, index + delta));
}

/** The first decision on a street, for when a tab is clicked. */
export function firstDecisionOn(model: HandReviewModel, street: ReviewStreet): number | null {
  const found = model.decisions.find((d) => d.street === street);
  return found ? found.index : null;
}


/* ------------------------------------------------------------------ *
 * The same model, rebuilt from SAVED history
 * ------------------------------------------------------------------ */

/**
 * Build the review model from a server-stored hand instead of a live
 * instance.
 *
 * The point is that `/play/history` shows the *same* review as the live
 * panel. Before this existed, finishing a hand gave you a GTO score, street
 * tabs and a node table, and reloading that identical hand gave you a flat
 * list — two views of one hand that disagreed about how much they could tell
 * you.
 *
 * Everything comes from the stored row; nothing is recomputed from the pack.
 * That is deliberate and is M8's whole contract: a saved decision is
 * evidence of what was graded at the time, and re-deriving it from today's
 * pack would quietly restate history if the pack ever changed.
 *
 * Two things are legitimately absent versus the live model:
 *
 * - `replayPrefix` is always null. Replaying needs the scripted instance, and
 *   history holds the decisions rather than the tree they came from.
 * - `verdict` may be "ungraded" — the legacy archive predates normalized
 *   grading. It is counted, never scored. See `score.ts`.
 */
export function buildReviewFromHistory(hand: PlayHandReview): HandReviewModel {
  const decisions: ReviewDecision[] = hand.decisions.map((d, index) =>
    historyDecision(d, index)
  );

  // A street counts as reached if a decision happened there, or if the runout
  // got that far. A hand that went all-in on the flop reached the river even
  // with no decision on it — the same rule the live model applies.
  const reached = new Set<ReviewStreet>(decisions.map((d) => d.street));
  const boardSeen =
    hand.initial_board_cards.length + hand.runout_cards.length;
  if (boardSeen >= 1 || decisions.length > 0) reached.add("preflop");
  if (boardSeen >= 3) reached.add("flop");
  if (boardSeen >= 4) reached.add("turn");
  if (boardSeen >= 5) reached.add("river");

  return {
    decisions,
    streets: REVIEW_STREETS.map((street) => ({
      street,
      reached: reached.has(street),
      decisions: decisions.filter((d) => d.street === street),
    })),
  };
}

/** `action_context` is jsonb; read a number out of it without trusting it. */
function contextNumber(context: Record<string, unknown>, key: string): number | null {
  const value = context[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function historyDecision(d: PlayDecisionReview, index: number): ReviewDecision {
  const actions: ReviewAction[] = d.actions.map((a) => ({
    code: a.action_code,
    label: a.action_label,
    frequency: a.frequency ?? 0,
    evLossBb: a.ev_loss_bb ?? 0,
    isChosen: a.is_chosen,
    // `isBest` is computed below once the minimum is known.
    isBest: false,
    isMixed: (a.frequency ?? 0) >= MIXED_FREQ,
  }));

  // Same rule as the live model: best is the node's own minimum, not an
  // assumed zero. An imported row with no alternatives has nothing to
  // compare, so nothing is marked best rather than the single stored action
  // being promoted to "the solver's pick" on no evidence.
  if (d.alternatives_complete && actions.length > 0) {
    const min = Math.min(...actions.map((a) => a.evLossBb));
    for (const a of actions) a.isBest = a.evLossBb === min;
  }

  const chosen = actions.find((a) => a.isChosen);
  return {
    index,
    street: d.street,
    key: d.solve_node_id,
    gradingSource: d.grading_source === "solver" ? "solver" : "reference",
    board: d.board_cards,
    potBb: contextNumber(d.action_context, "pot_bb"),
    toCallBb: contextNumber(d.action_context, "to_call_bb"),
    behindBb: contextNumber(d.action_context, "behind_bb"),
    actions,
    chosenLabel: chosen?.label ?? d.chosen_action_code,
    verdict: d.verdict,
    evLossBb: d.ev_loss_bb,
    replayPrefix: null,
  };
}
