/**
 * Pure request-shaping for placement responses. No network — the transport is
 * the same `authRequest` the learning API already uses; what matters here is
 * that an honest "Not sure" reaches the server labelled as one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { placementResponseBody } from "./api";
import { UNSURE } from "../drill/contract";

test("placementResponseBody: a committed answer carries response_type 'answer'", () => {
  const body = placementResponseBody(7, 3, 12, true);
  assert.deepEqual(body, {
    assessment_id: 7,
    question_index: 3,
    is_correct: true,
    response_type: "answer",
    answer: "12",
  });
});

test("placementResponseBody: UNSURE is labelled and can never be correct", () => {
  const body = placementResponseBody(7, 0, UNSURE, true);
  assert.equal(body.response_type, "unsure");
  assert.equal(body.is_correct, false);
  assert.equal(body.answer, UNSURE);
});

test("placementResponseBody: a wrong committed answer stays a committed answer", () => {
  const body = placementResponseBody(7, 1, "fold", false);
  assert.equal(body.response_type, "answer");
  assert.equal(body.is_correct, false);
});

test("placementResponseBody: numeric answers are stringified for the API", () => {
  assert.equal(placementResponseBody(1, 0, 0, false).answer, "0");
  assert.equal(typeof placementResponseBody(1, 0, 42, true).answer, "string");
});
