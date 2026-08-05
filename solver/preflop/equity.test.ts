import assert from "node:assert/strict";
import { test } from "node:test";

import { classes, combosOf, equityOfPair } from "./equity";

test("there are exactly 169 hand classes", () => {
  assert.equal(classes().length, 169);
});

test("combo counts per class are 6 / 4 / 12", () => {
  assert.equal(combosOf("AA").length, 6);
  assert.equal(combosOf("AKs").length, 4);
  assert.equal(combosOf("AKo").length, 12);
  // 13*6 + 78*4 + 78*12 = 78 + 312 + 936 = 1326
  const total = classes().reduce((n, c) => n + combosOf(c).length, 0);
  assert.equal(total, 1326);
});

test("no combo repeats a card", () => {
  for (const c of classes()) {
    for (const [a, b] of combosOf(c)) assert.notEqual(a, b, `${c} has a duplicate card`);
  }
});

test("a hand is a coin flip against itself", () => {
  // AA vs AA must be 50% by symmetry. This is the check that catches a
  // win/tie accounting error: counting a chop as a win gives ~1.0 here.
  const e = equityOfPair("AA", "AA", 400, 1);
  assert.ok(e !== null && Math.abs(e - 0.5) < 0.02, `AA vs AA = ${e}, expected ~0.5`);
});

test("equity is symmetric: e(a,b) + e(b,a) = 1", () => {
  for (const [x, y] of [["AA", "72o"], ["KQs", "T9s"], ["JJ", "AKo"]] as const) {
    const a = equityOfPair(x, y, 1500, 7)!;
    const b = equityOfPair(y, x, 1500, 7)!;
    assert.ok(Math.abs(a + b - 1) < 0.05, `${x}/${y}: ${a} + ${b} != 1`);
  }
});

test("the classic matchups land where poker says they do", () => {
  // These are textbook numbers. If the evaluator or the board sampling were
  // wrong, they would not all be right at once.
  const cases: [string, string, number][] = [
    ["AA", "KK", 0.82],   // pair over pair
    ["AA", "72o", 0.87],  // best vs worst
    ["AKo", "QQ", 0.43],  // the classic race, underdog
    ["AKs", "QQ", 0.46],  // suited helps a couple of points
  ];
  for (const [x, y, want] of cases) {
    const got = equityOfPair(x, y, 3000, 11)!;
    assert.ok(
      Math.abs(got - want) < 0.035,
      `${x} vs ${y}: got ${(100 * got).toFixed(1)}%, expected ~${(100 * want).toFixed(0)}%`,
    );
  }
});

test("suited beats its offsuit twin", () => {
  const s = equityOfPair("AKs", "QQ", 3000, 3)!;
  const o = equityOfPair("AKo", "QQ", 3000, 3)!;
  assert.ok(s > o, `AKs (${s}) should beat AKo (${o}) against QQ`);
});

test("the table is reproducible from its seed", () => {
  assert.equal(equityOfPair("JTs", "88", 800, 42), equityOfPair("JTs", "88", 800, 42));
});
