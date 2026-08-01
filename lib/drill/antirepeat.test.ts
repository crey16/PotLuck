import test from "node:test";
import assert from "node:assert/strict";
import { generateFresh, pushSignature, questionSignature, REPEAT_WINDOW } from "./antirepeat";
import { mulberry32 } from "./rng";
import type { DrillContext, DrillQuestion, Generator } from "./contract";

/** A stub generator whose signature is just the next integer from the rng. */
const stub = (space: number): Generator => (ctx: DrillContext): DrillQuestion => {
  const n = Math.floor(ctx.rng() * space);
  return {
    kind: "concepts",
    kicker: "stub",
    prompt: "stub",
    body: [],
    options: [{ label: "x", value: "x" }],
    answer: "x",
    layout: "one",
    explain: () => ({ rows: [], notes: [] }),
    payload: { level: ctx.level, oppMode: ctx.oppMode, n },
    signature: `s${n}`,
  };
};

test("questionSignature: prefers the explicit signature, falls back to the payload", () => {
  const ctx: DrillContext = { level: 1, oppMode: "unknown", rng: mulberry32(1) };
  const q = stub(10)(ctx);
  assert.equal(questionSignature(q), q.signature);
  delete q.signature;
  assert.equal(questionSignature(q), JSON.stringify(q.payload));
});

test("generateFresh: returns the first roll when it is not recent", () => {
  const ctx: DrillContext = { level: 1, oppMode: "unknown", rng: mulberry32(5) };
  const direct = stub(1000)({ level: 1, oppMode: "unknown", rng: mulberry32(5) });
  const fresh = generateFresh(stub(1000), ctx, new Set());
  assert.equal(questionSignature(fresh), questionSignature(direct));
});

test("generateFresh: re-rolls past recent signatures", () => {
  // Signature space of 3; two of them recent — the result must be the third.
  const recent = new Set(["s0", "s1"]);
  for (let seed = 1; seed <= 30; seed++) {
    const ctx: DrillContext = { level: 1, oppMode: "unknown", rng: mulberry32(seed) };
    const q = generateFresh(stub(3), ctx, recent);
    assert.equal(questionSignature(q), "s2", `seed ${seed}`);
  }
});

test("generateFresh: terminates when every signature is recent", () => {
  const recent = new Set(["s0", "s1", "s2"]);
  const ctx: DrillContext = { level: 1, oppMode: "unknown", rng: mulberry32(9) };
  const q = generateFresh(stub(3), ctx, recent);
  assert.ok(recent.has(questionSignature(q)), "exhausted space must still return a question");
});

test("generateFresh: is deterministic in (seed, window)", () => {
  const recent = new Set(["s0", "s1", "s4", "s7"]);
  const a = generateFresh(stub(10), { level: 2, oppMode: "unknown", rng: mulberry32(42) }, recent);
  const b = generateFresh(stub(10), { level: 2, oppMode: "unknown", rng: mulberry32(42) }, recent);
  assert.deepEqual(a.payload, b.payload);
});

test("pushSignature: appends, dedupes and trims to the cap", () => {
  let w: string[] = [];
  w = pushSignature(w, "a");
  w = pushSignature(w, "b");
  w = pushSignature(w, "a"); // moves to the end, no duplicate
  assert.deepEqual(w, ["b", "a"]);
  for (let i = 0; i < REPEAT_WINDOW + 10; i++) w = pushSignature(w, `x${i}`);
  assert.equal(w.length, REPEAT_WINDOW);
  assert.equal(w[w.length - 1], `x${REPEAT_WINDOW + 9}`);
});
