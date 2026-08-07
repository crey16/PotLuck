import test from "node:test";
import assert from "node:assert/strict";
import { generatePushfold } from "./pushfold";
import { mulberry32 } from "../rng";
import { gradeAnswer } from "../grade";
import {
  callBreakEvenEquity,
  callEdgeBb,
  isIndifferent,
  PUSHFOLD_ANTES,
  PUSHFOLD_DEPTHS,
  shoveEdgeBb,
  shoveRange,
  type PushfoldPosition,
} from "../../pushfold";
import type { DrillLevel, OppMode } from "../contract";

const deal = (level: DrillLevel, seed: number, oppMode: OppMode = "unknown") =>
  generatePushfold({ level, oppMode, rng: mulberry32(seed) });

const SEEDS = Array.from({ length: 120 }, (_, i) => i + 1);
const LEVELS: DrillLevel[] = [1, 2, 3];

test("the answer always follows the sign of the solved edge", () => {
  // The single thing that must never be wrong: the drill's answer IS the
  // equilibrium's, not a rule of thumb restated beside it.
  for (const level of LEVELS) {
    for (const seed of SEEDS) {
      const q = deal(level, seed);
      const p = q.payload as {
        mode: string; hero: PushfoldPosition; shover: PushfoldPosition | null;
        stack: number; ante: number; handClass: string; edgeBb: number;
      };
      const edge = p.shover
        ? callEdgeBb(p.hero, p.shover, p.stack, p.ante, p.handClass)
        : shoveEdgeBb(p.hero, p.stack, p.ante, p.handClass);
      assert.equal(p.edgeBb, edge, `L${level} seed ${seed}: payload edge disagrees with the pack`);
      const aggressive = p.mode === "shove" ? "jam" : "call";
      assert.equal(
        q.answer,
        edge > 0 ? aggressive : "fold",
        `L${level} seed ${seed}: ${p.handClass} at ${p.stack}bb, edge ${edge}`
      );
    }
  }
});

test("only an indifferent hand accepts both actions", () => {
  // A drill that accepted both answers on a hand worth 2bb would be teaching
  // that the decision does not matter. Acceptance is allowed exactly where
  // the pack cannot separate the two at its own resolution.
  for (const level of LEVELS) {
    for (const seed of SEEDS) {
      const q = deal(level, seed);
      const { edgeBb } = q.payload as { edgeBb: number };
      const accepts = (q.acceptable ?? []).length > 0;
      assert.equal(
        accepts,
        isIndifferent(edgeBb),
        `L${level} seed ${seed}: edge ${edgeBb} accepted=${accepts}`
      );
      if (accepts) {
        for (const value of q.acceptable!) {
          assert.equal(gradeAnswer(q, value), "acceptable");
        }
      }
    }
  }
});

test("every dealt spot is inside the published pack", () => {
  for (const level of LEVELS) {
    for (const seed of SEEDS) {
      const p = deal(level, seed).payload as {
        hero: PushfoldPosition; shover: PushfoldPosition | null;
        stack: number; ante: number;
      };
      assert.ok(PUSHFOLD_DEPTHS.includes(p.stack), `${p.stack}bb is not solved`);
      assert.ok(PUSHFOLD_ANTES.includes(p.ante), `ante ${p.ante} is not solved`);
      assert.notEqual(p.hero, p.shover, "nobody calls their own jam");
      if (!p.shover) {
        assert.notEqual(p.hero, "BB", "the big blind cannot open a jam");
      }
    }
  }
});

test("a caller always acts after the player who jammed", () => {
  const order = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
  for (const seed of SEEDS) {
    for (const level of [2, 3] as DrillLevel[]) {
      const p = deal(level, seed).payload as {
        hero: PushfoldPosition; shover: PushfoldPosition | null;
      };
      if (!p.shover) continue;
      assert.ok(
        order.indexOf(p.hero) > order.indexOf(p.shover),
        `${p.hero} cannot be facing a jam from ${p.shover}`
      );
    }
  }
});

