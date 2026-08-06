import test from "node:test";
import assert from "node:assert/strict";
import { generateConcepts } from "./concepts";
import { CONCEPT_TEMPLATES, cardGlyph } from "./conceptTemplates";
import { mulberry32 } from "../rng";
import { assertCommonShape, assertDeterministic } from "./assertions";
import { outsVsHand, deadOuts, cardStr, parseCard, type Card } from "../../poker/engine";
import {
  breakEvenFoldRate,
  hitByRiver,
  hitOnRiver,
  minDefenceFrequency,
  requiredEquity,
  ruleOf2And4,
  ruleOf4Corrected,
} from "../../poker/math";
import type { DrillLevel, OppMode } from "../contract";

const LEVELS: DrillLevel[] = [1, 2, 3];
const MODES: OppMode[] = ["unknown", "shown"];

/** Every template, built across a spread of seeds — the workhorse of this file. */
function* instances(seeds = 20) {
  for (const template of CONCEPT_TEMPLATES) {
    for (let seed = 1; seed <= seeds; seed++) {
      yield {
        template,
        seed,
        instance: template.build({ level: 2, oppMode: "unknown", rng: mulberry32(seed) }),
      };
    }
  }
}

test("generateConcepts: satisfies the common shape invariants", () => {
  assertCommonShape(generateConcepts, "concepts");
});

test("generateConcepts: is deterministic for a given seed", () => {
  assertDeterministic(generateConcepts);
});

test("concepts: every template builds a well-formed instance at every level and mode", () => {
  for (const template of CONCEPT_TEMPLATES) {
    for (const level of LEVELS) {
      for (const oppMode of MODES) {
        for (let seed = 1; seed <= 40; seed++) {
          const where = `${template.id} L${level} ${oppMode} seed ${seed}`;
          const i = template.build({ level, oppMode, rng: mulberry32(seed) });

          assert.equal(i.templateId, template.id, `${where}: template id`);
          assert.ok(i.prompt.length > 20, `${where}: prompt too short`);
          assert.equal(i.options.length, 4, `${where}: four options`);
          assert.equal(new Set(i.options).size, 4, `${where}: distinct options`);
          for (const o of i.options) assert.ok(o.length > 0, `${where}: empty option`);
          assert.ok(i.correct >= 0 && i.correct < 4, `${where}: correct index in range`);
          assert.ok(i.explain.length > 40, `${where}: explanation too short`);
          assert.ok(i.signature.startsWith(template.id), `${where}: signature is template-scoped`);
          assert.deepEqual(
            JSON.parse(JSON.stringify(i.params)),
            i.params,
            `${where}: params are not JSON-clean`
          );
          // The correct option must never also appear as a distractor, and
          // `alsoAcceptable` must never include the canonical answer.
          assert.ok(
            !i.alsoAcceptable?.includes(i.correct),
            `${where}: alsoAcceptable repeats the correct index`
          );
        }
      }
    }
  }
});

/**
 * The property the whole M5 completion exists for: the concept drill must no
 * longer be a finite bank. Fifteen static items meant the sixteenth question
 * was a guaranteed repeat; the 24-deep anti-repeat window could not fix that
 * because it had nothing to re-roll into.
 */
test("concepts: the question space is not a finite bank", () => {
  const signatures = new Set<string>();
  for (let seed = 1; seed <= 400; seed++) {
    signatures.add(
      generateConcepts({ level: 2, oppMode: "unknown", rng: mulberry32(seed) }).signature!
    );
  }
  // The old bank could produce exactly 15. Anything in that neighbourhood
  // would mean a template is not varying its parameters at all.
  assert.ok(
    signatures.size > 200,
    `only ${signatures.size} distinct signatures in 400 deals — a template is not varying`
  );
});

test("concepts: every template is reachable", () => {
  const seen = new Set(
    Array.from({ length: 500 }, (_, i) => {
      const q = generateConcepts({ level: 1, oppMode: "unknown", rng: mulberry32(i + 1) });
      return (q.payload as { templateId: string }).templateId;
    })
  );
  assert.equal(seen.size, CONCEPT_TEMPLATES.length, `unreachable templates: ${
    CONCEPT_TEMPLATES.filter((t) => !seen.has(t.id)).map((t) => t.id).join(", ")
  }`);
});

