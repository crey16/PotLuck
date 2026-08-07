import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handNotation, preflopDecision, preflopVerdict, type PreflopPack } from "./preflop";
import { pickHand, handId } from "./load";
import { mulberry32 } from "../drill/rng";
import { verdictForEvLoss } from "./verdict";
import type { SolveManifest } from "./types";

/**
 * The published pack, read from the canonical committed copy rather than the
 * git-ignored build-time mirror under public/. Testing the mirror would pass
 * against a stale file after a pack regeneration.
 */
const pack = JSON.parse(
  readFileSync("solver/pack/srp-btn-bb/preflop.json", "utf8")
) as PreflopPack;

test("handNotation: pairs, suited, offsuit, rank ordering", () => {
  assert.equal(handNotation("7h7d"), "77");
  assert.equal(handNotation("Ad9c"), "A9o");
  assert.equal(handNotation("9cAd"), "A9o");
  assert.equal(handNotation("Ts8s"), "T8s");
  assert.equal(handNotation("2h3h"), "32s");
});

test("the pack covers all 169 classes for both roles, with a precision", () => {
  for (const position of ["BTN", "BB"] as const) {
    const role = pack.roles[position];
    assert.equal(Object.keys(role.hands).length, 169, `${position} is incomplete`);
    for (const [hand, entry] of Object.entries(role.hands)) {
      assert.equal(entry.ev.length, role.actions.length, `${position} ${hand}`);
      // A hand with no standard error would be graded as if the 25-flop
      // sample were exact, which is the false certainty this pack exists to
      // avoid publishing.
      assert.ok(entry.se > 0, `${position} ${hand} has no standard error`);
    }
  }
});

test("preflopDecision: hero IP is the BTN open decision, with real EVs", () => {
  const d = preflopDecision(pack, 1, "AhAd");
  assert.equal(d.position, "BTN");
  assert.equal(d.answer, "r");
  assert.equal(d.continues, "r");
  // Aces are worth far more than the dead money, so opening them is not a
  // close call at any sample size.
  assert.ok(d.options.find((o) => o.key === "r")!.evBb > 2);
  assert.equal(d.options.find((o) => o.key === "f")!.evBb, 0);
  assert.equal(d.tooCloseToCall, false);
});

test("preflopDecision: hero OOP is the BB defence, and folding costs the blind", () => {
  const d = preflopDecision(pack, 0, "AhAd");
  assert.equal(d.position, "BB");
  assert.equal(d.answer, "c");
  assert.equal(d.continues, "c");
  // Folding is always exactly the posted big blind, never an estimate.
  assert.equal(d.options.find((o) => o.key === "f")!.evBb, -1);
});

test("BB has no 3-bet: the solved tree does not contain one", () => {
  // The reference scenario this replaced offered fold / call / 3-bet. Offering
  // a button the pack cannot grade or continue from is the "offered and then
  // quietly substituted" failure lib/play/setup.ts exists to prevent.
  const d = preflopDecision(pack, 0, "KhQd");
  assert.deepEqual(d.options.map((o) => o.key).sort(), ["c", "f"]);
});

test("suit-isomorphic hands grade identically", () => {
  // The raw per-combo EVs for the six combos of 22 span ~1.8bb purely from the
  // 25-flop sample. Grading them differently would teach a suit superstition,
  // so the pack is indexed by 169-class and every combo of a class agrees.
  const combos = ["2s2h", "2s2d", "2s2c", "2h2d", "2h2c", "2d2c"];
  const decisions = combos.map((c) => preflopDecision(pack, 1, c));
  for (const d of decisions) {
    assert.equal(d.notation, "22");
    assert.deepEqual(d.options.map((o) => o.evBb), decisions[0].options.map((o) => o.evBb));
    assert.equal(preflopVerdict(d, "f"), preflopVerdict(decisions[0], "f"));
  }
});

test("a choice inside the measured noise is never graded as a mistake", () => {
  // Roughly a third of BB's grid sits within one standard error of its own
  // call/fold threshold. Those hands must grade correct either way — the pack
  // genuinely cannot separate them, and inventing a verdict is the failure
  // reference-range grading was retired for.
  let checked = 0;
  for (const position of ["BTN", "BB"] as const) {
    const hero = position === "BTN" ? 1 : 0;
    for (const hand of Object.keys(pack.roles[position].hands)) {
      // Any combo of the class; grading is class-indexed.
      const suits = hand.length === 2 ? "sh" : hand.endsWith("s") ? "ss" : "sh";
      const combo = `${hand[0]}${suits[0]}${hand[1]}${suits[1]}`;
      const d = preflopDecision(pack, hero as 0 | 1, combo);
      for (const option of d.options) {
        if (!option.indistinguishable) continue;
        assert.equal(
          preflopVerdict(d, option.key),
          "correct",
          `${position} ${hand} ${option.key} costs ${option.lossBb}bb inside ±${d.seBb}bb`
        );
        checked++;
      }
    }
  }
  // Both the best action and every near-tie; if this ever collapsed to only
  // the best actions the tolerance would be doing nothing.
  assert.ok(checked > 169 * 2, `only ${checked} indistinguishable actions found`);
});

test("verdictForEvLoss grades only the resolvable part of a loss", () => {
  assert.equal(verdictForEvLoss(0.4, 0.4), "correct");
  assert.equal(verdictForEvLoss(0.45, 0.4), "correct");
  assert.equal(verdictForEvLoss(1.0, 0.4), "inaccuracy");
  assert.equal(verdictForEvLoss(2.0, 0.4), "blunder");
  // With no uncertainty it collapses to the ordinary bands.
  assert.equal(verdictForEvLoss(0.05, 0), "correct");
  assert.equal(verdictForEvLoss(0.8, 0), "blunder");
  // Monotone: a worse choice can never grade better.
  const order = ["correct", "inaccuracy", "blunder"];
  const ranks = Array.from({ length: 60 }, (_, i) =>
    order.indexOf(verdictForEvLoss(i * 0.07, 0.3))
  );
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test("pickHand: uniform over instances, respects the used set", () => {
  const manifest: SolveManifest = {
    spot: "srp-btn-bb", pot: 55, stack: 975,
    flops: [
      { flop: "AsKhQd", instances: 2 },
      { flop: "Ts9s5h", instances: 2 },
    ],
  };
  const used = new Set<string>();
  const rng = mulberry32(9);
  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const p = pickHand(manifest, used, rng);
    const id = handId(p.flop, p.index);
    assert.ok(!seen.has(id), `repeated ${id} with unused hands remaining`);
    seen.add(id);
    used.add(id);
  }
  assert.equal(seen.size, 4);
  // Exhausted: must still return something rather than spin.
  const p = pickHand(manifest, used, rng);
  assert.ok(used.has(handId(p.flop, p.index)));
});
