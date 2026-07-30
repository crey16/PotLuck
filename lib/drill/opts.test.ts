import test from "node:test";
import assert from "node:assert/strict";
import {
  withArticle, buildOpts, intOptsInRange, money, pct, signedMoney,
  roundTo, pick, shuffled,
} from "./opts.js";
import { mulberry32 } from "./rng.js";

test("withArticle: consonant-leading label gets 'a'", () => {
  assert.equal(withArticle("gutshot"), "a gutshot");
});

test("withArticle: vowel-leading label gets 'an'", () => {
  assert.equal(withArticle("open-ended straight draw"), "an open-ended straight draw");
});

test("withArticle: combo draw label starts with 'flush', so 'a'", () => {
  assert.equal(withArticle("flush draw + gutshot"), "a flush draw + gutshot");
});

test("money: rounds to whole dollars with a thousands separator", () => {
  assert.equal(money(60), "$60");
  assert.equal(money(1234.6), "$1,235");
});

test("pct: one decimal place", () => {
  assert.equal(pct(0.3497), "35.0%");
  assert.equal(pct(0.1739), "17.4%");
});

test("signedMoney: explicit sign, minus sign is U+2212", () => {
  assert.equal(signedMoney(12.4), "+$12");
  assert.equal(signedMoney(-12.4), "−$12");
  assert.equal(signedMoney(0), "+$0");
});

test("roundTo: rounds to the nearest step", () => {
  assert.equal(roundTo(37, 5), 35);
  assert.equal(roundTo(38, 5), 40);
  assert.equal(roundTo(37.4, 1), 37);
});

test("pick / shuffled: deterministic under a seeded rng and non-mutating", () => {
  const source = [1, 2, 3, 4, 5];
  const a = shuffled(source, mulberry32(7));
  const b = shuffled(source, mulberry32(7));
  assert.deepEqual(a, b);
  assert.deepEqual(source, [1, 2, 3, 4, 5]);
  assert.deepEqual([...a].sort(), [...source].sort());
  assert.equal(pick(source, mulberry32(7)), pick(source, mulberry32(7)));
});

test("buildOpts: always returns exactly n options containing the answer once", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = mulberry32(seed);
    const answer = 25.4;
    const opts = buildOpts(answer, [12.1, 30.2, 44.9, 25.4, 26.0], 4, 1.2, rng);
    assert.equal(opts.length, 4);
    assert.equal(opts.filter((v) => v === answer).length, 1, `seed ${seed}`);
  }
});

test("buildOpts: no two options are within minGap of each other", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const opts = buildOpts(25.4, [25.9, 26.0, 40, 55], 4, 1.2, mulberry32(seed));
    for (let i = 0; i < opts.length; i++) {
      for (let j = i + 1; j < opts.length; j++) {
        assert.ok(Math.abs(opts[i] - opts[j]) >= 1.2, `seed ${seed}: ${opts[i]} vs ${opts[j]}`);
      }
    }
  }
});

test("buildOpts: pads up to n when candidates are too few or too close", () => {
  // every candidate collides with the answer, so all three fillers must be generated
  const opts = buildOpts(20, [20.1, 20.2, 20.3], 4, 1.2, mulberry32(3));
  assert.equal(opts.length, 4);
  assert.ok(opts.includes(20));
  assert.equal(new Set(opts).size, 4);
});

test("buildOpts: never returns a non-finite value", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const opts = buildOpts(0.1, [Infinity, NaN, -Infinity], 4, 0.05, mulberry32(seed));
    assert.equal(opts.length, 4);
    for (const v of opts) assert.ok(Number.isFinite(v), `seed ${seed}: ${v}`);
  }
});

test("intOptsInRange: 4 distinct integers in range, answer included", () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const answer of [1, 4, 9, 12, 15, 20]) {
      const cands = [answer - 1, answer + 1, answer - 2, answer + 2, answer + 3];
      const opts = intOptsInRange(answer, cands, 4, 1, 20, mulberry32(seed));
      assert.equal(opts.length, 4, `seed ${seed} answer ${answer}`);
      assert.equal(new Set(opts).size, 4);
      assert.ok(opts.includes(answer));
      for (const v of opts) {
        assert.ok(Number.isInteger(v) && v >= 1 && v <= 20, `bad option ${v}`);
      }
    }
  }
});

test("intOptsInRange: pads inside the range even when every candidate is invalid", () => {
  // the deferred M1 finding: answer at the very bottom with unusable candidates
  const opts = intOptsInRange(1, [0, -1, -5, 1], 4, 1, 20, mulberry32(11));
  assert.equal(opts.length, 4);
  assert.equal(new Set(opts).size, 4);
  assert.ok(opts.includes(1));
  for (const v of opts) assert.ok(v >= 1 && v <= 20);
});

test("intOptsInRange: pads inside the range at the top edge too", () => {
  const opts = intOptsInRange(20, [21, 22, 25], 4, 1, 20, mulberry32(12));
  assert.equal(opts.length, 4);
  assert.equal(new Set(opts).size, 4);
  assert.ok(opts.includes(20));
  for (const v of opts) assert.ok(v >= 1 && v <= 20);
});
