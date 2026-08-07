import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handNotation, preflopDecision, preflopVerdict, type PreflopPack } from "./preflop";
import {
  handId, pickHand, pickInstance, preflopSignature, PREFLOP_REPEAT_WINDOW,
} from "./load";
import { REPEAT_WINDOW } from "../drill/antirepeat";
import { stoppingStreetIndex } from "./setup";
import { mulberry32 } from "../drill/rng";
import { verdictForEvLoss } from "./verdict";
import type { SolveFile, SolveManifest } from "./types";

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

/* ------------------------------------------------------------------ *
 * M8.7C — anti-repeat over preflop spots specifically
 * ------------------------------------------------------------------ */

/** A solve file of N instances, alternating seats, with the given hands. */
const solveOf = (hands: string[]): SolveFile => ({
  spot: "srp-btn-bb",
  flop: "Ts9s5h",
  pot: 55,
  stack: 975,
  instances: hands.map((hand) => ({
    hero: 1 as const,
    hand,
    bot: "QdTc",
    nodes: {},
    ends: {},
  })),
});

test("pickInstance: a preflop-only session avoids repeating a hand class", () => {
  // Four unused instances, three of which are AKs from different suits. The
  // `used` set cannot tell them apart — it is keyed by (flop, instance) — and
  // a preflop-only hand never sees the flop, so all three are one question.
  const solve = solveOf(["AsKs", "AhKh", "AdKd", "7c7d"]);
  const recent = new Set([preflopSignature(1, "AcKc")]);
  const index = pickInstance(solve, new Set(), 1, mulberry32(3), recent);
  assert.equal(solve.instances[index].hand, "7c7d", "every AKs combo repeats AKs");
});

test("pickInstance: the signature is the seat and the class, not the combo", () => {
  assert.equal(preflopSignature(1, "AsKs"), preflopSignature(1, "AhKh"));
  assert.notEqual(preflopSignature(1, "AsKs"), preflopSignature(0, "AsKs"));
  assert.notEqual(preflopSignature(1, "AsKs"), preflopSignature(1, "AsKh"));
});

test("pickInstance: a fully-repeated file still deals rather than spinning", () => {
  // Late in a preflop-only session every remaining class may be in the
  // window. A repeated class on a fresh deal beats returning nothing.
  const solve = solveOf(["AsKs", "AhKh"]);
  const recent = new Set([preflopSignature(1, "AsKs")]);
  const index = pickInstance(solve, new Set(), 1, mulberry32(5), recent);
  assert.ok(index >= 0 && index < 2);
});

test("pickInstance: a full-hand session ignores the preflop window", () => {
  // Two AKs hands on different runouts are genuinely different questions when
  // the hand is played out, so suppressing the second would narrow practice
  // for no benefit. Passing no window is what expresses that.
  const solve = solveOf(["AsKs", "AhKh"]);
  const index = pickInstance(solve, new Set(), 1, mulberry32(5));
  assert.ok(index >= 0 && index < 2);
});

test("the stopping-point street numbers match the pack's own", () => {
  // These must equal `stopping_street_index` in api/play_solver.py: the
  // server decides whether a hand may be recorded complete with this
  // arithmetic, so a client that disagreed would finish a hand the server
  // then refuses to close — leaving it incomplete and invisible to M11.
  assert.equal(stoppingStreetIndex("preflop"), -1);
  assert.equal(stoppingStreetIndex("flop"), 0);
  assert.equal(stoppingStreetIndex("turn"), 1);
  assert.equal(stoppingStreetIndex("river"), 2);
  assert.equal(PREFLOP_REPEAT_WINDOW > REPEAT_WINDOW, true, "preflop burns spots faster");
});
