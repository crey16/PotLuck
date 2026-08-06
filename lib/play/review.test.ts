import test from "node:test";
import assert from "node:assert/strict";
import {
  MIXED_FREQ,
  REVIEW_STREETS,
  buildHandReview,
  buildReviewFromHistory,
  firstDecisionOn,
  stepDecision,
  streetOf,
  type ReviewStreet,
} from "./review";
import { gtoScore } from "./score";
import { EV_STEP_BB } from "./verdict";
import type { PlayInstance, PlayNode } from "./types";
import type { PlayDecisionReview, PlayHandReview } from "./api";

/**
 * The same miniature instance `timeline.test.ts` uses — hero OOP with 7h7d on
 * Ts9s5h — so both suites describe one hand and a change to the fixture
 * cannot make one of them quietly meaningless.
 *
 *   root: hero checks (0) or bets (1)
 *   check → bot bets 18 → hero folds (0) / calls (1) / raises (2)
 *     call → turn 3c → hero checks (0) down to showdown
 *   bet → bot folds (end "bf")
 */
const NODE: Record<string, PlayNode> = {
  "": { pre: [], a: ["X", "B18"], f: [255, 0], l: [0, 3], tb: [0, 0], st: 0, eq: 130 },
  "0": {
    pre: [{ t: "a", v: "B18" }], a: ["F", "C", "R45"], f: [0, 204, 51],
    l: [16, 0, 6], tb: [0, 18], st: 0, eq: 128,
  },
  "0.1": {
    pre: [{ t: "c", v: "3c" }], a: ["X", "B60"], f: [255, 0], l: [0, 8],
    tb: [18, 18], st: 1, eq: 140,
  },
};

const INSTANCE: PlayInstance = {
  hero: 0,
  hand: "7h7d",
  bot: "QdTc",
  nodes: NODE,
  ends: {
    "1": { pre: [{ t: "a", v: "F" }], tb: [18, 0], k: "bf" },
    "0.0": { pre: [], tb: [0, 18], k: "f" },
    // Hero raises to 45, bot gives up. Present so the raise branch is a real
    // line rather than a dangling action the review can never be built for.
    "0.2": { pre: [{ t: "a", v: "F" }], tb: [45, 18], k: "bf" },
    "0.1.0": {
      pre: [{ t: "a", v: "X" }, { t: "c", v: "2d" }, { t: "a", v: "X" }],
      tb: [18, 18], k: "sd",
    },
  },
};

const FLOP = "Ts9s5h";
const base = { inst: INSTANCE, flop: FLOP, startPot: 55, stack: 975 };
const PREFLOP = { chosenLabel: "Call", verdict: "correct" as const };

test("review: a fresh hand has no answered decisions", () => {
  const model = buildHandReview({ ...base, chosen: [] });
  assert.equal(model.decisions.length, 0);
});

test("review: the decision the hero is currently facing is not yet reviewable", () => {
  // One answered action, one pending — only the answered one appears.
  const model = buildHandReview({ ...base, chosen: [0] });
  assert.equal(model.decisions.length, 1);
  assert.equal(model.decisions[0].key, "root");
});

test("review: preflop is included when answered, and carries no EV", () => {
  const model = buildHandReview({ ...base, chosen: [0], preflop: PREFLOP });
  const preflop = model.decisions[0];
  assert.equal(preflop.street, "preflop");
  assert.equal(preflop.gradingSource, "reference");
  assert.equal(preflop.evLossBb, null, "preflop must not claim an EV loss");
  assert.equal(preflop.chosenLabel, "Call");
  assert.deepEqual(preflop.board, []);
});

test("review: postflop decisions are graded from the solve", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1, 0], preflop: PREFLOP });
  for (const d of model.decisions.slice(1)) {
    assert.equal(d.gradingSource, "solver");
    assert.equal(typeof d.evLossBb, "number");
  }
});

test("review: decision indices are contiguous and ordered across streets", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1, 0], preflop: PREFLOP });
  assert.deepEqual(
    model.decisions.map((d) => d.index),
    model.decisions.map((_, i) => i)
  );
  assert.deepEqual(
    model.decisions.map((d) => d.street),
    ["preflop", "flop", "flop", "turn"]
  );
});

