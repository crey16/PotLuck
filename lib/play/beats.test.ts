import test from "node:test";
import assert from "node:assert/strict";
import { beatsFor, streetBets, BEAT_MS } from "./beats";
import type { HandEvent } from "./timeline";
import type { PlayNode } from "./types";

const node = (over: Partial<PlayNode> = {}): PlayNode => ({
  pre: [], a: ["X", "B27"], f: [128, 128], l: [0, 0],
  tb: [0, 0], st: 0, eq: 128, ...over,
});

const chipsOf = (events: HandEvent[], hero: 0 | 1 = 1) =>
  beatsFor(events, hero).flatMap((b) => (b.kind === "chips" ? [b.chips] : []));

test("beatsFor: a dealt card becomes one board beat", () => {
  const events: HandEvent[] = [{ type: "card", card: "Qd" }];
  assert.deepEqual(beatsFor(events, 1), [
    { kind: "board", card: "Qd", ms: BEAT_MS.board },
  ]);
});

test("beatsFor: a bot check is a think beat with no chips", () => {
  const events: HandEvent[] = [{ type: "bot", code: "X" }];
  assert.deepEqual(beatsFor(events, 1), [
    { kind: "think", seat: "villain", ms: BEAT_MS.think },
  ]);
});

test("beatsFor: a bot bet is a think beat then a chips beat", () => {
  const events: HandEvent[] = [{ type: "bot", code: "B27" }];
  assert.deepEqual(beatsFor(events, 1), [
    { kind: "think", seat: "villain", ms: BEAT_MS.think },
    { kind: "chips", seat: "villain", chips: 27, ms: BEAT_MS.chips },
  ]);
});

test("beatsFor: a hero decision emits chips for the hero seat only", () => {
  const events: HandEvent[] = [
    { type: "decision", key: "", node: node(), chosen: 1 },
  ];
  assert.deepEqual(beatsFor(events, 1), [
    { kind: "chips", seat: "hero", chips: 27, ms: BEAT_MS.chips },
  ]);
});

test("beatsFor: an unanswered decision emits nothing — it is the stopping point", () => {
  const events: HandEvent[] = [{ type: "decision", key: "", node: node() }];
  assert.deepEqual(beatsFor(events, 1), []);
});

test("beatsFor: a call wagers only the difference", () => {
  // Villain bets to 27, hero calls: hero puts in 27, not 54.
  const events: HandEvent[] = [
    { type: "bot", code: "B27" },
    { type: "decision", key: "", node: node({ a: ["F", "C"], tb: [27, 0] }), chosen: 1 },
  ];
  assert.deepEqual(chipsOf(events), [27, 27]);
});

test("beatsFor: a raise wagers only the increment over what is already in", () => {
  // Villain bets 27, hero raises to 90: villain has 27 in, hero adds 90.
  const events: HandEvent[] = [
    { type: "bot", code: "B27" },
    { type: "decision", key: "", node: node({ a: ["F", "R90"], tb: [27, 0] }), chosen: 1 },
  ];
  assert.deepEqual(chipsOf(events), [27, 90]);
});

test("beatsFor: a re-raise counts only what the raiser adds", () => {
  // Hero bets 27, villain raises to 90 — villain adds 90, not 117.
  const events: HandEvent[] = [
    { type: "decision", key: "", node: node({ a: ["X", "B27"] }), chosen: 1 },
    { type: "bot", code: "R90" },
  ];
  assert.deepEqual(chipsOf(events), [27, 90]);
});

test("beatsFor: hero calling a re-raise adds only the shortfall", () => {
  // Hero bets 27, villain raises to 90, hero calls: hero adds 90 − 27 = 63.
  const events: HandEvent[] = [
    { type: "decision", key: "", node: node({ a: ["X", "B27"] }), chosen: 1 },
    { type: "bot", code: "R90" },
    { type: "decision", key: "1", node: node({ a: ["F", "C"], tb: [90, 27] }), chosen: 1 },
  ];
  assert.deepEqual(chipsOf(events), [27, 90, 63]);
});

