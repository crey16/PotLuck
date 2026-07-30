import test from "node:test";
import assert from "node:assert/strict";
import { generatePreflop, MIX_THRESHOLD } from "./preflop";
import { mulberry32 } from "../rng";
import { RANKS } from "../../poker/engine";
import { SCENARIOS, getScenario, cellFrequency } from "../../poker/ranges";
import type { DrillLevel } from "../contract";
import { assertCommonShape, assertDeterministic } from "./assertions";

test("generatePreflop: satisfies the common shape invariants", () => {
  assertCommonShape(generatePreflop, "preflop");
});

test("generatePreflop: satisfies the common determinism invariant", () => {
  assertDeterministic(generatePreflop);
});

test("generatePreflop: same seed gives the same question, different seeds differ", () => {
  const a = generatePreflop({ level: 2, oppMode: "unknown", rng: mulberry32(21) });
  const b = generatePreflop({ level: 2, oppMode: "unknown", rng: mulberry32(21) });
  assert.deepEqual(a.payload, b.payload);
  const c = generatePreflop({ level: 2, oppMode: "unknown", rng: mulberry32(22) });
  assert.notDeepEqual(a.payload, c.payload);
});

test("generatePreflop: layout is two or grid3, matching the scenario's action count", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generatePreflop({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const sc = getScenario((q.payload as { scenarioId: string }).scenarioId)!;
    assert.equal(q.layout, sc.actions.length === 2 ? "two" : "grid3", `seed ${seed}: ${sc.id}`);
  }
});

test("preflop: the answer is the highest-frequency action for the dealt hand", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generatePreflop({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const { scenarioId, hand } = q.payload as { scenarioId: string; hand: string };
    const sc = getScenario(scenarioId)!;
    const f = cellFrequency(sc, hand);
    // Scenario.actions is Array<[Action, string]> — [key, label] tuples.
    const best = sc.actions.map(([key]) => key).sort((x, y) => f[y] - f[x])[0];
    assert.equal(q.answer, best, `seed ${seed}: ${hand} in ${scenarioId}`);
  }
});

test("preflop: acceptable holds every action at >= 20% frequency, excluding the answer", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generatePreflop({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const { scenarioId, hand } = q.payload as { scenarioId: string; hand: string };
    const sc = getScenario(scenarioId)!;
    const f = cellFrequency(sc, hand);
    const expected = sc.actions
      .map(([key]) => key)
      .filter((k) => f[k] >= MIX_THRESHOLD && k !== q.answer)
      .sort();
    assert.deepEqual([...(q.acceptable ?? [])].sort(), expected, `seed ${seed}: ${hand}`);
  }
});

test("preflop: a pure hand has no acceptable alternatives", () => {
  // AA from UTG is a pure raise in every reference scenario that opens
  let checked = 0;
  for (let seed = 1; seed <= 500 && checked < 5; seed++) {
    const q = generatePreflop({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const { hand } = q.payload as { hand: string };
    if (hand !== "AA") continue;
    checked++;
    assert.deepEqual(q.acceptable ?? [], []);
  }
  assert.ok(checked > 0, "AA never dealt in 500 seeds — widen the search");
});

test("preflop: the displayed cards match the named hand", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generatePreflop({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const { hand, cards } = q.payload as { hand: string; cards: number[] };
    assert.equal(cards.length, 2);
    const ranks = cards.map((c) => RANKS[c >> 2]);
    const suited = (cards[0] & 3) === (cards[1] & 3);
    if (hand.length === 2) {
      assert.equal(ranks[0], ranks[1], `${hand} must be a pair`);
      assert.ok(!suited, "a pair cannot be suited");
    } else {
      assert.equal(suited, hand.endsWith("s"), `${hand} suitedness`);
      assert.deepEqual([...ranks].sort(), [hand[0], hand[1]].sort());
    }
  }
});

test("preflop: level 1 only uses the five opening scenarios", () => {
  const opens = SCENARIOS.slice(0, 5).map((s) => s.id);
  for (let seed = 1; seed <= 120; seed++) {
    const q = generatePreflop({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    assert.ok(opens.includes((q.payload as { scenarioId: string }).scenarioId));
  }
});

test("preflop: levels 2+ reach the defence scenarios too", () => {
  const ids = new Set(
    Array.from({ length: 200 }, (_, i) =>
      (generatePreflop({ level: 3, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { scenarioId: string }).scenarioId
    )
  );
  assert.ok(ids.size > 5, "level 3 should reach beyond the opening scenarios");
});

test("preflop: higher levels weight toward hands that are actually decisions", () => {
  const pureFoldRate = (level: DrillLevel) => {
    let folds = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const q = generatePreflop({ level, oppMode: "unknown", rng: mulberry32(seed) });
      const { scenarioId, hand } = q.payload as { scenarioId: string; hand: string };
      if (cellFrequency(getScenario(scenarioId)!, hand).f >= 0.999) folds++;
    }
    return folds / 300;
  };
  assert.ok(pureFoldRate(3) < pureFoldRate(1), "level 3 should deal fewer trivial pure folds");
});

test("preflop: the explanation shows every action's frequency and labels the ranges as reference ranges", () => {
  const q = generatePreflop({ level: 2, oppMode: "unknown", rng: mulberry32(3) });
  const ex = q.explain(q.answer);
  const sc = getScenario((q.payload as { scenarioId: string }).scenarioId)!;
  for (const [, label] of sc.actions) {
    assert.ok(ex.rows.some((r) => r.label === label), `missing row for ${label}`);
  }
  assert.ok(ex.rows.some((r) => r.label === "Hand"));
  assert.ok(ex.blocks?.some((b) => b.type === "grid"));
  assert.ok(
    ex.notes.some((n) => /reference range/i.test(n.text)),
    "the ranges must be labelled as reference ranges, not solver output"
  );
});

test("preflop: payload is JSON-clean and re-grades to the same answer", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const q = generatePreflop({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = JSON.parse(JSON.stringify(q.payload)) as { scenarioId: string; hand: string };
    const f = cellFrequency(getScenario(p.scenarioId)!, p.hand);
    const sc = getScenario(p.scenarioId)!;
    const best = sc.actions.map(([key]) => key).sort((x, y) => f[y] - f[x])[0];
    assert.equal(best, q.answer);
  }
});