test("review: each decision records the board that was visible AT the time", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1, 0], preflop: PREFLOP });
  const [, flopRoot, flopFacing, turn] = model.decisions;
  assert.deepEqual(flopRoot.board, ["Ts", "9s", "5h"]);
  assert.deepEqual(flopFacing.board, ["Ts", "9s", "5h"]);
  // The turn decision sees four cards — not the five the hand ends on.
  assert.deepEqual(turn.board, ["Ts", "9s", "5h", "3c"]);
});

test("review: EV loss and verdict come from the node's own exported values", () => {
  const model = buildHandReview({ ...base, chosen: [0, 2] });
  const facing = model.decisions[1];
  // Action 2 (R45) at node "0": l = 6 steps, f = 51/255 = 20%.
  assert.ok(Math.abs(facing.evLossBb! - 6 * EV_STEP_BB) < 1e-9);
  assert.equal(facing.verdict, "acceptable"); // mixed at 20%, under 0.5bb
});

test("review: pot, to-call and behind are reported in big blinds", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1] });
  const facing = model.decisions[1];
  // Node "0": tb [0, 18] → pot 55 + 18 = 73 chips = 7.3bb, to call 1.8bb.
  assert.ok(Math.abs(facing.potBb! - 7.3) < 1e-9);
  assert.ok(Math.abs(facing.toCallBb! - 1.8) < 1e-9);
  assert.ok(Math.abs(facing.behindBb! - 97.5) < 1e-9);
});

/* ------------------------------------------------------------------ *
 * The action table — M10D
 * ------------------------------------------------------------------ */

test("review: every legal action at the node appears, labelled and priced", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1] });
  const actions = model.decisions[1].actions;
  assert.equal(actions.length, 3);
  assert.deepEqual(actions.map((a) => a.code), ["F", "C", "R45"]);
  assert.deepEqual(actions.map((a) => a.label), ["Fold", "Call 1.8bb", "Raise to 4.5bb"]);
  assert.deepEqual(
    actions.map((a) => Math.round(a.frequency * 100)),
    [0, 80, 20]
  );
});

test("review: exactly one action is marked chosen, and it is the one taken", () => {
  for (const pick of [0, 1, 2]) {
    const model = buildHandReview({ ...base, chosen: [0, pick] });
    const actions = model.decisions[1].actions;
    assert.equal(actions.filter((a) => a.isChosen).length, 1);
    assert.equal(actions.findIndex((a) => a.isChosen), pick);
    assert.equal(model.decisions[1].chosenLabel, actions[pick].label);
  }
});

test("review: the best action is the node's minimum loss, not an assumed zero", () => {
  const model = buildHandReview({ ...base, chosen: [0, 0] });
  const actions = model.decisions[1].actions;
  assert.deepEqual(actions.map((a) => a.isBest), [false, true, false]);

  // A node where the exporter's clamping left every action with a positive
  // loss must still name a preferred action rather than none.
  const clamped: PlayNode = {
    pre: [], a: ["X", "B18"], f: [200, 55], l: [2, 5], tb: [0, 0], st: 0, eq: 130,
  };
  const inst: PlayInstance = {
    ...INSTANCE,
    nodes: { "": clamped },
    ends: { "0": { pre: [], tb: [0, 0], k: "sd" }, "1": { pre: [], tb: [0, 0], k: "sd" } },
  };
  const model2 = buildHandReview({ ...base, inst, chosen: [0] });
  assert.deepEqual(model2.decisions[0].actions.map((a) => a.isBest), [true, false]);
});

/**
 * `isBest` means "minimum EXPORTED loss", and the export quantises loss into
 * 0.05bb steps — so an action the solver plays 0% of the time can tie for
 * best when the real difference is under 0.025bb. That is not a defect in the
 * model, and it must not be "fixed" here: the pack genuinely does not carry a
 * finer number. It is the DISPLAY's job to not read that tie as indifference,
 * which is why HandSummary breaks the tie on frequency.
 */
