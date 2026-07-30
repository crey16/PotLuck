import test from "node:test";
import assert from "node:assert/strict";
import { generateConcepts, CONCEPTS } from "./concepts";
import { mulberry32 } from "../rng";
import { assertCommonShape, assertDeterministic } from "./assertions";

test("generateConcepts: satisfies the common shape invariants", () => {
  assertCommonShape(generateConcepts, "concepts");
});

test("generateConcepts: is deterministic for a given seed", () => {
  assertDeterministic(generateConcepts);
});

test("concepts: the bank is fully populated and internally consistent", () => {
  // NB: the reference bank (poker-math-trainer.html lines 925-971) contains
  // 15 items, not the 16 the task brief described. Verified by counting
  // "{q:" occurrences in that range. Ported verbatim as 15.
  assert.equal(CONCEPTS.length, 15);
  for (const [i, item] of CONCEPTS.entries()) {
    assert.ok(item.prompt.length > 10, `item ${i}: prompt`);
    assert.equal(item.options.length, 4, `item ${i}: four options`);
    assert.equal(new Set(item.options).size, 4, `item ${i}: distinct options`);
    assert.ok(item.correct >= 0 && item.correct < 4, `item ${i}: correct index in range`);
    assert.ok(item.explain.length > 20, `item ${i}: explanation`);
  }
});

test("concepts: the item whose correct answer is not the first option is preserved", () => {
  // reference line 954: a:2 — the $120/$40 call-or-fold item
  const item = CONCEPTS.find((c) => /Pot is \$120 after villain bets \$40/.test(c.prompt));
  assert.ok(item, "the $120/$40 item must exist");
  assert.equal(item!.correct, 2);
});

test("concepts: the graded answer always points at the item's correct option text", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const q = generateConcepts({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const item = CONCEPTS[(q.payload as { conceptId: number }).conceptId];
    const chosen = q.options.find((o) => o.value === q.answer);
    assert.ok(chosen, `seed ${seed}: answer not among options`);
    assert.equal(chosen!.label, item.options[item.correct], `seed ${seed}`);
  }
});

test("concepts: options are shuffled, not always in bank order", () => {
  const firsts = new Set(
    Array.from({ length: 60 }, (_, i) => {
      const q = generateConcepts({ level: 1, oppMode: "unknown", rng: mulberry32(i + 1) });
      const id = (q.payload as { conceptId: number }).conceptId;
      return `${id}:${q.options[0].label}`;
    })
  );
  assert.ok(firsts.size > 20, "options do not appear to be shuffled");
});

test("concepts: single-column layout, no board, and an explanation note", () => {
  const q = generateConcepts({ level: 2, oppMode: "unknown", rng: mulberry32(5) });
  assert.equal(q.layout, "one");
  assert.deepEqual(q.body, []);
  assert.ok(q.explain(q.answer).notes.length >= 1);
});

test("concepts: the whole bank is reachable", () => {
  const seen = new Set(
    Array.from({ length: 800 }, (_, i) =>
      (generateConcepts({ level: 1, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { conceptId: number }).conceptId
    )
  );
  assert.equal(seen.size, CONCEPTS.length);
});