test("concepts: each template varies its own parameters across seeds", () => {
  for (const template of CONCEPT_TEMPLATES) {
    const signatures = new Set(
      Array.from({ length: 60 }, (_, i) =>
        template.build({ level: 2, oppMode: "unknown", rng: mulberry32(i + 1) }).signature
      )
    );
    assert.ok(
      signatures.size >= 4,
      `${template.id}: only ${signatures.size} distinct signatures in 60 builds`
    );
  }
});

test("concepts: the graded answer always points at the instance's correct option text", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generateConcepts({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const chosen = q.options.find((o) => o.value === q.answer);
    assert.ok(chosen, `seed ${seed}: answer not among options`);
  }
});

test("concepts: options are shuffled, not always in template order", () => {
  const firsts = new Set(
    Array.from({ length: 80 }, (_, i) => {
      const q = generateConcepts({ level: 1, oppMode: "unknown", rng: mulberry32(i + 1) });
      const id = (q.payload as { templateId: string }).templateId;
      return `${id}:${q.options[0].label}`;
    })
  );
  assert.ok(firsts.size > 30, "options do not appear to be shuffled");
});

test("concepts: single-column layout, no board, and an explanation note", () => {
  const q = generateConcepts({ level: 2, oppMode: "unknown", rng: mulberry32(5) });
  assert.equal(q.layout, "one");
  assert.deepEqual(q.body, []);
  assert.ok(q.explain(q.answer).notes.length >= 1);
});

/* ------------------------------------------------------------------ *
 * Per-template correctness — the answers are recomputed here from
 * lib/poker/math.ts and the evaluator, never read back from the prose.
 * CLAUDE.md rule 2: a hand-written number is wrong the moment the spot
 * that produced it changes.
 * ------------------------------------------------------------------ */

const buildOf = (templateId: string, seed: number) =>
  CONCEPT_TEMPLATES.find((x) => x.id === templateId)!.build({
    level: 2,
    oppMode: "unknown",
    rng: mulberry32(seed),
  });

test("rule-choice: all-in answers ×4, money behind answers ×2", () => {
  let sawAllIn = false;
  let sawBehind = false;
  for (let seed = 1; seed <= 120; seed++) {
    const i = buildOf("rule-choice", seed);
    const { allIn } = i.params as { allIn: boolean };
    const answer = i.options[i.correct];
    if (allIn) {
      sawAllIn = true;
      assert.match(answer, /^Rule of 4 —/, `seed ${seed}: all-in must answer Rule of 4`);
    } else {
      sawBehind = true;
      assert.match(answer, /^Rule of 2 —/, `seed ${seed}: money behind must answer Rule of 2`);
    }
  }
  // Both branches must actually occur, or the "answer moves" claim is empty.
  assert.ok(sawAllIn && sawBehind, "rule-choice never exercised both branches");
});

test("pot-odds-quote: the true ratio and the threshold come from requiredEquity", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const i = buildOf("pot-odds-quote", seed);
    const p = i.params as {
      potBefore: number; bet: number; pot: number; call: number; misquotes: boolean; need: number;
    };
    assert.equal(p.pot, p.potBefore + p.bet, `seed ${seed}: pot convention`);
    assert.equal(p.call, p.bet, `seed ${seed}: call convention`);
    assert.equal(p.need, requiredEquity(p.pot, p.call), `seed ${seed}: threshold`);

    const trueRatio = (p.pot / p.call).toFixed(1);
    const wrongRatio = (p.potBefore / p.call).toFixed(1);
    // The misquote must actually be a different number, or the question has
    // no error to spot.
    if (p.misquotes) {
      assert.notEqual(trueRatio, wrongRatio, `seed ${seed}: misquote is indistinguishable`);
      assert.ok(
        i.options[i.correct].includes(`${trueRatio} to 1`),
        `seed ${seed}: correct option must state the true ratio`
      );
    }
  }
});

