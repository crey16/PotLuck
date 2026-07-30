import test from "node:test";
import assert from "node:assert/strict";
import { generateBluff } from "./bluff";
import { mulberry32 } from "../rng";
import { breakEvenFoldRate, minDefenceFrequency, bluffSizeForFoldRate } from "../../poker/math";
import { assertCommonShape, assertDeterministic } from "./assertions";

test("generateBluff: satisfies the common shape invariants", () => {
  assertCommonShape(generateBluff, "bluff");
});

test("generateBluff: satisfies the common determinism invariant", () => {
  assertDeterministic(generateBluff);
});

test("bluff: break-even mode's answer is breakEvenFoldRate(potBefore, bet)", () => {
  let checked = 0;
  for (let seed = 1; seed <= 300 && checked < 40; seed++) {
    const q = generateBluff({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; potBefore: number; bet: number };
    if (p.mode !== "be") continue;
    checked++;
    assert.equal(q.answer, +(breakEvenFoldRate(p.potBefore, p.bet) * 100).toFixed(1));
  }
  assert.ok(checked > 0);
});

test("bluff: MDF mode's answer is minDefenceFrequency(potBefore, bet)", () => {
  let checked = 0;
  for (let seed = 1; seed <= 300 && checked < 25; seed++) {
    const q = generateBluff({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; potBefore: number; bet: number };
    if (p.mode !== "mdf") continue;
    checked++;
    assert.equal(q.answer, +(minDefenceFrequency(p.potBefore, p.bet) * 100).toFixed(1));
  }
  assert.ok(checked > 0);
});

test("bluff: MDF and break-even are complements at the same price", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const q = generateBluff({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; potBefore: number; bet: number };
    if (p.mode === "size") continue;
    const be = breakEvenFoldRate(p.potBefore, p.bet);
    const mdf = minDefenceFrequency(p.potBefore, p.bet);
    assert.ok(Math.abs(be + mdf - 1) < 1e-9, `seed ${seed}: ${be} + ${mdf}`);
  }
});

test("bluff: size mode's answer is the pot percentage that needs exactly the stated fold rate", () => {
  let checked = 0;
  for (let seed = 1; seed <= 300 && checked < 25; seed++) {
    const q = generateBluff({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; foldRate: number };
    if (p.mode !== "size") continue;
    checked++;
    assert.equal(q.answer, Math.round(bluffSizeForFoldRate(p.foldRate) * 100));
    // and the round trip holds: a bet of that size needs that many folds
    const asFraction = (q.answer as number) / 100;
    assert.ok(Math.abs(breakEvenFoldRate(1, asFraction) - p.foldRate) < 0.01);
  }
  assert.ok(checked > 0);
});

test("bluff: all three modes appear, with break-even the most common", () => {
  const modes = Array.from({ length: 400 }, (_, i) =>
    (generateBluff({ level: 2, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { mode: string }).mode
  );
  for (const m of ["be", "mdf", "size"]) assert.ok(modes.includes(m), `missing mode ${m}`);
  const be = modes.filter((m) => m === "be").length;
  assert.ok(be > modes.filter((m) => m === "mdf").length, "break-even should be weighted 2x");
});

test("generateBluff: layout is always grid3 with 4 options", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const q = generateBluff({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    assert.equal(q.layout, "grid3");
    assert.equal(q.options.length, 4);
  }
});

test("generateBluff: body is a money pill block, no felt", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const q = generateBluff({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    assert.ok(q.body.every((b) => b.type === "money"));
  }
});
