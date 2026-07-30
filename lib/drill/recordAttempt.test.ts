/**
 * Run with:  npx tsx --test lib/drill/recordAttempt.test.ts
 *
 * Pure unit tests for the attempt-request shaping. No network, no
 * Supabase — buildAttemptRequest is a pure function of a DrillResult.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Spot } from "../poker/engine";
import { hitProbability } from "../poker/engine";
import { buildAttemptRequest } from "./recordAttempt";

function fakeSpot(overrides: Partial<Spot> = {}): Spot {
  return {
    hero: [0, 1],
    board: [8, 12, 16],
    street: "flop",
    outs: 9,
    outCards: [4, 20, 36],
    draw: "flush draw",
    unseen: 47,
    equity: hitProbability(9, "flop"),
    ...overrides,
  };
}

function fakePayload(overrides: Partial<Spot> = {}): { level: number; oppMode: string; spot: Spot } {
  return { level: 2, oppMode: "unknown", spot: fakeSpot(overrides) };
}

test("buildAttemptRequest: posts to /api/progress/attempts", () => {
  const req = buildAttemptRequest({ kind: "outs", payload: fakePayload(), answer: 9, correct: true });
  assert.equal(req.path, "/api/progress/attempts");
});

test("buildAttemptRequest: drill_kind is 'outs'", () => {
  const req = buildAttemptRequest({ kind: "outs", payload: fakePayload(), answer: 9, correct: true });
  assert.equal(req.body.drill_kind, "outs");
});

test("buildAttemptRequest: is_correct mirrors the result's correct flag", () => {
  const correctReq = buildAttemptRequest({ kind: "outs", payload: fakePayload(), answer: 9, correct: true });
  assert.equal(correctReq.body.is_correct, true);

  const wrongReq = buildAttemptRequest({ kind: "outs", payload: fakePayload(), answer: 4, correct: false });
  assert.equal(wrongReq.body.is_correct, false);
});

test("buildAttemptRequest: answer is stringified", () => {
  const req = buildAttemptRequest({ kind: "outs", payload: fakePayload(), answer: 9, correct: true });
  assert.equal(req.body.answer, "9");
  assert.equal(typeof req.body.answer, "string");
});

test("buildAttemptRequest: drill_payload round-trips the full payload through JSON", () => {
  const payload = fakePayload();
  const req = buildAttemptRequest({ kind: "outs", payload, answer: 9, correct: true });
  const roundTripped = JSON.parse(JSON.stringify(req.body.drill_payload));
  assert.deepEqual(roundTripped, payload);
  // No functions/undefined snuck in — the round-trip must be lossless.
  assert.deepEqual(req.body.drill_payload, payload);
});

test("buildAttemptRequest: whole body round-trips through JSON.stringify with no loss", () => {
  const req = buildAttemptRequest({ kind: "outs", payload: fakePayload(), answer: 3, correct: false });
  const roundTripped = JSON.parse(JSON.stringify(req.body));
  assert.deepEqual(roundTripped, req.body);
});

test("buildAttemptRequest: drill_kind passes through for a non-outs kind", () => {
  const req = buildAttemptRequest({
    kind: "potodds",
    payload: { level: 1, oppMode: "unknown", pot: 150, call: 50 },
    answer: 25,
    correct: false,
  });
  assert.equal(req.body.drill_kind, "potodds");
  assert.equal(req.body.answer, "25");
  assert.equal(req.body.is_correct, false);
});