test("dead-out-pick: the named card is a genuine dead out and the rest are genuine outs", () => {
  const parse = (label: string): Card => {
    const body = label.replace("The ", "");
    const rank = body[0];
    const suit = { "♠": "s", "♥": "h", "♦": "d", "♣": "c" }[body[1]]!;
    return parseCard(rank + suit);
  };

  for (let seed = 1; seed <= 60; seed++) {
    const i = buildOf("dead-out-pick", seed);
    const p = i.params as { hero: Card[]; board: Card[]; villain: Card[]; deadCard: string };

    const real = new Set(outsVsHand(p.hero, p.villain, p.board).clean.map(cardStr));
    const dead = new Set(deadOuts(p.hero, p.villain, p.board).map((d) => cardStr(d.card)));

    const answer = parse(i.options[i.correct]);
    assert.equal(cardStr(answer), p.deadCard, `seed ${seed}: params disagree with the prose`);
    assert.ok(dead.has(cardStr(answer)), `seed ${seed}: ${p.deadCard} is not a dead out`);
    assert.ok(!real.has(cardStr(answer)), `seed ${seed}: ${p.deadCard} is counted as a real out`);

    for (const [idx, option] of i.options.entries()) {
      if (idx === i.correct) continue;
      const c = cardStr(parse(option));
      assert.ok(real.has(c), `seed ${seed}: ${c} offered as an out but the evaluator disagrees`);
    }

    // The prompt must describe the spot the params carry, so a reworded
    // prompt cannot drift away from the cards it is asking about.
    assert.ok(
      i.prompt.includes(p.hero.map(cardGlyph).join("")),
      `seed ${seed}: prompt does not show the hero hand in params`
    );
    assert.ok(
      i.prompt.includes(p.villain.map(cardGlyph).join("")),
      `seed ${seed}: prompt does not show the villain hand in params`
    );
  }
});

test("rule4-overstates: claim, truth and correction all come from math.ts", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const i = buildOf("rule4-overstates", seed);
    const p = i.params as { outs: number; claimed: number; exact: number; corrected: number };

    assert.ok(p.outs > 8, `seed ${seed}: the correction only applies above 8 outs`);
    assert.equal(p.claimed, ruleOf2And4(p.outs, 2), `seed ${seed}: claim`);
    assert.equal(p.exact, hitByRiver(p.outs) * 100, `seed ${seed}: exact`);
    assert.equal(p.corrected, ruleOf4Corrected(p.outs), `seed ${seed}: correction`);
    // The whole point: ×4 must actually overstate.
    assert.ok(p.claimed > p.exact, `seed ${seed}: ×4 did not overstate`);
    assert.ok(
      i.options[i.correct].includes(`${Math.round(p.exact)}%`),
      `seed ${seed}: the correct option must state the honest number`
    );
  }
});

test("call-or-fold-price: the verdict is equity versus the price, and both verdicts occur", () => {
  let calls = 0;
  let folds = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const i = buildOf("call-or-fold-price", seed);
    const p = i.params as {
      outs: number; pot: number; call: number; equity: number; need: number; isCall: boolean;
    };

    assert.equal(p.equity, hitOnRiver(p.outs), `seed ${seed}: one card to come`);
    assert.equal(p.need, requiredEquity(p.pot, p.call), `seed ${seed}: price`);
    assert.equal(p.isCall, p.equity > p.need, `seed ${seed}: verdict does not follow the math`);
    assert.match(
      i.options[i.correct],
      p.isCall ? /^Call —/ : /^Fold —/,
      `seed ${seed}: correct option contradicts the verdict`
    );
    if (p.isCall) calls++;
    else folds++;
  }
  // A drill that is always a fold is a drill players answer without reading.
  assert.ok(calls > 10, `only ${calls} calls in 150 — the answer barely moves`);
  assert.ok(folds > 10, `only ${folds} folds in 150 — the answer barely moves`);
});

test("cheapest-bluff: the answer is the size with the lowest break-even fold rate", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const i = buildOf("cheapest-bluff", seed);
    const p = i.params as { sizes: number[]; correctFraction: number };

    const best = p.sizes.reduce((a, b) =>
      breakEvenFoldRate(100, 100 * b) < breakEvenFoldRate(100, 100 * a) ? b : a
    );
    assert.equal(p.correctFraction, best, `seed ${seed}: not the cheapest size`);
    assert.equal(p.sizes.length, 4, `seed ${seed}: four sizes`);
    assert.equal(new Set(p.sizes).size, 4, `seed ${seed}: distinct sizes`);
  }
});

