import test from "node:test";
import assert from "node:assert/strict";
import { handNotation, preflopDecision } from "./preflop";
import { pickHand, handId } from "./load";
import { mulberry32 } from "../drill/rng";
import type { SolveManifest } from "./types";

test("handNotation: pairs, suited, offsuit, rank ordering", () => {
  assert.equal(handNotation("7h7d"), "77");
  assert.equal(handNotation("Ad9c"), "A9o");
  assert.equal(handNotation("9cAd"), "A9o");
  assert.equal(handNotation("Ts8s"), "T8s");
  assert.equal(handNotation("2h3h"), "32s");
});

test("preflopDecision: hero IP is the BTN open decision", () => {
  const d = preflopDecision(1, "AhAd");
  assert.equal(d.scenario.id, "btn");
  assert.equal(d.answer, "r");
  assert.equal(d.continues, "r");
  assert.deepEqual(d.acceptable, []);
});

test("preflopDecision: hero OOP is the BB defence decision", () => {
  const d = preflopDecision(0, "9c8c"); // 98s — a pure-ish BB call vs BTN
  assert.equal(d.scenario.id, "bb-btn");
  assert.equal(d.continues, "c");
  assert.ok(d.options.some((o) => o.key === "c"));
});

test("preflopDecision: a BB mixed hand accepts both sides of the mix", () => {
  // KQo defends as ~45% 3-bet / 55% call in the reference ranges.
  const d = preflopDecision(0, "KhQd");
  const both = [d.answer, ...d.acceptable].sort();
  assert.deepEqual(both, ["c", "r"]);
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
