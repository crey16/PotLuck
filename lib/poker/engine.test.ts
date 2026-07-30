/**
 * Run with:  npx tsx --test lib/poker/engine.test.ts
 * (or wire into vitest — the assertions are plain node:assert)
 *
 * These are the tests that caught real bugs during development. Keep them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCards, score5, bestHand, handName, equityVsHand, outsVsHand, drawOuts,
  deadOuts, describeDraw, coreDraw, DRAW_OUTS, dealDrawSpot, dealVsHandSpot,
  hitProbability, categoryOf, cardStr, isPlausibleHand, rankOf,
} from "./engine";
import {
  requiredEquity, evOfCall, breakEvenFoldRate, minDefenceFrequency,
  impliedOddsNeeded, hitByRiver, hitOnRiver, ruleOf4Corrected,
} from "./math";
import { SCENARIOS, cellFrequency, rangePercent, handAt, combosOf } from "./ranges";

const P = parseCards;
const s5 = (s: string) => { const c = P(s); return score5(c[0], c[1], c[2], c[3], c[4]); };

test("hand ranking order", () => {
  assert.ok(s5("9h 8h 7h 6h 5h") > s5("As Ah Ad Ac Kd"), "straight flush beats quads");
  assert.ok(s5("Ks Kh Kd 2c 2h") > s5("Ah Jh 9h 5h 3h"), "full house beats flush");
  assert.ok(s5("Ah 2s 3d 4c 5h") > s5("Kh Qs Jd 9c 7h"), "wheel beats king high");
  assert.ok(s5("Ah 2s 3d 4c 5h") < s5("6h 2s 3d 4c 5h"), "wheel is the lowest straight");
  assert.ok(s5("As Ah Ks Kh Qd") > s5("As Ah Ks Kh Jd"), "two pair kicker plays");
});

test("bestHand picks the best five from seven", () => {
  assert.equal(bestHand(P("Ah Kd 2h 5h 9h Jh 3c")), s5("Ah Jh 9h 5h 2h"));
});

test("handName reads correctly", () => {
  assert.equal(handName(P("As Ah Ks Kh Qd")), "two pair, Aces and Kings");
  assert.equal(handName(P("6s 6h 6d Kh Qd")), "three Sixes");
  assert.equal(handName(P("Ah Kd 9h 5s 3c")), "Ace high");
});

test("classic out counts against a known hand", () => {
  // flush draw + two overcards vs top pair
  assert.equal(outsVsHand(P("Ah Kh"), P("Qs Jd"), P("Qh 7h 2s")).clean.length, 15);
  assert.equal(outsVsHand(P("9s 8s"), P("Ad Ac"), P("7d 6c 2h")).clean.length, 8);  // OESD
  assert.equal(outsVsHand(P("Jh Th"), P("Qd Qc"), P("8d 7c 2s")).clean.length, 4);  // gutshot
  assert.equal(outsVsHand(P("Ad Ks"), P("Th Tc"), P("9h 6c 2s")).clean.length, 6);  // two overs
  assert.equal(outsVsHand(P("5s 5h"), P("Ah Qs"), P("Ad Kc 8h")).clean.length, 2);  // set outs
});

test("REGRESSION: a board-pairing card can kill a flush out", () => {
  // Hero KhQh has 9 hearts live on 6h 7c Ah 8c, but 7h and 8h pair the board and
  // give villain 8d7d a full house. Real answer is 7, not 9.
  const hero = P("Kh Qh"), villain = P("8d 7d"), board = P("6h 7c Ah 8c");
  const outs = outsVsHand(hero, villain, board);
  assert.equal(outs.clean.length, 7);
  const dead = deadOuts(hero, villain, board).map((d) => cardStr(d.card)).sort();
  assert.deepEqual(dead, ["7h", "8h"]);
});

test("REGRESSION: a hand that lives on the board alone is nobody's out", () => {
  // Board 7d Kd Qd 5d is four to a flush. A fifth diamond makes a board flush
  // that every player shares, so it is not an out for hero.
  const outs = drawOuts(P("As Js"), P("7d Kd Qd 5d"));
  assert.ok(outs.every((c) => cardStr(c)[1] !== "d"), "no diamond should count as an out");
  // Board 6s 4h 3c 5h: a 7 or a 2 completes a straight using only board cards.
  assert.equal(drawOuts(P("Qh Kh"), P("6s 4h 3c 5h")).length, 9, "only the 9 flush outs count");
});

test("REGRESSION: open-enders are not gutshots", () => {
  // JhTh on 9s 8d 2c is open-ended (Q or 7), which is 8 outs, not 4.
  assert.equal(coreDraw(describeDraw(P("Jh Th"), P("9s 8d 2c"))), "open-ended straight draw");
  assert.equal(drawOuts(P("Jh Th"), P("9s 8d 2c")).length, 8);
});

test("exact equities match the independently verified reference values", () => {
  const cases: Array<[string, string, string, number]> = [
    ["Ah Kh", "Qs Jd", "Qh 7h 2s", 0.534343],
    ["Ah Kh", "Qs Qd", "Qh 7h 2s", 0.255556],
    ["9s 8s", "Ad Ac", "7d 6c 2h", 0.342424],
    ["Jh Th", "Qd Qc", "8d 7c 2s", 0.186869],
    ["Ad Ks", "Th Tc", "9h 6c 2s", 0.239394],
    ["5s 5h", "Ah Qs", "Ad Kc 8h", 0.087879],
    ["Ah Kh", "Qs Jd", "Qh 7h 2s 3c", 0.340909],
  ];
  for (const [h, v, b, expected] of cases) {
    const got = equityVsHand(P(h), P(v), P(b)).equity;
    assert.ok(Math.abs(got - expected) < 1e-5, `${h} vs ${v} on ${b}: ${got} != ${expected}`);
  }
});

test("hit probabilities match the closed form", () => {
  for (let n = 1; n <= 15; n++) {
    assert.ok(Math.abs(hitProbability(n, "flop") - hitByRiver(n)) < 1e-12);
    assert.ok(Math.abs(hitProbability(n, "turn") - hitOnRiver(n)) < 1e-12);
  }
  assert.ok(Math.abs(hitByRiver(9) - 0.3497) < 0.001, "9 outs is ~35%");
  assert.ok(Math.abs(hitByRiver(15) - 0.5412) < 0.001, "15 outs is ~54%, not the 60% x4 claims");
  assert.equal(ruleOf4Corrected(15), 53);
});

test("betting math identities", () => {
  assert.equal(requiredEquity(150, 50), 0.25);              // half-pot bet
  assert.ok(Math.abs(requiredEquity(200, 100) - 1 / 3) < 1e-12); // pot-sized bet
  assert.ok(Math.abs(evOfCall(requiredEquity(150, 50), 150, 50)) < 1e-12, "break-even is 0 EV");
  assert.ok(Math.abs(breakEvenFoldRate(100, 50) - 1 / 3) < 1e-12);
  assert.equal(minDefenceFrequency(100, 100), 0.5);
  for (const e of [0.12, 0.2, 0.33])
    for (const [pot, call] of [[150, 50], [220, 110], [90, 60]]) {
      const x = impliedOddsNeeded(e, pot, call);
      assert.ok(Math.abs(e * (pot + x) - (1 - e) * call) < 1e-9, "implied odds make EV exactly 0");
    }
});

test("dealDrawSpot always produces an honest, label-consistent spot", () => {
  for (let i = 0; i < 400; i++) {
    const level = ((i % 3) + 1) as 1 | 2 | 3;
    const street = i % 2 ? "flop" : "turn";
    const sp = dealDrawSpot({ level, street });
    assert.equal(DRAW_OUTS[sp.draw], sp.outs, `${sp.draw} should have ${DRAW_OUTS[sp.draw]} outs, got ${sp.outs}`);
    assert.equal(sp.villain, undefined, "no villain in draw mode");
    assert.equal(drawOuts(sp.hero, sp.board).length, sp.outs);
    assert.equal(new Set(sp.board.map(rankOf)).size, sp.board.length, "board must be unpaired");
    assert.ok(Math.abs(sp.equity - hitProbability(sp.outs, sp.street)) < 1e-12);
    assert.equal(sp.unseen, street === "flop" ? 47 : 46);
  }
});

test("dealVsHandSpot always leaves hero behind and drawing", () => {
  for (let i = 0; i < 200; i++) {
    const sp = dealVsHandSpot({ level: ((i % 3) + 1) as 1 | 2 | 3, street: i % 2 ? "flop" : "turn" });
    assert.ok(sp.villain, "villain required");
    assert.ok(sp.outs >= 1, "must have outs");
    assert.ok(sp.equity > 0 && sp.equity < 0.85, `equity ${sp.equity} out of expected band`);
    assert.ok(isPlausibleHand(sp.hero) && isPlausibleHand(sp.villain!));
  }
});

test("preflop ranges are well formed and land at sane percentages", () => {
  const expected: Record<string, [number, number]> = {
    // [min, max] total combos played, as a percentage
    utg: [14, 20], hj: [19, 26], co: [26, 34], btn: [40, 50], sb: [35, 45],
    "bb-btn": [55, 68], "bb-utg": [18, 28], "btn-co": [24, 34],
  };
  for (const sc of SCENARIOS) {
    for (let i = 0; i < 13; i++)
      for (let j = 0; j < 13; j++) {
        const hand = handAt(i, j);
        const f = cellFrequency(sc, hand);
        assert.ok(Math.abs(f.r + f.c + f.f - 1) < 1e-9, `${sc.id} ${hand} frequencies must sum to 1`);
        assert.ok(f.r >= 0 && f.c >= 0 && f.f >= 0, `${sc.id} ${hand} negative frequency`);
      }
    for (const hand of ["AA", "KK", "AKs"])
      assert.ok(cellFrequency(sc, hand).r > 0.99, `${sc.id}: ${hand} must be a pure raise/3-bet`);
    for (const hand of ["72o", "82o", "93o"])
      assert.ok(cellFrequency(sc, hand).f > 0.99, `${sc.id}: ${hand} must be a pure fold`);

    const total = rangePercent(sc, "r") + rangePercent(sc, "c");
    const [lo, hi] = expected[sc.id];
    assert.ok(total >= lo && total <= hi, `${sc.id} plays ${total.toFixed(1)}%, expected ${lo}-${hi}%`);
  }
});

test("grid covers all 169 hands and 1326 combos", () => {
  const seen = new Set<string>();
  let combos = 0;
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const h = handAt(i, j);
    seen.add(h);
    combos += combosOf(h);
  }
  assert.equal(seen.size, 169);
  assert.equal(combos, 1326);
});
