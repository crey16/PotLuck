import test from "node:test";
import assert from "node:assert/strict";
import { generateConcepts, CONCEPTS } from "./concepts";
import { mulberry32 } from "../rng";
import { assertCommonShape, assertDeterministic } from "./assertions";
import { parseCards, outsVsHand, deadOuts, cardStr } from "../../poker/engine";

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

/**
 * The dead-outs item states a poker fact, so it is checked against the engine
 * rather than against itself. CLAUDE.md rule 2: never hand-code out counts.
 *
 * The earlier version of this item (hero J♥T♥ on Q♥9♥2♠ against A♥K♠, answer
 * "the K♥") was wrong in every direction — the spot has no dead outs, all four
 * listed options were real outs so no answer was correct, the K♥ is in fact a
 * king-high straight flush for the hero, and the stated reason (villain makes
 * Broadway) is impossible without a jack and a ten. It survived because nothing
 * tied the prose to the evaluator. This does.
 */
test("concepts: the dead-outs item agrees with the hand evaluator", () => {
  const item = CONCEPTS.find((c) => c.prompt.includes("NOT a real out"));
  assert.ok(item, "the dead-outs item should still exist");

  const hero = parseCards("Jh Th");
  const villain = parseCards("Ah Kh");
  const board = parseCards("Qh 9h 2s");
  // The spot the prompt describes, so a reworded prompt cannot drift from it.
  assert.match(item.prompt, /J♥T♥ on Q♥9♥2♠ against A♥K♥/);

  const real = new Set(outsVsHand(hero, villain, board).clean.map(cardStr));
  const named = (label: string) =>
    label.replace("The ", "").replace("♥", "h").replace("♠", "s")
      .replace("♦", "d").replace("♣", "c");

  const answer = named(item.options[item.correct]);
  assert.ok(!real.has(answer), `${answer} is graded "not an out" but the evaluator counts it`);
  assert.ok(
    deadOuts(hero, villain, board).some((d) => cardStr(d.card) === answer),
    `${answer} should be a genuine dead out`,
  );

  for (const [i, option] of item.options.entries()) {
    if (i === item.correct) continue;
    const card = named(option);
    assert.ok(real.has(card), `${card} is offered as a real out but the evaluator disagrees`);
  }
});
