import test from "node:test";
import assert from "node:assert/strict";
import { bb, bbLoss, chipsToBb, signedBb } from "./units";

test("chipsToBb: chips are tenths of a big blind", () => {
  assert.equal(chipsToBb(25), 2.5);
  assert.equal(chipsToBb(10), 1);
  assert.equal(chipsToBb(0), 0);
});

test("bb: whole numbers print without a decimal", () => {
  assert.equal(bb(10), "1bb");
  assert.equal(bb(1000), "100bb");
});

test("bb: fractions print to one decimal", () => {
  assert.equal(bb(25), "2.5bb");
  assert.equal(bb(55), "5.5bb");
});

test("bb: rounds to one decimal rather than printing noise", () => {
  assert.equal(bb(27), "2.7bb");
  assert.equal(bb(1), "0.1bb");
});

test("signedBb: uses a true minus sign, like the drills", () => {
  assert.equal(signedBb(25), "+2.5bb");
  assert.equal(signedBb(-25), "−2.5bb");
  assert.equal(signedBb(0), "+0bb");
});

test("bbLoss: converts exported EV-loss steps (0.05bb each)", () => {
  assert.equal(bbLoss(0), "0bb");
  assert.equal(bbLoss(2), "0.1bb");
  assert.equal(bbLoss(15), "0.75bb");
});

test("bbLoss: keeps the half-tenth precision EV losses actually have", () => {
  // 0.75bb is the blunder threshold in verdict.ts. Rounding it to "0.8bb"
  // would make the number contradict the verdict printed beside it.
  assert.equal(bbLoss(15), "0.75bb");
  assert.equal(bbLoss(11), "0.55bb");
  assert.equal(bbLoss(1), "0.05bb");
});

test("bb: never prints a trailing zero decimal", () => {
  for (const chips of [0, 10, 20, 100, 1000]) {
    assert.ok(!bb(chips).includes(".0"), `${chips} → ${bb(chips)}`);
  }
});
