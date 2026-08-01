import test from "node:test";
import assert from "node:assert/strict";
import {
  awaitingHero, boardFrom, handOver, holeCards, pathKey, potAfter, timeline, toCallAt,
} from "./timeline";
import { parseAction, actionDisplay } from "./actions";
import { verdictFor, isRightVerdict, lossBb } from "./verdict";
import { cardStr } from "../poker/engine";
import type { PlayInstance, PlayNode } from "./types";

/**
 * A hand-written miniature instance: hero is OOP with 7h7d on Ts9s5h.
 *   root: hero checks (0) or bets (1).
 *   check → bot bets 18 → hero folds (0) / calls (1).
 *     call → turn 3c → hero decision (checks down to showdown for brevity).
 *   bet → bot folds (end "bf").
 *   fold end at "0.0", showdown end after "0.1.0".
 */
const NODE: Record<string, PlayNode> = {
  "": {
    pre: [], a: ["X", "B18"], f: [255, 0], l: [0, 3], tb: [0, 0], st: 0, eq: 130,
  },
  "0": {
    pre: [{ t: "a", v: "B18" }], a: ["F", "C", "R45"], f: [0, 255, 0],
    l: [16, 0, 6], tb: [0, 18], st: 0, eq: 128,
  },
  "0.1": {
    pre: [{ t: "c", v: "3c" }], a: ["X", "B60"], f: [255, 0], l: [0, 8],
    tb: [18, 18], st: 1, eq: 140,
  },
};

const INSTANCE: PlayInstance = {
  hero: 0,
  hand: "7h7d",
  bot: "QdTc",
  nodes: NODE,
  ends: {
    "1": { pre: [{ t: "a", v: "F" }], tb: [18, 0], k: "bf" },
    "0.0": { pre: [], tb: [0, 18], k: "f" },
    "0.1.0": {
      pre: [{ t: "a", v: "X" }, { t: "c", v: "2d" }, { t: "a", v: "X" }],
      tb: [18, 18], k: "sd",
    },
  },
};

test("holeCards parses a solver hand string into engine cards", () => {
  const [a, b] = holeCards("7h7d");
  assert.equal(cardStr(a), "7h");
  assert.equal(cardStr(b), "7d");
});

test("timeline: fresh hand stops at the root decision", () => {
  const ev = timeline(INSTANCE, []);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0], { type: "decision", key: "", node: NODE[""], chosen: undefined });
  assert.ok(awaitingHero(ev));
  assert.ok(!handOver(ev));
});

test("timeline: check → bot bet script plays before the next decision", () => {
  const ev = timeline(INSTANCE, [0]);
  assert.equal(ev.length, 3);
  assert.equal(ev[0].type, "decision");
  assert.deepEqual(ev[1], { type: "bot", code: "B18" });
  assert.equal(ev[2].type, "decision");
  assert.ok(awaitingHero(ev));
});

test("timeline: call reveals the turn card and the board grows", () => {
  const ev = timeline(INSTANCE, [0, 1]);
  assert.deepEqual(ev[3], { type: "card", card: "3c" });
  const board = boardFrom("Ts9s5h", ev);
  assert.equal(board.length, 4);
  assert.equal(cardStr(board[3]), "3c");
});

test("timeline: hero bet → bot folds is a bf end", () => {
  const ev = timeline(INSTANCE, [1]);
  const last = ev[ev.length - 1];
  assert.equal(last.type, "end");
  assert.ok(handOver(ev));
  if (last.type === "end") assert.equal(last.end.k, "bf");
});

test("timeline: checked-down line ends at showdown with the full script", () => {
  const ev = timeline(INSTANCE, [0, 1, 0]);
  const types = ev.map((e) => e.type);
  assert.deepEqual(types, [
    "decision", "bot", "decision", "card", "decision", "bot", "card", "bot", "end",
  ]);
  const board = boardFrom("Ts9s5h", ev);
  assert.equal(board.length, 5);
});

test("timeline: throws on paths that do not exist", () => {
  assert.throws(() => timeline(INSTANCE, [7]));
  assert.throws(() => timeline(INSTANCE, [1, 0]));
});

test("pot and to-call math from tb", () => {
  assert.equal(potAfter(55, [0, 18]), 73);
  assert.equal(toCallAt(NODE["0"], 0), 18);
  assert.equal(toCallAt(NODE[""], 0), 0);
  assert.equal(toCallAt(NODE["0.1"], 0), 0);
});

test("pathKey round-trips paths", () => {
  assert.equal(pathKey([]), "");
  assert.equal(pathKey([0, 1, 2]), "0.1.2");
});

test("actions: parse and display", () => {
  assert.deepEqual(parseAction("X"), { code: "X", kind: "check" });
  assert.deepEqual(parseAction("B18"), { code: "B18", kind: "bet", to: 18 });
  assert.deepEqual(parseAction("R45"), { code: "R45", kind: "raise", to: 45 });
  assert.deepEqual(parseAction("A975"), { code: "A975", kind: "allin", to: 975 });
  assert.equal(actionDisplay(parseAction("B18"), { pot: 55, toCall: 0 }), "Bet $18 (33%)");
  assert.equal(actionDisplay(parseAction("C"), { pot: 73, toCall: 18 }), "Call $18");
  assert.equal(actionDisplay(parseAction("R45"), { pot: 73, toCall: 18 }), "Raise to $45");
  assert.equal(actionDisplay(parseAction("X"), { pot: 55, toCall: 0 }), "Check");
});

test("verdicts follow the EV-loss thresholds", () => {
  assert.equal(verdictFor(255, 0), "correct");
  assert.equal(verdictFor(0, 2), "correct"); // near-indifferent 0-freq action
  assert.equal(verdictFor(100, 8), "acceptable"); // mixed and cheap
  assert.equal(verdictFor(0, 8), "inaccuracy"); // cheap but never played
  assert.equal(verdictFor(0, 14), "inaccuracy");
  assert.equal(verdictFor(0, 15), "blunder");
  assert.equal(verdictFor(255, 40), "blunder"); // loss beats frequency
  assert.ok(isRightVerdict("acceptable"));
  assert.ok(!isRightVerdict("inaccuracy"));
  assert.equal(lossBb(16), 0.8);
});
