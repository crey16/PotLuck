import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAY_SOLVE_PACK_ID,
  buildPlayDecisionBody,
  buildPlayHandBody,
  buildPlaySessionBody,
  sourceHandId,
  type CreatePlayConfiguration,
  type PlayConfiguration,
} from "./api";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const HAND_ID = "22222222-2222-4222-8222-222222222222";
const DECISION_ID = "33333333-3333-4333-8333-333333333333";

test("play session request pins the supported configuration and solve version", () => {
  assert.deepEqual(buildPlaySessionBody(SESSION_ID), {
    client_session_id: SESSION_ID,
    solve_pack_id: PLAY_SOLVE_PACK_ID,
    config: {
      solution_profile_id: "cash-6max-chip-ev",
      solution_version: "m6-v1",
      table_size: 6,
      hero_positions: ["BTN", "BB"],
      matchup_positions: ["BTN", "BB"],
      starting_spot: "preflop",
      action_family_filters: ["single_raised_pot"],
      stack_depth_bb: 100,
      rake_model: "none",
      ev_model: "chip_ev",
      advanced_settings: {},
    },
  });
});

test("history configuration represents archived legacy snapshots without widening writes", () => {
  const legacyConfig: PlayConfiguration = {
    solution_profile_id: "legacy-client-play",
    solution_version: "m6-attempt-payload-v1",
    table_size: 6,
    hero_positions: ["BTN", "BB"],
    matchup_positions: ["BTN", "BB"],
    starting_spot: "preflop",
    action_family_filters: ["single_raised_pot"],
    stack_depth_bb: 100,
    rake_model: "none",
    ev_model: "chip_ev",
    advanced_settings: { legacy_import: true },
  };

  assert.deepEqual(JSON.parse(JSON.stringify(legacyConfig)), legacyConfig);
  // The create builder remains pinned to the current pack despite the broad
  // read type used for archived history.
  const createConfig: CreatePlayConfiguration = buildPlaySessionBody(SESSION_ID).config;
  assert.equal(createConfig.solution_profile_id, "cash-6max-chip-ev");
  assert.deepEqual(createConfig.advanced_settings, {});
});

test("source hand identity is stable across client and API request", () => {
  assert.equal(sourceHandId("AsKhQd", 17), `${PLAY_SOLVE_PACK_ID}/AsKhQd#17`);
  assert.deepEqual(buildPlayHandBody(HAND_ID, "AsKhQd", 17), {
    client_hand_id: HAND_ID,
    flop: "AsKhQd",
    instance_index: 17,
  });
});

test("decision request contains identity and choice but no client grading", () => {
  const body = buildPlayDecisionBody(DECISION_ID, "0.1", "C");
  assert.deepEqual(body, {
    client_decision_id: DECISION_ID,
    node_path: "0.1",
    chosen_action_code: "C",
  });
  for (const untrusted of [
    "is_correct",
    "frequency",
    "ev_bb",
    "ev_loss_bb",
    "verdict",
    "grading_source",
  ]) {
    assert.equal(untrusted in body, false, `${untrusted} must be server-derived`);
  }
});

test("root and preflop node IDs remain explicit through JSON serialization", () => {
  const preflop = buildPlayDecisionBody(DECISION_ID, "preflop", "r");
  const root = buildPlayDecisionBody(DECISION_ID, "root", "X");
  assert.equal(JSON.parse(JSON.stringify(preflop)).node_path, "preflop");
  assert.equal(JSON.parse(JSON.stringify(root)).node_path, "root");
});
