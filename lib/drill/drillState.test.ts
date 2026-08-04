import test from "node:test";
import assert from "node:assert/strict";
import { drillStateFromResponse, placementLevelsFromResponse, windowsFromResponse } from "./drillState";
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

/* ---------- M8.5B: placement levels ---------- */

test("placementLevelsFromResponse: reads valid per-kind levels", () => {
  assert.deepEqual(
    placementLevelsFromResponse({ placement_levels: { outs: 2, rule24: 1 } }),
    { outs: 2, rule24: 1 },
  );
});

test("placementLevelsFromResponse: drops unknown kinds and out-of-range levels", () => {
  assert.deepEqual(
    placementLevelsFromResponse({
      placement_levels: { outs: 2, nonsense: 2, rule24: 0, ev: 4, bluff: "2" },
    }),
    { outs: 2 },
  );
});

test("placementLevelsFromResponse: any unrecognised shape places nobody", () => {
  for (const json of [null, undefined, {}, { placement_levels: null }, { placement_levels: [] }, "x"]) {
    assert.deepEqual(placementLevelsFromResponse(json), {});
  }
});

test("drillStateFromResponse: carries both windows and placement levels", () => {
  const state = drillStateFromResponse({
    windows: { outs: [true, false] },
    placement_levels: { outs: 2 },
  });
  assert.deepEqual(state.windows.outs, [true, false]);
  assert.deepEqual(state.placementLevels, { outs: 2 });
});

test("drillStateFromResponse: a response with no placement field is a cold start", () => {
  const state = drillStateFromResponse({ windows: { outs: [true] } });
  assert.deepEqual(state.placementLevels, {});
});
