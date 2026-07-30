import test from "node:test";
import assert from "node:assert/strict";
import { generatePotodds } from "./potodds";
import { mulberry32 } from "../rng";
import { requiredEquity } from "../../poker/math";
import type { DrillLevel } from "../contract";
import { assertCommonShape, assertDeterministic } from "./assertions";

test("generatePotodds: satisfies the common shape invariants", () => {
  assertCommonShape(generatePotodds, "potodds");
});

test("generatePotodds: satisfies the common determinism invariant", () => {
  assertDeterministic(generatePotodds);
});

test("generatePotodds: same seed gives the same question, different seeds differ", () => {
  const a = generatePotodds({ level: 2, oppMode: "unknown", rng: mulberry32(21) });
  const b = generatePotodds({ level: 2, oppMode: "unknown", rng: mulberry32(21) });
  assert.deepEqual(a.payload, b.payload);
  const c = generatePotodds({ level: 2, oppMode: "unknown", rng: mulberry32(22) });
  assert.notDeepEqual(a.payload, c.payload);
});

test("generatePotodds: layout is grid3", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const q = generatePotodds({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    assert.equal(q.layout, "grid3");
  }
});

test("potodds: the answer is requiredEquity(pot, call) to one decimal", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const q = generatePotodds({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const { pot, call } = q.payload as { pot: number; call: number };
    assert.equal(q.answer, +(requiredEquity(pot, call) * 100).toFixed(1));
  }
});

test("potodds: pot is the total AFTER the bet and call is what it costs more", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const q = generatePotodds({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { potBefore: number; bet: number; extra: number; pot: number; call: number };
    assert.equal(p.pot, p.potBefore + p.bet + p.extra);
    assert.equal(p.call, p.bet - p.extra);
    assert.ok(p.call > 0, `seed ${seed}: call must be positive`);
    assert.ok(p.pot > p.call, `seed ${seed}: pot must exceed the call`);
  }
});

test("potodds: raise spots improve the price versus treating your own bet as a cost", () => {
  // The OMC leak the drill teaches: your already-committed money is not a cost.
  for (let seed = 1; seed <= 200; seed++) {
    const q = generatePotodds({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { extra: number; pot: number; call: number };
    if (p.extra === 0) continue;
    const wrong = +(requiredEquity(p.pot, p.call + p.extra) * 100).toFixed(1);
    assert.ok((q.answer as number) < wrong);
  }
});

test("potodds: levels 1 and 2 never produce a raise spot; level 3 sometimes does", () => {
  for (const level of [1, 2] as DrillLevel[]) {
    for (let seed = 1; seed <= 60; seed++) {
      const q = generatePotodds({ level, oppMode: "unknown", rng: mulberry32(seed) });
      assert.equal((q.payload as { extra: number }).extra, 0);
    }
  }
  const anyRaise = Array.from({ length: 60 }, (_, i) =>
    generatePotodds({ level: 3, oppMode: "unknown", rng: mulberry32(i + 1) })
  ).some((q) => (q.payload as { extra: number }).extra > 0);
  assert.ok(anyRaise, "level 3 must sometimes deal a raise spot");
});

test("potodds: every option is a plausible percentage, distinct by at least 1.2 points", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const q = generatePotodds({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const values = q.options.map((o) => o.value as number);
    for (const v of values) assert.ok(v > 0 && v < 100);
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        assert.ok(Math.abs(values[i] - values[j]) >= 1.2);
      }
    }
  }
});

test("generatePotodds: chip reflects raise vs plain bet, sub mentions the extra when raised", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generatePotodds({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { extra: number };
    if (p.extra > 0) {
      assert.equal(q.chip, "Facing a raise");
      assert.ok(q.explain(q.answer).notes.some((n) => n.tone === "warn"));
    } else {
      assert.equal(q.chip, "Facing a bet");
    }
  }
});

test("generatePotodds: body carries the four money pills", () => {
  const q = generatePotodds({ level: 2, oppMode: "unknown", rng: mulberry32(3) });
  const money = q.body.find((b) => b.type === "money") as { items: { label: string; value: string }[] };
  assert.ok(money);
  assert.equal(money.items.length, 4);
  const labels = money.items.map((i) => i.label);
  assert.deepEqual(labels, ["Pot before bet", "Villain bets", "Pot now", "To call"]);
});
