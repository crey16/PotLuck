import test from "node:test";
import assert from "node:assert/strict";
import { generateImplied, CONCEPT_BANK } from "./implied";
import { mulberry32 } from "../rng";
import { roundTo } from "../opts";
import { impliedOddsNeeded, requiredEquity } from "../../poker/math";
import type { Spot } from "../../poker/engine";
import { assertCommonShape, assertDeterministic } from "./assertions";

test("generateImplied: satisfies the common shape invariants", () => {
  assertCommonShape(generateImplied, "implied");
});

test("generateImplied: satisfies the common determinism invariant", () => {
  assertDeterministic(generateImplied);
});

test("implied: math mode's answer is impliedOddsNeeded rounded to the nearest 5", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 40; seed++) {
    const q = generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; spot?: Spot; pot?: number; call?: number };
    if (p.mode !== "math") continue;
    checked++;
    const need = impliedOddsNeeded(p.spot!.equity, p.pot!, p.call!);
    assert.equal(q.answer, Math.max(5, roundTo(need, 5)));
  }
  assert.ok(checked > 0);
});

test("implied: math mode only ever asks when the direct call is losing", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generateImplied({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; spot?: Spot; pot?: number; call?: number };
    if (p.mode !== "math") continue;
    // a positive implied requirement is what makes the question meaningful
    assert.ok(impliedOddsNeeded(p.spot!.equity, p.pot!, p.call!) > 0, `seed ${seed}`);
    assert.ok(p.spot!.equity < requiredEquity(p.pot!, p.call!), `seed ${seed}`);
  }
});

test("implied: math mode is always a turn spot — one card to come", () => {
  for (let seed = 1; seed <= 120; seed++) {
    const q = generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; spot?: Spot };
    if (p.mode === "math") assert.equal(p.spot!.street, "turn");
  }
});

test("implied: concept mode has 4 options, the single-column layout, and an id in the payload", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 6; seed++) {
    const q = generateImplied({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; conceptId?: number };
    if (p.mode !== "concept") continue;
    checked++;
    assert.equal(q.layout, "one");
    assert.equal(q.options.length, 4);
    assert.equal(typeof p.conceptId, "number");
    assert.equal(q.body.length, 0);
  }
  assert.ok(checked > 0);
});

test("implied: concept answers survive shuffling — the answer value indexes the right option", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generateImplied({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; conceptId?: number };
    if (p.mode !== "concept") continue;
    const correct = q.options.find((o) => o.value === q.answer);
    assert.ok(correct, `seed ${seed}: answer not among options`);
    assert.equal(CONCEPT_BANK[p.conceptId!].options[0], correct!.label);
  }
});

test("implied: both modes appear across seeds", () => {
  const modes = new Set(
    Array.from({ length: 80 }, (_, i) =>
      (generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { mode: string }).mode
    )
  );
  assert.deepEqual([...modes].sort(), ["concept", "math"]);
});