test("beatsFor: wagers reset on a new street", () => {
  const events: HandEvent[] = [
    { type: "bot", code: "B27" },
    { type: "card", card: "2c" },
    { type: "bot", code: "B18" },
  ];
  assert.deepEqual(chipsOf(events), [27, 18]);
});

test("beatsFor: a showdown reveals then pushes the pot", () => {
  const events: HandEvent[] = [
    { type: "end", key: "", end: { pre: [], tb: [0, 0], k: "sd" } },
  ];
  assert.deepEqual(beatsFor(events, 1), [
    { kind: "showdown", ms: BEAT_MS.showdown },
    { kind: "pot-push", ms: BEAT_MS.potPush },
  ]);
});

test("beatsFor: a fold pushes the pot without a showdown", () => {
  for (const k of ["f", "bf"] as const) {
    const events: HandEvent[] = [
      { type: "end", key: "", end: { pre: [], tb: [0, 0], k } },
    ];
    assert.deepEqual(beatsFor(events, 1), [
      { kind: "pot-push", ms: BEAT_MS.potPush },
    ]);
  }
});

test("beatsFor: a bot event is the villain whichever side the hero is on", () => {
  const events: HandEvent[] = [{ type: "bot", code: "B27" }];
  const think = { kind: "think", seat: "villain", ms: BEAT_MS.think };
  assert.deepEqual(beatsFor(events, 0)[0], think);
  assert.deepEqual(beatsFor(events, 1)[0], think);
});

test("beatsFor: hero out of position wagers against the right column", () => {
  // hero = 0 (OOP). tb is [OOP, IP], so the villain's wager is tb[1].
  const events: HandEvent[] = [
    { type: "bot", code: "B27" },
    { type: "decision", key: "", node: node({ a: ["F", "C"], tb: [0, 27] }), chosen: 1 },
  ];
  assert.deepEqual(chipsOf(events, 0), [27, 27]);
});

test("beatsFor: every beat carries a positive duration", () => {
  const events: HandEvent[] = [
    { type: "bot", code: "B27" },
    { type: "card", card: "2c" },
    { type: "end", key: "", end: { pre: [], tb: [0, 0], k: "sd" } },
  ];
  for (const beat of beatsFor(events, 1)) assert.ok(beat.ms > 0, beat.kind);
});

test("beatsFor: is pure — the same events always produce the same beats", () => {
  const events: HandEvent[] = [
    { type: "bot", code: "B27" },
    { type: "decision", key: "", node: node({ a: ["F", "C"], tb: [27, 0] }), chosen: 1 },
    { type: "card", card: "2c" },
  ];
  assert.deepEqual(beatsFor(events, 1), beatsFor(events, 1));
});

test("streetBets: a bet sits in front of the seat that made it", () => {
  const beats = beatsFor([{ type: "bot", code: "B27" }], 1);
  assert.deepEqual(streetBets(beats), { hero: 0, villain: 27 });
});

test("streetBets: a call brings both seats level", () => {
  const beats = beatsFor([
    { type: "bot", code: "B27" },
    { type: "decision", key: "", node: node({ a: ["F", "C"], tb: [27, 0] }), chosen: 1 },
  ], 1);
  assert.deepEqual(streetBets(beats), { hero: 27, villain: 27 });
});

test("streetBets: a new street clears what is in front of both seats", () => {
  const beats = beatsFor([
    { type: "bot", code: "B27" },
    { type: "card", card: "2c" },
  ], 1);
  assert.deepEqual(streetBets(beats), { hero: 0, villain: 0 });
});

test("streetBets: pushing the pot clears the felt", () => {
  const beats = beatsFor([
    { type: "bot", code: "B27" },
    { type: "end", key: "", end: { pre: [], tb: [27, 0], k: "bf" } },
  ], 1);
  assert.deepEqual(streetBets(beats), { hero: 0, villain: 0 });
});

test("streetBets: only counts beats actually revealed so far", () => {
  const beats = beatsFor([{ type: "bot", code: "B27" }], 1);
  // Nothing revealed yet — the felt must be empty, not pre-loaded.
  assert.deepEqual(streetBets(beats.slice(0, 1)), { hero: 0, villain: 0 });
  assert.deepEqual(streetBets(beats.slice(0, 2)), { hero: 0, villain: 27 });
});