test("review: a zero-frequency action can tie for best — quantisation, not indifference", () => {
  const pure: PlayNode = {
    pre: [], a: ["X", "B18"], f: [0, 255], l: [0, 0], tb: [0, 0], st: 0, eq: 130,
  };
  const inst: PlayInstance = {
    ...INSTANCE,
    nodes: { "": pure },
    ends: { "0": { pre: [], tb: [0, 0], k: "sd" }, "1": { pre: [], tb: [0, 0], k: "sd" } },
  };
  const actions = buildHandReview({ ...base, inst, chosen: [0] }).decisions[0].actions;

  assert.deepEqual(actions.map((a) => a.isBest), [true, true], "both tie on exported loss");
  assert.deepEqual(actions.map((a) => a.isMixed), [false, true], "only one is really played");
  // The pair the display needs to tell them apart.
  assert.equal(actions.filter((a) => a.isBest && a.isMixed).length, 1);
});

test("review: mixed actions are those the solver plays at a meaningful rate", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1] });
  const actions = model.decisions[1].actions;
  // 0%, 80%, 20% against a ~20% bar.
  assert.deepEqual(actions.map((a) => a.isMixed), [false, true, true]);
  assert.ok(MIXED_FREQ > 0 && MIXED_FREQ < 1);
});

/* ------------------------------------------------------------------ *
 * Street tabs — reached vs. empty
 * ------------------------------------------------------------------ */

const streetsOf = (chosen: number[], preflop = true) =>
  Object.fromEntries(
    buildHandReview({ ...base, chosen, ...(preflop ? { preflop: PREFLOP } : {}) })
      .streets.map((s) => [s.street, s.reached])
  ) as Record<ReviewStreet, boolean>;

test("review: a hand that ends on the flop never reaches the turn or river", () => {
  // Hero bets, bot folds — the hand is over on the flop.
  const reached = streetsOf([1]);
  assert.equal(reached.preflop, true);
  assert.equal(reached.flop, true);
  assert.equal(reached.turn, false, "turn must be disabled, not empty");
  assert.equal(reached.river, false);
});

test("review: a hand played to showdown reaches every street", () => {
  const reached = streetsOf([0, 1, 0]);
  assert.deepEqual(reached, { preflop: true, flop: true, turn: true, river: true });
});

/**
 * "Reached" and "has a decision" are different questions. The river here is
 * dealt inside the terminal script with no hero decision on it — the card
 * still decided the hand, so the tab must be live.
 */
test("review: a street reached with no decision is still reached", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1, 0], preflop: PREFLOP });
  const river = model.streets.find((s) => s.street === "river")!;
  assert.equal(river.reached, true);
  assert.equal(river.decisions.length, 0);
});

test("review: an unanswered preflop leaves the preflop tab unreached", () => {
  const reached = streetsOf([0], false);
  assert.equal(reached.preflop, false);
});

test("review: streets are always in playing order", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1, 0], preflop: PREFLOP });
  assert.deepEqual(
    model.streets.map((s) => s.street),
    ["preflop", "flop", "turn", "river"]
  );
});

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

test("review: stepping clamps at both ends rather than wrapping", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1, 0], preflop: PREFLOP });
  assert.equal(model.decisions.length, 4);
  assert.equal(stepDecision(model, 0, -1), 0, "stepped back off the front");
  assert.equal(stepDecision(model, 3, 1), 3, "stepped past the end");
  assert.equal(stepDecision(model, 1, 1), 2);
  assert.equal(stepDecision(model, 2, -1), 1);
});

test("review: stepping an empty model is safe", () => {
  const model = buildHandReview({ ...base, chosen: [] });
  assert.equal(stepDecision(model, 0, 1), 0);
  assert.equal(stepDecision(model, 0, -1), 0);
});

test("review: a tab resolves to its first decision, or to null when it has none", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1, 0], preflop: PREFLOP });
  assert.equal(firstDecisionOn(model, "preflop"), 0);
  assert.equal(firstDecisionOn(model, "flop"), 1);
  assert.equal(firstDecisionOn(model, "turn"), 3);
  assert.equal(firstDecisionOn(model, "river"), null);
});

test("review: streetOf keeps a tab in sync with the selected decision", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1, 0], preflop: PREFLOP });
  assert.deepEqual(
    model.decisions.map((d) => streetOf(model, d.index)),
    ["preflop", "flop", "flop", "turn"]
  );
  assert.equal(streetOf(model, 99), null);
});