test("mdf-overfold: the stated defence requirement is minDefenceFrequency", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const i = buildOf("mdf-overfold", seed);
    const p = i.params as {
      potBefore: number; bet: number; mdf: number; bluffNeeds: number;
    };
    assert.equal(p.mdf, minDefenceFrequency(p.potBefore, p.bet), `seed ${seed}: mdf`);
    assert.equal(p.bluffNeeds, breakEvenFoldRate(p.potBefore, p.bet), `seed ${seed}: bluff price`);
    // MDF and the bluff's break-even fold rate are complements — if that ever
    // stops holding, one of the two formulas has been changed in isolation.
    assert.ok(
      Math.abs(p.mdf + p.bluffNeeds - 1) < 1e-9,
      `seed ${seed}: mdf and breakEvenFoldRate are no longer complements`
    );
    assert.equal(i.options[i.correct], "Minimum defence frequency", `seed ${seed}`);
  }
});

test("implied-capped-by-stack: all three worlds occur and each answers correctly", () => {
  const worlds = new Set<number>();
  for (let seed = 1; seed <= 150; seed++) {
    const i = buildOf("implied-capped-by-stack", seed);
    const p = i.params as {
      world: number; pot: number; call: number; behind: number; need: number; outs: number;
    };
    worlds.add(p.world);

    // The question is only meaningful when the direct call is losing.
    assert.ok(p.need > 0, `seed ${seed}: direct call was already good`);

    if (p.world === 0) {
      assert.equal(p.behind, 0, `seed ${seed}: all-in world must have nothing behind`);
      assert.match(i.options[i.correct], /^Nothing —/, `seed ${seed}`);
    } else {
      assert.match(
        i.options[i.correct],
        p.behind >= p.need ? /^Enough —/ : /^Not enough —/,
        `seed ${seed}: verdict contradicts stack vs shortfall`
      );
    }
  }
  assert.deepEqual([...worlds].sort(), [0, 1, 2], "not every implied-odds world was reached");
});

test("equity-meaning: the share stated is equity × pot", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const i = buildOf("equity-meaning", seed);
    const p = i.params as { pot: number; equity: number; share: number };
    assert.equal(p.share, Math.round(p.pot * p.equity), `seed ${seed}: share`);
  }
});

test("break-even-identity: the threshold stated is call / (pot + call)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const i = buildOf("break-even-identity", seed);
    const p = i.params as { pot: number; call: number; need: number };
    assert.equal(p.need, requiredEquity(p.pot, p.call), `seed ${seed}: threshold`);
    assert.match(i.options[i.correct], /call ÷ \(pot \+ call\)/, `seed ${seed}`);
  }
});

test("concepts: no template ever states a percentage it did not compute", () => {
  // A blunt guard against the failure this whole rewrite is guarding against:
  // prose that carries a number the math no longer produces. Every percentage
  // in a correct option must be reproducible from the instance's own params.
  for (const { template, seed, instance } of instances(60)) {
    const p = instance.params as Record<string, number>;
    const derived = new Set<string>();
    const add = (v: number) => {
      derived.add(`${Math.round(v * 100)}%`);
      derived.add(`${(v * 100).toFixed(1)}%`);
    };
    for (const value of Object.values(p)) {
      if (typeof value !== "number") continue;
      if (value > 0 && value <= 1) add(value);
      if (Number.isInteger(value) && value >= 0 && value <= 100) derived.add(`${value}%`);
      // Percentages carried already scaled (rule4-overstates' `exact`).
      if (value > 1 && value <= 100) {
        derived.add(`${Math.round(value)}%`);
        derived.add(`${value.toFixed(1)}%`);
      }
    }
    for (const match of instance.options[instance.correct].matchAll(/\d+(?:\.\d+)?%/g)) {
      assert.ok(
        derived.has(match[0]),
        `${template.id} seed ${seed}: correct option states ${match[0]}, which no param produces`
      );
    }
  }
});
