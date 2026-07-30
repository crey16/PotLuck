import test from "node:test";
import assert from "node:assert/strict";
import { windowsFromResponse } from "./drillState";
import { DRILL_KINDS } from "./contract";
import { WINDOW_SIZE } from "./difficulty";

test("windowsFromResponse: fills every kind, even ones absent from the response", () => {
  const w = windowsFromResponse({ windows: { outs: [true, false] } });
  assert.deepEqual(Object.keys(w).sort(), [...DRILL_KINDS].sort());
  assert.deepEqual(w.outs, [true, false]);
  assert.deepEqual(w.preflop, []);
});

test("windowsFromResponse: caps a window at WINDOW_SIZE, keeping the most recent", () => {
  const many = Array.from({ length: 25 }, (_, i) => i % 2 === 0);
  const w = windowsFromResponse({ windows: { outs: many } });
  assert.equal(w.outs.length, WINDOW_SIZE);
  assert.deepEqual(w.outs, many.slice(-WINDOW_SIZE));
});

test("windowsFromResponse: coerces to booleans and drops non-arrays", () => {
  const w = windowsFromResponse({ windows: { outs: [1, 0, true], ev: "nope" } });
  assert.deepEqual(w.outs, [true, false, true]);
  assert.deepEqual(w.ev, []);
});

test("windowsFromResponse: garbage in gives empty windows, never a throw", () => {
  for (const junk of [null, undefined, 42, "x", {}, { windows: null }, { windows: [] }]) {
    const w = windowsFromResponse(junk);
    assert.deepEqual(Object.keys(w).sort(), [...DRILL_KINDS].sort());
    for (const k of DRILL_KINDS) assert.deepEqual(w[k], []);
  }
});

test("windowsFromResponse: ignores kinds that are not real drill kinds", () => {
  const w = windowsFromResponse({ windows: { nonsense: [true, true] } });
  assert.equal("nonsense" in w, false);
});
