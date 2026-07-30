import test from "node:test";
import assert from "node:assert/strict";
import { generateRule24 } from "./rule24";
import { mulberry32 } from "../rng";
import { hitByRiver, hitOnRiver, ruleOf2And4, ruleOf4Corrected } from "../../poker/math";
import { pct } from "../opts";
import type { Spot } from "../../poker/engine";
import { assertCommonShape, assertDeterministic } from "./assertions";

test("generateRule24: satisfies the common shape invariants", () => {
  assertCommonShape(generateRule24, "rule24");
});

test("generateRule24: satisfies the common determinism invariant", () => {
  assertDeterministic(generateRule24);
});

test("rule24: the answer is exactly the uncorrected rule — outs×4 on the flop, outs×2 on the turn", () => {
  for (let seed = 1; seed <= 80; seed++) {
    const q = generateRule24({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const { spot, street } = q.payload as { spot: Spot; street: "flop" | "turn" };
    assert.equal(q.answer, ruleOf2And4(spot.outs, street === "flop" ? 2 : 1));
  }
});

test("rule24: the explanation's true chance comes from the engine, not the rule", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const q = generateRule24({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const { spot, street } = q.payload as { spot: Spot; street: "flop" | "turn" };
    const truth = street === "flop" ? hitByRiver(spot.outs) : hitOnRiver(spot.outs);
    const row = q.explain(q.answer).rows.find((r) => /true chance/i.test(r.label));
    assert.ok(row);
    assert.equal(row!.value, pct(truth));
  }
});

test("rule24: above 8 outs on the flop, the correction is shown with ruleOf4Corrected", () => {
  let checked = 0;
  for (let seed = 1; seed <= 400 && checked < 5; seed++) {
    const q = generateRule24({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const { spot, street } = q.payload as { spot: Spot; street: "flop" | "turn" };
    if (street !== "flop" || spot.outs <= 8) continue;
    checked++;
    const note = q.explain(q.answer).notes.find((n) => /drifts high/i.test(n.text));
    assert.ok(note, `seed ${seed}: no correction note for ${spot.outs} outs`);
    assert.ok(note!.text.includes(String(ruleOf4Corrected(spot.outs))));
  }
  assert.ok(checked > 0, "no >8-out flop spot was generated in 400 seeds — widen the search");
});

test("rule24: options are whole percentages in 1..100", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateRule24({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    for (const o of q.options) {
      const v = o.value as number;
      assert.ok(v > 0 && v <= 100, `bad option ${v}`);
    }
  }
});

test("generateRule24: layout is grid3 and the felt is always present", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const q = generateRule24({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    assert.equal(q.layout, "grid3");
    assert.ok(q.body.some((b) => b.type === "felt"));
  }
});

test("generateRule24: chip names the cards to come per street", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const q = generateRule24({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const { street } = q.payload as { street: "flop" | "turn" };
    assert.equal(q.chip, street === "flop" ? "Two cards to come" : "One card to come");
  }
});

test("generateRule24: payload carries level, oppMode, street and spot, and survives JSON", () => {
  const q = generateRule24({ level: 3, oppMode: "shown", rng: mulberry32(9) });
  assert.equal(q.payload.level, 3);
  assert.equal(q.payload.oppMode, "shown");
  assert.ok("street" in q.payload);
  assert.ok("spot" in q.payload);
  const round = JSON.parse(JSON.stringify(q.payload));
  assert.deepEqual(round, q.payload);
});
