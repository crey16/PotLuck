import test from "node:test";
import assert from "node:assert/strict";
import { generateImplied } from "./implied";
import { IMPLIED_CONCEPT_TEMPLATES, flushDrawQuality } from "./impliedTemplates";
import { mulberry32 } from "../rng";
import { roundTo } from "../opts";
import { impliedOddsNeeded, requiredEquity } from "../../poker/math";
import type { Spot } from "../../poker/engine";
import { assertCommonShape, assertDeterministic } from "./assertions";

test("generateImplied: satisfies the common shape invariants", () => {
  assertCommonShape(generateImplied, "implied");
});

test("generateImplied: satisfies the common determinism invariant", () => {
  assertDeterministic(generateImplied);
});

test("implied: math mode's answer is impliedOddsNeeded rounded to the nearest 5", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 40; seed++) {
    const q = generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; spot?: Spot; pot?: number; call?: number };
    if (p.mode !== "math") continue;
    checked++;
    const need = impliedOddsNeeded(p.spot!.equity, p.pot!, p.call!);
    assert.equal(q.answer, Math.max(5, roundTo(need, 5)));
  }
  assert.ok(checked > 0);
});

test("implied: math mode only ever asks when the direct call is losing", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generateImplied({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; spot?: Spot; pot?: number; call?: number };
    if (p.mode !== "math") continue;
    // a positive implied requirement is what makes the question meaningful
    assert.ok(impliedOddsNeeded(p.spot!.equity, p.pot!, p.call!) > 0, `seed ${seed}`);
    assert.ok(p.spot!.equity < requiredEquity(p.pot!, p.call!), `seed ${seed}`);
  }
});

test("implied: math mode is always a turn spot — one card to come", () => {
  for (let seed = 1; seed <= 120; seed++) {
    const q = generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; spot?: Spot };
    if (p.mode === "math") assert.equal(p.spot!.street, "turn");
  }
});

test("implied: concept mode has 4 options, the single-column layout, and a template id", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 8; seed++) {
    const q = generateImplied({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; templateId?: string };
    if (p.mode !== "concept") continue;
    checked++;
    assert.equal(q.layout, "one");
    assert.equal(q.options.length, 4);
    assert.equal(typeof p.templateId, "string");
    assert.ok(
      IMPLIED_CONCEPT_TEMPLATES.some((t) => t.id === p.templateId),
      `unknown template id ${p.templateId}`
    );
    assert.equal(q.body.length, 0);
  }
  assert.ok(checked > 0);
});

test("implied: concept answers survive shuffling — the answer value indexes the right option", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generateImplied({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string };
    if (p.mode !== "concept") continue;
    const correct = q.options.find((o) => o.value === q.answer);
    assert.ok(correct, `seed ${seed}: answer not among options`);
  }
});

/**
 * The M5 completion property for this drill: the concept half was a six-item
 * bank, so the seventh concept question was a guaranteed repeat. The window
 * in `antirepeat.ts` cannot fix that — it can only re-roll a collision if
 * there is something else to roll into.
 */
test("implied: the concept half is no longer a six-item bank", () => {
  const signatures = new Set<string>();
  for (let seed = 1; seed <= 400; seed++) {
    const q = generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    if ((q.payload as { mode: string }).mode === "concept") signatures.add(q.signature!);
  }
  assert.ok(signatures.size > 40, `only ${signatures.size} distinct concept signatures`);
});

test("implied: every concept template is reachable and builds cleanly", () => {
  const seen = new Set<string>();
  for (let seed = 1; seed <= 600; seed++) {
    const q = generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; templateId?: string };
    if (p.mode === "concept") seen.add(p.templateId!);
  }
  assert.equal(
    seen.size,
    IMPLIED_CONCEPT_TEMPLATES.length,
    `unreachable: ${IMPLIED_CONCEPT_TEMPLATES.filter((t) => !seen.has(t.id)).map((t) => t.id).join(", ")}`
  );
});

/**
 * Reverse-implied-odds judgments must follow the cards, not a stated premise.
 * `nut-draw-quality` flips its answer on whether the hero actually holds the
 * highest live card of the suit, and both branches must occur.
 */
test("implied: nut-draw-quality derives nuttedness from the hand and answers both ways", () => {
  const t = IMPLIED_CONCEPT_TEMPLATES.find((x) => x.id === "nut-draw-quality")!;
  let nut = 0;
  let second = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const i = t.build({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = i.params as { hero: number[]; board: number[]; isNut: boolean; topCard: number };

    // Recompute independently rather than trusting the params.
    const q = flushDrawQuality(p.hero, p.board);
    assert.ok(q, `seed ${seed}: params describe a flush draw the helper cannot find`);
    assert.equal(q!.isNut, p.isNut, `seed ${seed}: nuttedness`);
    assert.equal(q!.topCard, p.topCard, `seed ${seed}: top live card of the suit`);

    assert.match(
      i.options[i.correct],
      p.isNut ? /^Count them close to full/ : /^Discount them hard/,
      `seed ${seed}: answer contradicts the hand`
    );
    if (p.isNut) nut++;
    else second++;
  }
  assert.ok(nut > 5, `only ${nut} nut draws in 120 — the answer barely moves`);
  assert.ok(second > 5, `only ${second} non-nut draws in 120 — the answer barely moves`);
});

test("implied: both modes appear across seeds", () => {
  const modes = new Set(
    Array.from({ length: 80 }, (_, i) =>
      (generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { mode: string }).mode
    )
  );
  assert.deepEqual([...modes].sort(), ["concept", "math"]);
});