test("level 1 stays on jam-or-fold at humane depths", () => {
  // Calling off a stack and reading an ante are not the first thing to teach.
  for (const seed of SEEDS) {
    const p = deal(1, seed).payload as {
      mode: string; ante: number; stack: number; hero: PushfoldPosition;
    };
    assert.equal(p.mode, "shove");
    assert.equal(p.ante, 0);
    assert.ok(p.stack >= 8 && p.stack <= 15, `${p.stack}bb is outside the level 1 band`);
    assert.ok(["CO", "BTN", "SB"].includes(p.hero), `${p.hero} is not a level 1 seat`);
  }
});

test("level 3 asks harder questions than level 1", () => {
  // Level 1 wants a clear answer; level 3 hunts the boundary. Compared as
  // medians so one unlucky deal cannot decide it.
  const median = (values: number[]) =>
    values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const spread = (level: DrillLevel) =>
    median(SEEDS.map((seed) => Math.abs((deal(level, seed).payload as { edgeBb: number }).edgeBb)));
  assert.ok(
    spread(3) < spread(1),
    `level 3 median edge ${spread(3)} should be closer to indifference than level 1's ${spread(1)}`
  );
});

test("the same seed deals the same question, and the signature ignores suits", () => {
  for (const seed of SEEDS.slice(0, 20)) {
    const a = deal(2, seed);
    const b = deal(2, seed);
    assert.equal(a.signature, b.signature);
    assert.deepEqual(a.payload, b.payload);
    // The signature is the DECISION, not the deal: seat, jammer, depth, ante
    // and hand class. Two questions differing only in the suits dealt are one
    // question to a player, so the specific cards must not appear in it —
    // otherwise the anti-repeat window would happily re-serve "12bb BTN with
    // A7o" four times with different suits.
    const p = a.payload as {
      mode: string; hero: string; shover: string | null;
      stack: number; ante: number; handClass: string; cards: unknown[];
    };
    assert.equal(
      a.signature,
      `${p.mode}|${p.hero}|${p.shover ?? "-"}|${p.stack}|${p.ante}|${p.handClass}`
    );
    // Two deals of the same decision with different suits collapse to one
    // signature — which is the point, and is what the equality above asserts:
    // the dealt cards appear in the payload and nowhere in the signature.
    const withOtherSuits = { ...p, cards: [] };
    assert.equal(
      `${withOtherSuits.mode}|${withOtherSuits.hero}|${withOtherSuits.shover ?? "-"}|` +
        `${withOtherSuits.stack}|${withOtherSuits.ante}|${withOtherSuits.handClass}`,
      a.signature
    );
  }
});

test("every question says it is chip EV, not ICM", () => {
  // A player drilling push/fold is overwhelmingly likely to be a tournament
  // player, and a chip-EV chart used on a bubble is wrong in a way they
  // cannot see from the chart. This is not a footnote.
  for (const level of LEVELS) {
    for (const seed of SEEDS.slice(0, 40)) {
      const q = deal(level, seed);
      const notes = q.explain(q.answer).notes;
      assert.ok(
        notes.some((note) => /ICM/i.test(note.title ?? "") || /ICM/i.test(note.text)),
        `L${level} seed ${seed} does not disclose the chip-EV assumption`
      );
    }
  }
});

test("the explain panel's numbers come from the pack, never restated", () => {
  for (const seed of SEEDS.slice(0, 40)) {
    const q = deal(3, seed);
    const p = q.payload as {
      hero: PushfoldPosition; shover: PushfoldPosition | null;
      stack: number; ante: number; edgeBb: number;
    };
    const rows = q.explain(q.answer).rows;
    const cost = rows[0];
    assert.match(cost.value, /bb more$/);
    assert.equal(
      cost.value,
      `${Math.abs(p.edgeBb).toFixed(2)}bb more`,
      "the stated cost must be the pack's own edge"
    );
    if (p.shover) {
      // The break-even equity shown must be the real pot odds, and it is the
      // number the lesson teaches too.
      const required = callBreakEvenEquity(p.hero, p.shover, p.stack, p.ante);
      const row = rows.find((r) => r.label === "Equity you need");
      assert.ok(row, "a calling question must show the price");
      assert.equal(row!.value, `${(required * 100).toFixed(1)}%`);
    } else {
      const row = rows.find((r) => r.label.endsWith("jams"));
      assert.ok(row, "a jamming question must show the range it belongs to");
      const range = shoveRange(p.hero, p.stack, p.ante);
      assert.equal(row!.value, `${range.percent.toFixed(1)}% of hands`);
    }
  }
});
