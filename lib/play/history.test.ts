import assert from "node:assert/strict";
import test from "node:test";
import type { PlayDecisionReview } from "./api";
import {
  displayCards,
  formatEvBb,
  formatEvLossBb,
  formatFrequency,
  gradingCopy,
  statusCopy,
} from "./history";

test("history frequencies accept normalized API values", () => {
  assert.equal(formatFrequency(0.376), "37.6%");
  assert.equal(formatFrequency(1), "100%");
  assert.equal(formatFrequency(null), "Unknown");
});

test("history EV formatting never invents an unknown preflop EV", () => {
  assert.equal(formatEvLossBb(null), "EV unknown");
  assert.equal(formatEvLossBb(0), "0.00bb");
  assert.equal(formatEvLossBb(0.75), "−0.75bb");
  assert.equal(formatEvBb(-1.25, true), "-1.25bb");
});

test("history distinguishes interrupted and abandoned hands from complete ones", () => {
  assert.equal(statusCopy("incomplete"), "Incomplete");
  assert.equal(statusCopy("abandoned"), "Abandoned");
  assert.equal(statusCopy("completed"), "Complete");
});

test("compact solver card strings are readable", () => {
  assert.equal(displayCards("AsKhQd"), "As Kh Qd");
  assert.equal(displayCards(""), "—");
});

test("legacy imports are never presented as authoritative grades", () => {
  const legacy = {
    grading_source: "solver",
    grading_status: "legacy_unverified",
  } as PlayDecisionReview;
  assert.equal(gradingCopy(legacy), "Legacy — unverified");
});
