import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  type HoldEvent,
  inputType,
  isRevealKey,
  nextRevealed,
  revealLabel,
} from "./holdReveal";

test("space and enter start a reveal", () => {
  assert.equal(isRevealKey(" "), true);
  assert.equal(isRevealKey("Spacebar"), true);
  assert.equal(isRevealKey("Enter"), true);
});

test("no other key starts a reveal", () => {
  for (const key of ["a", "Tab", "Escape", "Shift", "ArrowDown", "p", "0"]) {
    assert.equal(isRevealKey(key), false, `${key} must not reveal`);
  }
});

test("only a press reveals", () => {
  assert.equal(nextRevealed("press"), true);
});

test("every other event hides the password", () => {
  const enders: HoldEvent[] = ["release", "leave", "cancel", "blur", "hide"];
  for (const event of enders) {
    assert.equal(nextRevealed(event), false, `${event} must hide`);
  }
});

test("losing the control mid-hold hides it — the drag-off case", () => {
  // press, then the pointer slides off the button without a release event.
  assert.equal(nextRevealed("press"), true);
  assert.equal(nextRevealed("leave"), false);
});

test("the input type follows the reveal and never inverts", () => {
  assert.equal(inputType(true), "text");
  assert.equal(inputType(false), "password");
});

test("the accessible name never contains a password and never claims a toggle", () => {
  for (const revealed of [true, false]) {
    const label = revealLabel(revealed);
    assert.match(label, /password/i);
    assert.doesNotMatch(label, /toggle/i);
    assert.ok(label.length > 0);
  }
  assert.notEqual(revealLabel(true), revealLabel(false));
});
