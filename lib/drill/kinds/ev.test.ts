import test from "node:test";
import assert from "node:assert/strict";
import { generateEv } from "./ev";
import { mulberry32 } from "../rng";
import { evOfCall, requiredEquity } from "../../poker/math";
import { pct } from "../opts";
import { assertCommonShape, assertDeterministic } from "./assertions";

test("generateEv: satisfies the common shape invariants", () => {
  assertCommonShape(generateEv, "ev");
});

test("generateEv: satisfies the common determinism invariant", () => {
  assertDeterministic(generateEv);
});

test("ev: call mode's answer is evOfCall to one decimal", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 40; seed++) {
    const q = generateEv({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; equity: number; pot: number; call: number };
    if (p.mode !== "call") continue;
    checked++;
    assert.equal(q.answer, +evOfCall(p.equity, p.pot, p.call).toFixed(1));
  }
  assert.ok(checked > 0);
});

test("ev: shove mode's answer is the two-branch fold-equity EV to one decimal", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 40; seed++) {
    const q = generateEv({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as {
      mode: string; potBefore: number; bet: number; foldRate: number; equityWhenCalled: number;
    };
    if (p.mode !== "shove") continue;
    checked++;
    const called =
      p.equityWhenCalled * (p.potBefore + p.bet) - (1 - p.equityWhenCalled) * p.bet;
    const ev = p.foldRate * p.potBefore + (1 - p.foldRate) * called;
    assert.equal(q.answer, +ev.toFixed(1));
  }
  assert.ok(checked > 0);
});

test("ev: option labels carry an explicit sign", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateEv({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    for (const o of q.options) assert.match(o.label, /^[+−]\$/);
  }
});

test("ev: the answer appears once even when a distractor equals its negation", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generateEv({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    assert.equal(q.options.filter((o) => o.value === q.answer).length, 1, `seed ${seed}`);
  }
});

test("ev: call mode shows the break-even equity from requiredEquity", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 10; seed++) {
    const q = generateEv({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; pot: number; call: number };
    if (p.mode !== "call") continue;
    checked++;
    const row = q.explain(q.answer).rows.find((r) => /break-even equity/i.test(r.label));
    assert.ok(row);
    assert.equal(row!.value, pct(requiredEquity(p.pot, p.call)));
  }
  assert.ok(checked > 0);
});

test("ev: both modes appear across seeds", () => {
  const modes = new Set(
    Array.from({ length: 80 }, (_, i) =>
      (generateEv({ level: 2, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { mode: string }).mode
    )
  );
  assert.deepEqual([...modes].sort(), ["call", "shove"]);
});
