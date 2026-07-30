import test from "node:test";
import assert from "node:assert/strict";
import { generateOuts } from "./outs";
import { mulberry32 } from "../rng";
import { drawLine } from "../notes";
import { DRAW_OUTS, coreDraw, drawOuts, outsVsHand, type Spot } from "../../poker/engine";
import type { DrillContext, DrillLevel } from "../contract";
import { assertCommonShape, assertDeterministic } from "./assertions";

const ctx = (seed: number, level: DrillLevel = 2, oppMode: "unknown" | "shown" = "unknown"): DrillContext =>
  ({ level, oppMode, rng: mulberry32(seed) });

test("generateOuts: satisfies the common shape invariants", () => {
  assertCommonShape(generateOuts, "outs");
});

// assertCommonShape already checks kind/options/prompt/payload; this test
// covers the two things specific to `outs` that it does not: the layout is
// literally "grid3" (not just "not two"), and the body always includes a
// felt block.
test("generateOuts: layout is grid3 and the felt is always present", () => {
  for (const level of [1, 2, 3] as DrillLevel[]) {
    for (const oppMode of ["unknown", "shown"] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const q = generateOuts(ctx(seed, level, oppMode));
        assert.equal(q.layout, "grid3");
        assert.ok(q.body.some((b) => b.type === "felt"));
      }
    }
  }
});

test("generateOuts: the answer is the engine's out count, never a hand-written number", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateOuts(ctx(seed, 2, "unknown"));
    const spot = q.payload.spot as Spot;
    assert.equal(q.answer, spot.outCards.length);
    assert.equal(q.answer, drawOuts(spot.hero, spot.board).length);
  }
});

test("generateOuts: unknown mode — the draw label's count agrees with DRAW_OUTS", () => {
  for (let seed = 1; seed <= 80; seed++) {
    const q = generateOuts(ctx(seed, 3, "unknown"));
    const spot = q.payload.spot as Spot;
    const label = coreDraw(spot.draw);
    assert.equal(
      DRAW_OUTS[label],
      spot.outCards.length,
      `seed ${seed}: label "${label}" vs ${spot.outCards.length} outs`
    );
  }
});

test("generateOuts: face-up mode counts only cards that actually beat the villain", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateOuts(ctx(seed, 2, "shown"));
    const spot = q.payload.spot as Spot;
    assert.ok(spot.villain, "face-up mode must deal a villain");
    const clean = outsVsHand(spot.hero, spot.villain!, spot.board).clean;
    assert.equal(q.answer, clean.length);
  }
});

test("generateOuts: face-up mode shows the villain on the felt, unknown mode does not", () => {
  const shown = generateOuts(ctx(5, 2, "shown"));
  const feltShown = shown.body.find((b) => b.type === "felt") as { villain?: unknown[] };
  assert.ok(feltShown.villain && feltShown.villain.length === 2);

  const hidden = generateOuts(ctx(5, 2, "unknown"));
  const feltHidden = hidden.body.find((b) => b.type === "felt") as { villain?: unknown[] };
  assert.equal(feltHidden.villain, undefined);
});

test("generateOuts: options are integers in 1..20", () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const oppMode of ["unknown", "shown"] as const) {
      const q = generateOuts(ctx(seed, 3, oppMode));
      for (const o of q.options) {
        assert.ok(Number.isInteger(o.value) && (o.value as number) >= 1 && (o.value as number) <= 20);
      }
    }
  }
});

test("generateOuts: payload carries level and oppMode and survives JSON", () => {
  const q = generateOuts(ctx(9, 3, "shown"));
  assert.equal(q.payload.level, 3);
  assert.equal(q.payload.oppMode, "shown");
  const round = JSON.parse(JSON.stringify(q.payload));
  assert.deepEqual(round, q.payload);
});

test("generateOuts: the answer is re-derivable from the payload alone", () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const oppMode of ["unknown", "shown"] as const) {
      const q = generateOuts(ctx(seed, 2, oppMode));
      const p = JSON.parse(JSON.stringify(q.payload)) as { spot: Spot; oppMode: string };
      const regraded =
        p.oppMode === "shown"
          ? outsVsHand(p.spot.hero, p.spot.villain!, p.spot.board).clean.length
          : drawOuts(p.spot.hero, p.spot.board).length;
      assert.equal(regraded, q.answer, `seed ${seed} ${oppMode}`);
    }
  }
});

test("generateOuts: explain lists the outs and, face-up, names the dead ones", () => {
  const q = generateOuts(ctx(5, 2, "shown"));
  const ex = q.explain(q.answer);
  assert.ok(ex.rows.some((r) => r.label === "Outs"));
  assert.ok(ex.rows.some((r) => /equity|hitting/i.test(r.label)));
  assert.ok(ex.notes.length > 0);
});

test("generateOuts: level 1 deals a single draw at a time", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateOuts(ctx(seed, 1, "unknown"));
    const spot = q.payload.spot as Spot;
    assert.ok(!spot.draw.includes(" + "), `seed ${seed}: level 1 dealt a combo draw "${spot.draw}"`);
  }
});

test("generateOuts: satisfies the common determinism invariant", () => {
  assertDeterministic(generateOuts);
});

test("generateOuts: same seed gives the same question, different seeds differ", () => {
  const a = generateOuts(ctx(21));
  const b = generateOuts(ctx(21));
  assert.deepEqual(a.payload, b.payload);
  const c = generateOuts(ctx(22));
  assert.notDeepEqual(a.payload, c.payload);
});

// Ported from the retired lib/drill/outsQuestion.test.ts (buildOutsQuestion:
// "carries street, drawLabel and unseen through"). See task-2-report.md for
// the full accounting of that file's tests.
test("generateOuts: carries street (as chip), draw label (with article) and unseen count through", () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const oppMode of ["unknown", "shown"] as const) {
      const q = generateOuts(ctx(seed, 2, oppMode));
      const spot = q.payload.spot as Spot;
      assert.equal(q.chip, spot.street === "flop" ? "Flop" : "Turn");
      const textBlock = q.body.find((b) => b.type === "text") as { text: string };
      // Street-aware: a backdoor flush cannot complete with one card to come,
      // so drawLine drops that clause on the turn. Omitting the street here
      // would assert the pre-fix text. See lib/drill/notes.test.ts.
      assert.equal(textBlock.text, drawLine(spot.draw, spot.street));
      // Whatever sentence drawLine builds, it must read as English: the
      // engine's no-draw fallback used to be run through withArticle and
      // rendered "You have a no obvious draw." (finding L-2).
      assert.doesNotMatch(textBlock.text, /\ban? no\b/i, `seed ${seed} ${oppMode}: ${textBlock.text}`);
      assert.doesNotMatch(textBlock.text, /\ba (?=[aeiou])/i, `seed ${seed} ${oppMode}: ${textBlock.text}`);
      const ex = q.explain(q.answer);
      assert.ok(ex.rows.some((r) => r.label === "Unseen cards" && r.value === String(spot.unseen)));
    }
  }
});
