import test from "node:test";
import assert from "node:assert/strict";
import { gradeAnswer } from "./grade.js";
import type { DrillQuestion } from "./contract.js";

function q(over: Partial<DrillQuestion> = {}): DrillQuestion {
  return {
    kind: "preflop",
    kicker: "k",
    prompt: "p",
    body: [],
    options: [
      { label: "Raise", value: "r" },
      { label: "Call", value: "c" },
      { label: "Fold", value: "f" },
    ],
    answer: "r",
    layout: "grid3",
    explain: () => ({ rows: [], notes: [] }),
    payload: {},
    ...over,
  };
}

test("gradeAnswer: the canonical answer is correct", () => {
  assert.equal(gradeAnswer(q(), "r"), "correct");
});

test("gradeAnswer: a non-answer with no acceptable list is wrong", () => {
  assert.equal(gradeAnswer(q(), "f"), "wrong");
});

test("gradeAnswer: a value in acceptable grades as acceptable, not correct", () => {
  assert.equal(gradeAnswer(q({ acceptable: ["c"] }), "c"), "acceptable");
});

test("gradeAnswer: the canonical answer stays 'correct' even if also listed in acceptable", () => {
  assert.equal(gradeAnswer(q({ acceptable: ["r", "c"] }), "r"), "correct");
});

test("gradeAnswer: a value outside answer and acceptable is still wrong", () => {
  assert.equal(gradeAnswer(q({ acceptable: ["c"] }), "f"), "wrong");
});

test("gradeAnswer: numeric answers compare by value", () => {
  const numeric = q({
    options: [{ label: "9", value: 9 }, { label: "8", value: 8 }],
    answer: 9,
    layout: "two",
  });
  assert.equal(gradeAnswer(numeric, 9), "correct");
  assert.equal(gradeAnswer(numeric, 8), "wrong");
});

test("isRight: correct and acceptable both count as right for scoring", async () => {
  const { isRight } = await import("./grade.js");
  assert.equal(isRight(q(), "r"), true);
  assert.equal(isRight(q({ acceptable: ["c"] }), "c"), true);
  assert.equal(isRight(q(), "f"), false);
});
