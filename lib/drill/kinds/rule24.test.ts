import test from "node:test";
import assert from "node:assert/strict";
import { generateRule24, miscounts, showsDrawLabel } from "./rule24";
import { mulberry32 } from "../rng";
import { hitByRiver, hitOnRiver, ruleOf2And4, ruleOf4Corrected } from "../../poker/math";
import { pct } from "../opts";
import { DRAW_OUTS, describeOuts, type Spot } from "../../poker/engine";
import { assertCommonShape, assertDeterministic } from "./assertions";
import type { DrillLevel, OppMode } from "../contract";

/** Every generated question at a level/mode, with its payload destructured. */
function sweep(
  level: DrillLevel,
  oppMode: OppMode,
  seeds: number,
): { q: ReturnType<typeof generateRule24>; spot: Spot; street: "flop" | "turn" }[] {
  const out = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const q = generateRule24({ level, oppMode, rng: mulberry32(seed) });
    const { spot, street } = q.payload as { spot: Spot; street: "flop" | "turn" };
    out.push({ q, spot, street });
  }
  return out;
}

test("generateRule24: satisfies the common shape invariants", () => {
  assertCommonShape(generateRule24, "rule24");
});

test("generateRule24: satisfies the common determinism invariant", () => {
  assertDeterministic(generateRule24);
});

