import test from "node:test";
import assert from "node:assert/strict";
import { nextDelay } from "./useHandDirector";
import { BEAT_MS, type Beat } from "@/lib/play/beats";

const beats: Beat[] = [
  { kind: "think", seat: "villain", ms: BEAT_MS.think },
  { kind: "chips", seat: "villain", chips: 27, ms: BEAT_MS.chips },
];

test("nextDelay: returns the next beat's own duration", () => {
  assert.equal(nextDelay(beats, 0, false), BEAT_MS.think);
  assert.equal(nextDelay(beats, 1, false), BEAT_MS.chips);
});

test("nextDelay: returns null once every beat is applied", () => {
  assert.equal(nextDelay(beats, 2, false), null);
});

test("nextDelay: reduced motion collapses every duration to zero", () => {
  assert.equal(nextDelay(beats, 0, true), 0);
  assert.equal(nextDelay(beats, 1, true), 0);
});

test("nextDelay: reduced motion still terminates", () => {
  assert.equal(nextDelay(beats, 2, true), null);
});

test("nextDelay: an empty queue is immediately done", () => {
  assert.equal(nextDelay([], 0, false), null);
});

/**
 * Skipping must land on exactly the state watching would have reached. If it
 * did not, the table would change under the player the moment they pressed a
 * key — which is worse than the waiting it removes.
 */
test("nextDelay: an applied cursor past the end never reschedules", () => {
  assert.equal(nextDelay(beats, 5, false), null);
  assert.equal(nextDelay(beats, 5, true), null);
});
