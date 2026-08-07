import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  allocate,
  buildSet,
  canonical,
  enumerateClasses,
  stratify,
  stratumOf,
} from "./build";

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const card = (s: string) => (RANKS.indexOf(s[0]) << 2) | SUITS.indexOf(s[1]);
const flop = (s: string) => [card(s.slice(0, 2)), card(s.slice(2, 4)), card(s.slice(4, 6))];

test("22,100 flops collapse to exactly 1,755 suit-isomorphic classes", () => {
  // The standard figure, and the reason the canonical form minimises over all
  // 24 suit permutations rather than relabelling by first appearance. That
  // cheaper form yields 1,911 — it splits boards whose top two cards pair,
  // because their relative order is arbitrary.
  const { classes, totalFlops } = enumerateClasses();
  assert.equal(totalFlops, 22_100);
  assert.equal(classes.length, 1_755);
  assert.equal(
    classes.reduce((sum, c) => sum + c.count, 0),
    22_100,
    "every concrete flop must belong to exactly one class"
  );
});

test("canonical form is invariant under every suit permutation", () => {
  // The property that makes the class weights exact. Checked on the boards
  // that broke the naive form: a paired top, and a pair matched by the kicker.
  const cases = ["AsAhKh", "AsAhKs", "AsKhQd", "Ts9s5h", "8h8c3s", "QsQhQd", "Qs8s3s"];
  for (const board of cases) {
    const base = canonical(flop(board));
    // Every relabelling of the same board must produce the same canonical form.
    for (const perm of [
      { c: "d", d: "c", h: "s", s: "h" },
      { c: "h", d: "s", h: "c", s: "d" },
      { c: "s", d: "h", h: "d", s: "c" },
      { c: "c", d: "h", h: "d", s: "s" },
    ]) {
      const relabelled = board.replace(/[cdhs]/g, (x) => perm[x as keyof typeof perm]);
      assert.equal(canonical(flop(relabelled)), base, `${board} vs ${relabelled}`);
    }
  }
});

test("the specific boards the naive canonicalisation split are one class", () => {
  // {A(s) A(h) K(h)} and {A(s) A(h) K(s)} differ only by swapping hearts and
  // spades. Any form that separates them double-counts the class and halves
  // its weight in the sample.
  assert.equal(canonical(flop("AsAhKh")), canonical(flop("AsAhKs")));
  assert.equal(canonical(flop("2s2hKh")), canonical(flop("2s2hKs")));
});

test("the six reachable strata cover every class, with the right shares", () => {
  const { classes, totalFlops } = enumerateClasses();
  const strata = stratify(classes, totalFlops);
  assert.equal(strata.length, 6, "monotone implies unpaired; trips implies rainbow");
  assert.ok(Math.abs(strata.reduce((s, x) => s + x.probability, 0) - 1) < 1e-12);

  const share = (key: string) => strata.find((s) => s.key === key)!.probability;
  // Sanity against the distribution measured independently from raw enumeration.
  assert.ok(Math.abs(share("two-tone/unpaired") - 0.4659) < 0.001);
  assert.ok(Math.abs(share("rainbow/unpaired") - 0.3106) < 0.001);
  assert.ok(Math.abs(share("rainbow/trips") - 0.0024) < 0.001);
  // Impossible combinations must not appear at all.
  for (const impossible of ["monotone/paired", "monotone/trips", "two-tone/trips"]) {
    assert.equal(strata.find((s) => s.key === impossible), undefined, impossible);
  }
});

test("every stratum gets at least one representative, at every set size", () => {
  // The whole point. The shipped 25-flop set has ZERO two-tone/paired boards,
  // which is 8.5% of all flops contributing nothing to the estimate while its
  // probability mass sits unaccounted for.
  const { classes, totalFlops } = enumerateClasses();
  const strata = stratify(classes, totalFlops);
  for (const n of [12, 25, 49, 100, 184]) {
    const counts = allocate(strata, n);
    assert.equal([...counts.values()].reduce((a, b) => a + b, 0), n, `set-${n} size`);
    for (const s of strata) {
      assert.ok(counts.get(s.key)! >= 1, `set-${n} left ${s.key} unrepresented`);
    }
  }
});

test("a set smaller than the number of strata is refused, not silently skewed", () => {
  const { classes, totalFlops } = enumerateClasses();
  assert.throws(() => allocate(stratify(classes, totalFlops), 5), /at least one representative/);
});

test("weights sum to 1 and no board appears twice", () => {
  for (const n of [12, 25, 49, 100]) {
    const { flops } = buildSet(n);
    assert.equal(flops.length, n);
    const sum = flops.reduce((t, f) => t + f.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `set-${n} weights sum to ${sum}`);
    assert.equal(new Set(flops.map((f) => f.flop)).size, n, `set-${n} has a duplicate board`);
    for (const f of flops) assert.ok(f.weight > 0);
  }
});

test("the set's texture composition matches the truth it is sampling", () => {
  // The gate the shipped set fails: two-tone is 55.1% of flops and 16.0% of
  // that sample. A weighted set must match by construction.
  const { classes, totalFlops } = enumerateClasses();
  const strata = stratify(classes, totalFlops);
  const truth = new Map(strata.map((s) => [s.key, s.probability]));
  for (const n of [25, 49, 100]) {
    const { flops } = buildSet(n);
    const got = new Map<string, number>();
    for (const f of flops) got.set(f.stratum, (got.get(f.stratum) ?? 0) + f.weight);
    for (const [key, want] of truth) {
      assert.ok(
        Math.abs((got.get(key) ?? 0) - want) < 1e-9,
        `set-${n}: ${key} carries ${got.get(key)} of the weight, should be ${want}`
      );
    }
  }
});

test("sets are deterministic — the same size rebuilds the same boards", () => {
  // A published pack names the flop set it came from, so a set must be
  // reproducible from its size alone or that reference means nothing.
  for (const n of [25, 49]) {
    assert.deepEqual(buildSet(n).flops, buildSet(n).flops);
  }
});

test("the committed set files match what the builder produces now", () => {
  // Same drift guard as the push/fold bundled table: a checked-in artifact
  // that stops matching its generator is worse than no artifact.
  for (const n of [12, 25, 49, 100]) {
    const onDisk = JSON.parse(readFileSync(`solver/flops/set-${n}.json`, "utf8"));
    assert.deepEqual(onDisk.flops, buildSet(n).flops, `set-${n}.json is stale`);
    assert.equal(onDisk.total_flops, 22_100);
    assert.equal(onDisk.classes, 1_755);
  }
});

test("every emitted board is a legal, parseable flop", () => {
  const { flops } = buildSet(100);
  for (const { flop: board } of flops) {
    assert.match(board, /^([2-9TJQKA][cdhs]){3}$/, board);
    const cards = flop(board);
    assert.equal(new Set(cards).size, 3, `${board} repeats a card`);
    assert.equal(canonical(cards), board, `${board} is not in canonical form`);
  }
});

test("classification agrees with the stratum key", () => {
  const { classes } = enumerateClasses();
  for (const c of classes) {
    assert.equal(stratumOf(c), `${c.suitedness}/${c.pairing}`);
    if (c.suitedness === "monotone") assert.equal(c.pairing, "unpaired");
    if (c.pairing === "trips") assert.equal(c.suitedness, "rainbow");
    assert.ok(c.ranks[0] >= c.ranks[1] && c.ranks[1] >= c.ranks[2], "ranks must be sorted high to low");
  }
});