/* ------------------------------------------------------------------ *
 * Play From Here
 * ------------------------------------------------------------------ */

test("review: each decision's replay prefix reproduces the hand up to that point", () => {
  const chosen = [0, 1, 0];
  const model = buildHandReview({ ...base, chosen, preflop: PREFLOP });
  const postflop = model.decisions.filter((d) => d.street !== "preflop");

  assert.deepEqual(postflop.map((d) => d.replayPrefix), [[], [0], [0, 1]]);

  // The property that matters: replaying from a prefix re-reaches the very
  // decision it came from, so "Play From Here" cannot land somewhere else.
  for (const d of postflop) {
    const replayed = buildHandReview({ ...base, chosen: d.replayPrefix! });
    assert.equal(
      replayed.decisions.length,
      d.replayPrefix!.length,
      "replaying the prefix answered a different number of decisions"
    );
  }
});

test("review: preflop has no replay prefix — it restarts the hand instead", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1], preflop: PREFLOP });
  assert.equal(model.decisions[0].replayPrefix, null);
});

/* ------------------------------------------------------------------ *
 * The review model and the score agree
 * ------------------------------------------------------------------ */

test("review: the model feeds the score directly, with preflop excluded", () => {
  const model = buildHandReview({ ...base, chosen: [0, 1, 0], preflop: PREFLOP });
  const score = gtoScore(model.decisions);
  assert.equal(score.unscored, 1, "the reference-graded preflop decision must be excluded");
  assert.equal(score.scored, 3);
  // Every postflop decision here is the solver's own best action.
  assert.equal(score.score, 100);
});

test("review: a hand with only a preflop decision has no score", () => {
  const model = buildHandReview({ ...base, chosen: [], preflop: PREFLOP });
  assert.equal(gtoScore(model.decisions).score, null);
});

/* ------------------------------------------------------------------ *
 * Rebuilding the model from SAVED history — the /play/history path
 * ------------------------------------------------------------------ */

/** A minimal server-shaped hand: one graded flop decision, played to the river. */
const savedDecision = (over: Partial<PlayDecisionReview> = {}): PlayDecisionReview =>
  ({
    id: "d1", hand_id: "h1", client_decision_id: "c1", attempt_id: 1,
    solve_pack_id: "pack", decision_index: 1, solve_node_id: "pack/Ts9s5h#0@root",
    street: "flop", position: "BB", spot: "srp-btn-bb", stack_depth_bb: 100,
    board_cards: ["Ts", "9s", "5h"], board_texture: "wet", hand_class: "pair",
    action_context: { pot_bb: 5.5, to_call_bb: 0, behind_bb: 97.5 },
    chosen_action_code: "X", grading_source: "solver", grading_status: "validated",
    grading_version: "v1", chosen_frequency: 0.8, ev_basis: "relative_to_best",
    chosen_ev_bb: null, best_ev_bb: null, ev_loss_bb: 0, verdict: "correct",
    is_correct: true, alternatives_complete: true, occurred_at: "2026-08-06T00:00:00Z",
    created_at: "2026-08-06T00:00:00Z",
    actions: [
      { decision_id: "d1", action_code: "X", ordinal: 0, action_label: "Check",
        action_kind: "check", amount_bb: null, frequency: 0.8, ev_bb: null,
        ev_delta_bb: 0, ev_loss_bb: 0, is_chosen: true, created_at: "" },
      { decision_id: "d1", action_code: "B18", ordinal: 1, action_label: "Bet 1.8bb",
        action_kind: "bet", amount_bb: 1.8, frequency: 0.2, ev_bb: null,
        ev_delta_bb: -0.3, ev_loss_bb: 0.3, is_chosen: false, created_at: "" },
    ],
    ...over,
  }) as PlayDecisionReview;

const savedHand = (decisions: PlayDecisionReview[], over: Record<string, unknown> = {}) =>
  ({
    id: "h1", session_id: "s1", client_hand_id: "ch1", source_hand_id: "src",
    solve_pack_id: "pack", status: "completed", hand_index: 0, hero_position: "BB",
    opponent_positions: ["BTN"], spot: "srp-btn-bb", stack_depth_bb: 100,
    starting_street: "preflop", starting_node_id: "n", hero_cards: ["7h", "7d"],
    opponent_cards: {}, initial_board_cards: ["Ts", "9s", "5h"], runout_cards: [],
    action_history_snapshot: [], deal_snapshot: {}, result_snapshot: null,
    started_at: "", last_activity_at: "", completed_at: "", abandoned_at: null,
    decisions, ...over,
  }) as unknown as PlayHandReview;

