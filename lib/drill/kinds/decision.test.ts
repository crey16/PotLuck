import test from "node:test";
import assert from "node:assert/strict";
import { generateDecision } from "./decision";
import { mulberry32 } from "../rng";
import { deadOuts, type Spot } from "../../poker/engine";
import { requiredEquity, evOfCall } from "../../poker/math";
import { signedMoney } from "../opts";
import { assertCommonShape, assertDeterministic } from "./assertions";

test("generateDecision: satisfies the common shape invariants", () => {
  assertCommonShape(generateDecision, "decision");
});

test("generateDecision: is deterministic for a fixed seed", () => {
  assertDeterministic(generateDecision);
});

test("decision: the answer is call exactly when equity >= required equity", () => {
  for (let seed = 1; seed <= 120; seed++) {
    for (const oppMode of ["unknown", "shown"] as const) {
      const q = generateDecision({ level: 2, oppMode, rng: mulberry32(seed) });
      const p = q.payload as { spot: Spot; pot: number; call: number };
      const req = requiredEquity(p.pot, p.call);
      assert.equal(q.answer, p.spot.equity >= req ? "call" : "fold");
    }
  }
});

test("decision: two options, exactly Call and Fold", () => {
  const q = generateDecision({ level: 1, oppMode: "unknown", rng: mulberry32(4) });
  assert.equal(q.layout, "two");
  assert.deepEqual(q.options.map((o) => o.value).sort(), ["call", "fold"]);
});

test("decision: the EV row agrees with evOfCall on the payload", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateDecision({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { spot: Spot; pot: number; call: number };
    const ev = evOfCall(p.spot.equity, p.pot, p.call);
    const row = q.explain(q.answer).rows.find((r) => /EV of calling/i.test(r.label));
    assert.ok(row);
    assert.equal(row!.value, signedMoney(ev));
  }
});

test("decision: pot is potBefore + bet and call equals the bet", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateDecision({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { potBefore: number; bet: number; pot: number; call: number };
    assert.equal(p.pot, p.potBefore + p.bet);
    assert.equal(p.call, p.bet);
  }
});

test("decision: most spots are close ones, so the drill is not trivially one-sided", () => {
  const answers = Array.from({ length: 200 }, (_, i) =>
    generateDecision({ level: 2, oppMode: "unknown", rng: mulberry32(i + 1) }).answer
  );
  const calls = answers.filter((a) => a === "call").length;
  assert.ok(calls > 40 && calls < 160, `lopsided: ${calls}/200 calls`);
});

test("decision: answers are near-balanced on both streets at every level", () => {
  // The walkthrough bug: turn spots with small draws could never be calls
  // (a 20%-pot minimum bet already prices out ≤6-out draws), so the drill
  // felt like "the answer is always fold". Guard the balance per street,
  // at the lowest level, where small draws are most common.
  for (const level of [1, 2, 3] as const) {
    const byStreet = { flop: { call: 0, fold: 0 }, turn: { call: 0, fold: 0 } };
    for (let seed = 1; seed <= 400; seed++) {
      const q = generateDecision({ level, oppMode: "unknown", rng: mulberry32(seed) });
      const street = q.chip === "Flop" ? "flop" : "turn";
      byStreet[street][q.answer as "call" | "fold"]++;
    }
    for (const street of ["flop", "turn"] as const) {
      const { call, fold } = byStreet[street];
      const rate = call / (call + fold);
      assert.ok(
        rate >= 0.35 && rate <= 0.65,
        `L${level} ${street}: ${call}/${call + fold} calls (${(rate * 100).toFixed(0)}%)`
      );
    }
  }
});

test("decision: face-up mode lists dead outs when there are any", () => {
  let found = 0;
  for (let seed = 1; seed <= 200 && found < 3; seed++) {
    const q = generateDecision({ level: 3, oppMode: "shown", rng: mulberry32(seed) });
    const p = q.payload as { spot: Spot };
    if (!deadOuts(p.spot.hero, p.spot.villain!, p.spot.board).length) continue;
    found++;
    assert.ok(q.explain(q.answer).notes.some((n) => /dead out/i.test((n.title ?? "") + n.text)));
  }
  assert.ok(found > 0, "no dead-out spot in 200 seeds — widen the search");
});
