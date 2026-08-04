import test from "node:test";
import assert from "node:assert/strict";
import { actionLabelBb } from "./labels";

test("actionLabelBb: check and fold need no amount", () => {
  assert.equal(actionLabelBb("X", { potChips: 55, toCallChips: 0 }), "Check");
  assert.equal(actionLabelBb("F", { potChips: 55, toCallChips: 27 }), "Fold");
});

test("actionLabelBb: a call names what it costs in bb", () => {
  assert.equal(actionLabelBb("C", { potChips: 82, toCallChips: 27 }), "Call 2.7bb");
});

test("actionLabelBb: a free call is just Call", () => {
  assert.equal(actionLabelBb("C", { potChips: 55, toCallChips: 0 }), "Call");
});

test("actionLabelBb: a bet shows size and pot percentage", () => {
  assert.equal(actionLabelBb("B27", { potChips: 55, toCallChips: 0 }), "Bet 2.7bb (49%)");
});

test("actionLabelBb: a raise names its target, not its increment", () => {
  assert.equal(actionLabelBb("R90", { potChips: 82, toCallChips: 27 }), "Raise to 9bb");
});

test("actionLabelBb: all-in is labelled as such", () => {
  assert.equal(actionLabelBb("A975", { potChips: 82, toCallChips: 27 }), "All-in 97.5bb");
});

/**
 * The drills' `money()` rounds to whole dollars, which would turn the smallest
 * meaningful bet into a lie. bb formatting keeps one decimal for exactly this
 * reason — chips are tenths of a big blind, so one decimal is exact.
 */
test("actionLabelBb: a sub-blind bet keeps its decimal", () => {
  assert.equal(actionLabelBb("B5", { potChips: 55, toCallChips: 0 }), "Bet 0.5bb (9%)");
});