test("rule24: the answer is exactly the uncorrected rule — outs×4 on the flop, outs×2 on the turn", () => {
  for (let seed = 1; seed <= 80; seed++) {
    const q = generateRule24({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const { spot, street } = q.payload as { spot: Spot; street: "flop" | "turn" };
    assert.equal(q.answer, ruleOf2And4(spot.outs, street === "flop" ? 2 : 1));
  }
});

test("rule24: the explanation's true chance comes from the engine, not the rule", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const q = generateRule24({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const { spot, street } = q.payload as { spot: Spot; street: "flop" | "turn" };
    const truth = street === "flop" ? hitByRiver(spot.outs) : hitOnRiver(spot.outs);
    const row = q.explain(q.answer).rows.find((r) => /true chance/i.test(r.label));
    assert.ok(row);
    assert.equal(row!.value, pct(truth));
  }
});

test("rule24: above 8 outs on the flop, the correction is shown with ruleOf4Corrected", () => {
  let checked = 0;
  for (let seed = 1; seed <= 400 && checked < 5; seed++) {
    const q = generateRule24({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const { spot, street } = q.payload as { spot: Spot; street: "flop" | "turn" };
    if (street !== "flop" || spot.outs <= 8) continue;
    checked++;
    const note = q.explain(q.answer).notes.find((n) => /drifts high/i.test(n.text));
    assert.ok(note, `seed ${seed}: no correction note for ${spot.outs} outs`);
    assert.ok(note!.text.includes(String(ruleOf4Corrected(spot.outs))));
  }
  assert.ok(checked > 0, "no >8-out flop spot was generated in 400 seeds — widen the search");
});

test("rule24: options are whole percentages in 1..100", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateRule24({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    for (const o of q.options) {
      const v = o.value as number;
      assert.ok(v > 0 && v <= 100, `bad option ${v}`);
    }
  }
});

test("generateRule24: layout is grid3 and the felt is always present", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const q = generateRule24({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    assert.equal(q.layout, "grid3");
    assert.ok(q.body.some((b) => b.type === "felt"));
  }
});

test("generateRule24: chip names the cards to come per street", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const q = generateRule24({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const { street } = q.payload as { street: "flop" | "turn" };
    assert.equal(q.chip, street === "flop" ? "Two cards to come" : "One card to come");
  }
});

/* ---------- M8.5D: the drill must test counting ---------- */

test("rule24: the prompt never states the out count", () => {
  for (const level of [1, 2, 3] as DrillLevel[]) {
    for (const oppMode of ["unknown", "shown"] as OppMode[]) {
      for (const { q, spot } of sweep(level, oppMode, 40)) {
        // The rule's own name and the ×2 / ×4 sides are the only numerals the
        // prompt is allowed to carry; strip them before looking for a leak.
        const text = `${q.prompt} ${q.sub ?? ""}`
          .replace(/Rule of 2 and 4/g, "the rule")
          .replace(/×[24]/g, "the rule");
        assert.ok(
          !/\d/.test(text),
          `L${level}/${oppMode}: prompt or sub states a number (outs are ${spot.outs}): ${text}`,
        );
      }
    }
  }
});

test("rule24: the draw label is hidden above level 1", () => {
  for (const level of [2, 3] as DrillLevel[]) {
    for (const oppMode of ["unknown", "shown"] as OppMode[]) {
      for (const { q } of sweep(level, oppMode, 40)) {
        assert.ok(
          !q.body.some((b) => b.type === "text"),
          `L${level}/${oppMode}: draw label still shown`,
        );
      }
    }
  }
});

test("rule24: when the label IS shown, its canonical count equals the true count", () => {
  let shown = 0;
  for (const oppMode of ["unknown", "shown"] as OppMode[]) {
    for (const { q, spot } of sweep(1, oppMode, 60)) {
      const labelled = q.body.some((b) => b.type === "text");
      assert.equal(labelled, showsDrawLabel(spot, 1));
      if (!labelled) continue;
      shown++;
      // The CLAUDE.md label/count rule: a named draw and the derived out count
      // may never disagree.
      assert.equal(DRAW_OUTS[spot.draw], spot.outs, `label "${spot.draw}" vs ${spot.outs} outs`);
    }
  }
  assert.ok(shown > 0, "no level-1 spot printed its label — widen the sweep");
});

test("rule24: distractors include the rule applied to a plausible miscount", () => {
  let checked = 0;
  for (const { q, spot, street } of sweep(2, "unknown", 120)) {
    const cardsToCome = street === "flop" ? 2 : 1;
    const wrong = q.options.map((o) => o.value as number).filter((v) => v !== q.answer);
    const fromMiscount = miscounts(spot, "unknown")
      .map((m) => ruleOf2And4(m, cardsToCome))
      .filter((v) => v > 0 && v <= 100);
    if (!fromMiscount.length) continue;
    checked++;
    assert.ok(
      wrong.some((v) => fromMiscount.includes(v)),
      `options ${wrong} contain no miscount-derived value from ${fromMiscount}`,
    );
  }
  assert.ok(checked > 0, "no spot produced miscount candidates");
});

test("rule24: miscounts never include the true count and are all positive", () => {
  for (const { spot } of sweep(3, "shown", 60)) {
    for (const m of miscounts(spot, "shown")) {
      assert.ok(m > 0, `non-positive miscount ${m}`);
      assert.notEqual(m, spot.outs, "miscount equals the true count");
    }
  }
});

test("rule24: a combo draw's miscounts include the naive sum of its parts", () => {
  let checked = 0;
  for (let seed = 1; seed <= 600 && checked < 3; seed++) {
    const q = generateRule24({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const { spot } = q.payload as { spot: Spot };
    const parts = spot.draw.split(" + ");
    if (parts.length < 2) continue;
    const sum = parts.reduce((a, p) => a + (DRAW_OUTS[p] ?? 0), 0);
    if (sum === spot.outs) continue; // nothing to double-count
    checked++;
    assert.ok(miscounts(spot, "unknown").includes(sum), `${spot.draw}: ${sum} missing`);
  }
  assert.ok(checked > 0, "no combo draw generated in 600 seeds — widen the search");
});

test("rule24: the explanation names the counted out cards", () => {
  for (const { q, spot } of sweep(2, "unknown", 40)) {
    const note = q.explain(q.answer).notes.find((n) => /Your \d+ outs?:/.test(n.title ?? ""));
    assert.ok(note, "no counted-outs note");
    assert.equal(note!.text, describeOuts(spot.outCards));
  }
});

test("rule24: face-up mode explains which outs were dead", () => {
  let checked = 0;
  for (let seed = 1; seed <= 400 && checked < 3; seed++) {
    const q = generateRule24({ level: 3, oppMode: "shown", rng: mulberry32(seed) });
    const notes = q.explain(q.answer).notes;
    const dead = notes.find((n) => /^Dead outs/.test(n.title ?? ""));
    if (!dead) continue;
    checked++;
    assert.equal(dead.tone, "warn");
    // The cards are named, not just counted — a wrong count has to be
    // traceable to the specific card the player should not have counted.
    assert.match(dead.title!, /^Dead outs \(\d+\)\.$/);
    assert.match(dead.text, /gives you .* but hands them /);
  }
  assert.ok(checked > 0, "no dead outs surfaced in 400 face-up seeds");
});

test("generateRule24: payload carries level, oppMode, street and spot, and survives JSON", () => {
  const q = generateRule24({ level: 3, oppMode: "shown", rng: mulberry32(9) });
  assert.equal(q.payload.level, 3);
  assert.equal(q.payload.oppMode, "shown");
  assert.ok("street" in q.payload);
  assert.ok("spot" in q.payload);
  const round = JSON.parse(JSON.stringify(q.payload));
  assert.deepEqual(round, q.payload);
});
