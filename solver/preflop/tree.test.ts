import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  buildTree,
  OPEN,
  POS,
  POSTED,
  payoffs,
  payoffsSumToZero,
  raiseTo,
  START_STACK,
  type Pos,
} from "./tree";

const tree = buildTree();
const decisions = tree.nodes.filter((n) => n.kind === "decision");
const terminals = tree.nodes.filter((n) => n.kind === "terminal");

test("the tree builds and has both decision and terminal nodes", () => {
  assert.ok(decisions.length > 0);
  assert.ok(terminals.length > 0);
});

test("chips are conserved at every terminal, whoever wins", () => {
  // The invariant that makes the payoff accounting trustworthy: a sign error
  // in contributions or the pot is invisible in the output but fatal to the
  // solve, so it is asserted for every terminal and every possible winner.
  for (const n of terminals) {
    if (n.kind !== "terminal") continue;
    for (const winner of n.terminal.live) {
      const v = payoffs(n.terminal, new Map([[winner, 1]]));
      assert.ok(
        payoffsSumToZero(v),
        `terminal ${n.id} (${n.terminal.kind}) does not conserve chips when ${winner} wins`,
      );
    }
    // And for a split of a contested pot.
    if (n.terminal.live.length === 2) {
      const [a, b] = n.terminal.live;
      const v = payoffs(n.terminal, new Map([[a, 0.5], [b, 0.5]]));
      assert.ok(payoffsSumToZero(v), `terminal ${n.id} does not conserve chips on a split`);
    }
  }
});

test("nobody ever contributes more than their stack", () => {
  for (const n of terminals) {
    if (n.kind !== "terminal") continue;
    for (const p of POS) {
      assert.ok(
        n.terminal.contrib[p] <= START_STACK,
        `${p} contributed ${n.terminal.contrib[p]} > stack at terminal ${n.id}`,
      );
    }
  }
});

test("a contested pot always has exactly two live players — the pruning rule", () => {
  // No overcalls: the moment someone calls, the hand is heads-up. If this ever
  // fails, a multiway pot has appeared and nothing downstream can solve it.
  for (const n of terminals) {
    if (n.kind !== "terminal") continue;
    if (n.terminal.kind === "postflop" || n.terminal.kind === "allin") {
      assert.equal(
        n.terminal.live.length,
        2,
        `terminal ${n.id} is contested by ${n.terminal.live.length} players`,
      );
    }
  }
});

test("a called 4-bet is all-in and never reaches a postflop subgame", () => {
  for (const n of terminals) {
    if (n.kind !== "terminal") continue;
    if (n.terminal.kind === "allin") {
      for (const p of n.terminal.live) {
        assert.equal(n.terminal.contrib[p], START_STACK, "an all-in terminal must be for stacks");
      }
    }
  }
});

test("every postflop terminal names a subgame that gen-subgames.ts produced", () => {
  // Two independently written pieces of code agreeing about which subgames
  // exist. If they diverge, the batch solves configurations the tree never
  // reaches, or the tree reaches configurations with no EV data.
  const dir = path.resolve(import.meta.dirname, "../subgames");
  const generated = new Set(
    readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")),
  );
  for (const sg of tree.subgames) {
    assert.ok(generated.has(sg), `tree reaches subgame ${sg}, which gen-subgames.ts did not emit`);
  }
});

test("the blinds are the only money in before anyone acts", () => {
  const root = tree.nodes[tree.root];
  assert.equal(root.kind, "decision");
  if (root.kind !== "decision") return;
  assert.equal(root.actor, "UTG", "UTG acts first in 6-max");
  assert.equal(POSTED.SB + POSTED.BB, 15);
});

test("raise sizing: 3-bets are bigger out of position", () => {
  // Out of position you realise less equity, so you deny more of theirs.
  assert.equal(raiseTo(0, "UTG", "UTG"), OPEN);
  assert.ok(raiseTo(1, "SB", "BTN") > raiseTo(1, "BTN", "CO"));
  assert.equal(raiseTo(2, "BTN", "CO"), START_STACK, "the 4-bet is all-in");
});

test("a walk gives the BB the small blind and costs nobody else", () => {
  const walks = terminals.filter(
    (n) => n.kind === "terminal" && n.terminal.kind === "walk",
  );
  assert.ok(walks.length > 0, "the tree must contain a folded-around pot");
  for (const n of walks) {
    if (n.kind !== "terminal") continue;
    const v = payoffs(n.terminal, new Map([["BB" as Pos, 1]]));
    assert.ok(payoffsSumToZero(v));
    assert.equal(v.BB, POSTED.SB, "the BB should win exactly the small blind");
  }
});
