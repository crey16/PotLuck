import test from "node:test";
import assert from "node:assert/strict";
import { nudgeFor, parseNudgeDismissed, NUDGE_DISMISSED_COOKIE } from "./nudge";

const state = (
  status: "in_progress" | "completed" | "skipped" | null,
  hasStartedLearning: boolean,
) => ({ status, hasStartedLearning });

/* ---------- who sees the lessons nudge ---------- */

test("a player with no lessons and no placement row sees the lessons nudge", () => {
  const nudge = nudgeFor(state(null, false), false);
  assert.equal(nudge?.kind, "start-lessons");
  assert.equal(nudge?.href, "/learn");
});

test("a player who skipped placement still sees the lessons nudge", () => {
  // Skipping declines the assessment, not the course. They are still cold.
  assert.equal(nudgeFor(state("skipped", false), false)?.kind, "start-lessons");
});

test("a player who completed placement but no lessons sees the lessons nudge", () => {
  assert.equal(nudgeFor(state("completed", false), false)?.kind, "start-lessons");
});

test("a player with a lesson behind them sees nothing", () => {
  for (const status of ["completed", "skipped", null] as const) {
    assert.equal(nudgeFor(state(status, true), false), null, `status ${status}`);
  }
});

/* ---------- the mid-placement dead end ---------- */

test("an abandoned placement is offered a way back", () => {
  // PlacementPlayer writes its row on mount, so someone who answers two
  // questions and navigates away is no longer "new" to the router and nothing
  // else points them back. This banner is their only route in.
  const nudge = nudgeFor(state("in_progress", false), false);
  assert.equal(nudge?.kind, "finish-placement");
  assert.equal(nudge?.href, "/placement");
});

test("an unfinished placement outranks the lessons nudge", () => {
  // Both conditions hold at once; finishing placement changes where the
  // lessons start, so it has to come first.
  assert.equal(nudgeFor(state("in_progress", false), false)?.kind, "finish-placement");
});

test("an unfinished placement is not raised once lessons are underway", () => {
  // They found the course anyway. Nagging about placement at that point is
  // noise, and placement no longer changes anything for them.
  assert.equal(nudgeFor(state("in_progress", true), false), null);
});

/* ---------- dismissal ---------- */

test("dismissal silences every nudge", () => {
  assert.equal(nudgeFor(state(null, false), true), null);
  assert.equal(nudgeFor(state("in_progress", false), true), null);
});

test("parseNudgeDismissed only accepts the exact cookie value", () => {
  assert.equal(parseNudgeDismissed("1"), true);
  for (const value of [undefined, "", "0", "true", "yes", "11"]) {
    assert.equal(parseNudgeDismissed(value), false, `value ${String(value)}`);
  }
});

test("the cookie name follows the existing hcwk_ convention", () => {
  assert.match(NUDGE_DISMISSED_COOKIE, /^hcwk_/);
});

/* ---------- copy ---------- */

test("every nudge names a destination, a heading and a call to action", () => {
  for (const s of [state(null, false), state("in_progress", false)]) {
    const nudge = nudgeFor(s, false)!;
    assert.ok(nudge.href.startsWith("/"));
    assert.ok(nudge.title.length > 0);
    assert.ok(nudge.body.length > 0);
    assert.ok(nudge.cta.length > 0);
  }
});
