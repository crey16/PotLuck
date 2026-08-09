import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PENDING_MS,
  abandonNavigation,
  beginNavigation,
  completeNavigation,
  navigationTarget,
  __pendingForTest,
} from "./navTiming";
import { __resetTraceForTest } from "./clientTrace";

/**
 * Guards route-transition timing — M8.8A.
 *
 * The logic below is all conditions, and every one of them is a way for the
 * timer to attach itself to the wrong navigation, never close, or report a
 * redirect as a success. None of that needs a browser to test, which is why it
 * lives here rather than inside the component.
 */

const ORIGIN = "https://potluck.example";
const plainClick = {
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};
const link = (href: string, extra: Partial<{ target: string; hasDownload: boolean }> = {}) => ({
  href,
  target: extra.target ?? "",
  hasDownload: extra.hasDownload ?? false,
});

test.beforeEach(() => {
  abandonNavigation();
  __resetTraceForTest();
});

test("a plain click on an in-app link starts a measurement", () => {
  assert.equal(navigationTarget(plainClick, link("/learn"), ORIGIN, "/"), "/learn");
  assert.equal(
    navigationTarget(plainClick, link(`${ORIGIN}/play`), ORIGIN, "/"),
    "/play"
  );
});

test("clicks that do not navigate this tab are ignored", () => {
  // Each of these would otherwise leave a pending measurement that later
  // attaches itself to an unrelated navigation.
  assert.equal(navigationTarget({ ...plainClick, metaKey: true }, link("/learn"), ORIGIN, "/"), null);
  assert.equal(navigationTarget({ ...plainClick, ctrlKey: true }, link("/learn"), ORIGIN, "/"), null);
  assert.equal(navigationTarget({ ...plainClick, shiftKey: true }, link("/learn"), ORIGIN, "/"), null);
  assert.equal(navigationTarget({ ...plainClick, altKey: true }, link("/learn"), ORIGIN, "/"), null);
  assert.equal(navigationTarget({ ...plainClick, button: 1 }, link("/learn"), ORIGIN, "/"), null);
  assert.equal(
    navigationTarget({ ...plainClick, defaultPrevented: true }, link("/learn"), ORIGIN, "/"),
    null
  );
  assert.equal(
    navigationTarget(plainClick, link("/learn", { target: "_blank" }), ORIGIN, "/"),
    null
  );
  assert.equal(
    navigationTarget(plainClick, link("/export.csv", { hasDownload: true }), ORIGIN, "/"),
    null
  );
  assert.equal(navigationTarget(plainClick, null, ORIGIN, "/"), null);
});

test("a cross-origin link is not an in-app transition", () => {
  assert.equal(
    navigationTarget(plainClick, link("https://elsewhere.example/x"), ORIGIN, "/"),
    null
  );
});

test("a link to the current pathname starts nothing", () => {
  // The pathname never changes, so the end signal never fires — the pending
  // measurement would sit there and steal the next real navigation.
  assert.equal(navigationTarget(plainClick, link("/learn"), ORIGIN, "/learn"), null);
  assert.equal(navigationTarget(plainClick, link("/learn?tab=2"), ORIGIN, "/learn"), null);
  assert.equal(navigationTarget(plainClick, link("#section"), ORIGIN, "/learn"), null);
});

test("a completed transition reports the elapsed time and `rendered`", () => {
  beginNavigation("/learn", "/", 1000);
  const done = completeNavigation("/learn", 1240);
  assert.deepEqual(
    { route: done?.route, ms: done?.ms, outcome: done?.outcome },
    { route: "/learn", ms: 240, outcome: "rendered" }
  );
});

test("landing somewhere else is a redirect, never a success", () => {
  // `/` bounces a new account to `/placement`; scoring that as a fast
  // `/placement` render would hide the whole cost of the bounce.
  beginNavigation("/", "/login", 0);
  const done = completeNavigation("/placement", 500);
  assert.equal(done?.outcome, "redirected");
  assert.equal(done?.route, "/placement");
});

test("back/forward has no expected destination and is never a redirect", () => {
  beginNavigation(null, "/learn", 0);
  assert.equal(completeNavigation("/", 120)?.outcome, "rendered");
});

test("an expired transition reports nothing rather than a fabricated number", () => {
  beginNavigation("/play", "/", 0);
  assert.equal(completeNavigation("/play", MAX_PENDING_MS + 1), null);
});

test("a negative or non-finite interval is discarded", () => {
  beginNavigation("/play", "/", 500);
  assert.equal(completeNavigation("/play", 100), null);
  beginNavigation("/play", "/", 0);
  assert.equal(completeNavigation("/play", NaN), null);
});

test("completing with nothing pending is safe and silent", () => {
  assert.equal(completeNavigation("/learn", 100), null);
  assert.equal(completeNavigation("/learn", 100), null);
});

test("arriving back where we started closes nothing", () => {
  beginNavigation("/learn", "/", 0);
  assert.equal(completeNavigation("/", 50), null);
});

test("a second click replaces the first — the abandoned one is not reported", () => {
  beginNavigation("/learn", "/", 0);
  beginNavigation("/play", "/", 100);
  const done = completeNavigation("/play", 300);
  // 200ms from the SECOND click, not 300 from the first. Attributing the
  // arrival to the abandoned click would inflate every impatient navigation.
  assert.equal(done?.ms, 200);
});

test("each navigation gets its own trace", () => {
  beginNavigation("/learn", "/", 0);
  const first = __pendingForTest()?.trace;
  beginNavigation("/play", "/learn", 0);
  const second = __pendingForTest()?.trace;
  assert.ok(first && second);
  // A session-long trace would put twenty minutes of unrelated requests under
  // one key and make the join useless.
  assert.notEqual(first, second);
});

test("abandoning clears the pending measurement", () => {
  beginNavigation("/learn", "/", 0);
  assert.ok(__pendingForTest());
  abandonNavigation();
  assert.equal(__pendingForTest(), null);
  assert.equal(completeNavigation("/learn", 100), null);
});

test("a completed measurement does not close twice", () => {
  beginNavigation("/learn", "/", 0);
  assert.ok(completeNavigation("/learn", 100));
  assert.equal(completeNavigation("/learn", 200), null);
});