test("history: a saved hand rebuilds the same model shape as a live one", () => {
  const model = buildReviewFromHistory(savedHand([savedDecision()]));
  assert.equal(model.decisions.length, 1);
  const d = model.decisions[0];
  assert.equal(d.street, "flop");
  assert.equal(d.gradingSource, "solver");
  assert.deepEqual(d.board, ["Ts", "9s", "5h"]);
  assert.equal(d.potBb, 5.5);
  assert.equal(d.behindBb, 97.5);
  assert.equal(d.chosenLabel, "Check");
  assert.equal(d.evLossBb, 0);
  assert.deepEqual(model.streets.map((s) => s.street), REVIEW_STREETS);
});

test("history: the action table keeps the stored frequencies and losses", () => {
  const actions = buildReviewFromHistory(savedHand([savedDecision()])).decisions[0].actions;
  assert.deepEqual(actions.map((a) => a.label), ["Check", "Bet 1.8bb"]);
  assert.deepEqual(actions.map((a) => a.frequency), [0.8, 0.2]);
  assert.deepEqual(actions.map((a) => a.evLossBb), [0, 0.3]);
  assert.deepEqual(actions.map((a) => a.isChosen), [true, false]);
  assert.deepEqual(actions.map((a) => a.isBest), [true, false]);
  assert.deepEqual(actions.map((a) => a.isMixed), [true, true]);
});

/**
 * An imported row with only the action that was taken has nothing to compare
 * against. Promoting that single action to "best" would invent a solver
 * preference from one data point.
 */
test("history: an incomplete legacy row marks nothing as best", () => {
  const legacy = savedDecision({
    alternatives_complete: false,
    verdict: "ungraded",
    ev_loss_bb: null,
    grading_source: "ungraded",
    actions: [
      { decision_id: "d1", action_code: "X", ordinal: 0, action_label: "Check",
        action_kind: "check", amount_bb: null, frequency: null, ev_bb: null,
        ev_delta_bb: null, ev_loss_bb: null, is_chosen: true, created_at: "" },
    ],
  } as Partial<PlayDecisionReview>);
  const d = buildReviewFromHistory(savedHand([legacy])).decisions[0];
  assert.deepEqual(d.actions.map((a) => a.isBest), [false]);
  assert.equal(d.verdict, "ungraded");
  assert.equal(d.evLossBb, null);
  assert.equal(d.gradingSource, "reference", "a non-solver grade must not read as solver");
  // And it must not be scored.
  const score = gtoScore(buildReviewFromHistory(savedHand([legacy])).decisions);
  assert.equal(score.score, null);
  assert.equal(score.counts.ungraded, 1);
});

test("history: a saved hand can never offer a replay", () => {
  // Replaying needs the scripted instance; history holds decisions, not the
  // tree they came from. Offering it would deal something else.
  const model = buildReviewFromHistory(savedHand([savedDecision()]));
  assert.deepEqual(model.decisions.map((d) => d.replayPrefix), [null]);
});

test("history: streets reached follow the runout, not just the decisions", () => {
  // One flop decision, but the hand ran out to the river — those streets were
  // reached even though nothing was decided on them.
  const model = buildReviewFromHistory(
    savedHand([savedDecision()], { runout_cards: ["2d", "8c"] })
  );
  const reached = Object.fromEntries(model.streets.map((s) => [s.street, s.reached]));
  assert.deepEqual(reached, { preflop: true, flop: true, turn: true, river: true });
  assert.equal(model.streets.find((s) => s.street === "river")!.decisions.length, 0);
});

test("history: a hand that ended on the flop never reaches the turn", () => {
  const model = buildReviewFromHistory(savedHand([savedDecision()]));
  const reached = Object.fromEntries(model.streets.map((s) => [s.street, s.reached]));
  assert.equal(reached.flop, true);
  assert.equal(reached.turn, false);
  assert.equal(reached.river, false);
});
