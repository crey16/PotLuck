import test from "node:test";
import assert from "node:assert/strict";
import { nextLevel, pushResult, emptyWindows, WINDOW_SIZE } from "./difficulty";
import { DRILL_KINDS } from "./contract";

const rep = (n: number, v: boolean) => Array.from({ length: n }, () => v);

test("nextLevel: fewer than 6 results leaves the level alone", () => {
  assert.equal(nextLevel(rep(5, true), 1), 1);
  assert.equal(nextLevel(rep(5, false), 3), 3);
  assert.equal(nextLevel([], 2), 2);
});

test("nextLevel: 6 results is enough to move", () => {
  assert.equal(nextLevel(rep(6, true), 1), 2);
});

test("nextLevel: exactly 80% promotes (boundary is inclusive)", () => {
  // 8 of 10 = 0.80
  assert.equal(nextLevel([...rep(8, true), ...rep(2, false)], 1), 2);
});

test("nextLevel: just under 80% does not promote", () => {
  // 7 of 10 = 0.70
  assert.equal(nextLevel([...rep(7, true), ...rep(3, false)], 1), 1);
});

test("nextLevel: exactly 50% does NOT demote (boundary is exclusive)", () => {
  // 5 of 10 = 0.50
  assert.equal(nextLevel([...rep(5, true), ...rep(5, false)], 2), 2);
});

test("nextLevel: below 50% demotes", () => {
  // 4 of 10 = 0.40
  assert.equal(nextLevel([...rep(4, true), ...rep(6, false)], 2), 1);
});

test("nextLevel: promotion caps at 3 and demotion floors at 1", () => {
  assert.equal(nextLevel(rep(10, true), 3), 3);
  assert.equal(nextLevel(rep(10, false), 1), 1);
});

test("nextLevel: only the last 10 results count", () => {
  // 20 wrong then 10 right: accuracy over the window is 1.0
  const window = [...rep(20, false), ...rep(10, true)];
  assert.equal(nextLevel(window, 1), 2);
});

test("pushResult: appends and caps the window at WINDOW_SIZE", () => {
  let w: boolean[] = [];
  for (let i = 0; i < 15; i++) w = pushResult(w, i % 2 === 0);
  assert.equal(w.length, WINDOW_SIZE);
  // the survivors are the most recent 10 of the 15
  assert.deepEqual(w, Array.from({ length: 15 }, (_, i) => i % 2 === 0).slice(5));
});

test("pushResult: does not mutate its input", () => {
  const original: boolean[] = [true];
  const next = pushResult(original, false);
  assert.deepEqual(original, [true]);
  assert.deepEqual(next, [true, false]);
});

test("emptyWindows: one empty window per drill kind, and nothing else", () => {
  const w = emptyWindows();
  assert.deepEqual(Object.keys(w).sort(), [...DRILL_KINDS].sort());
  for (const k of DRILL_KINDS) assert.deepEqual(w[k], []);
});
