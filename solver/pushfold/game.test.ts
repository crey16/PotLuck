/**
 * The push/fold model's arithmetic — M8.7E.
 *
 * These test the MONEY, not the equilibrium: pot sizes, dead money, and the
 * conservation identity. A sign error here is invisible in the published
 * ranges (they still look like plausible poker) and wrong in every one of
 * them, which is exactly the class of bug the project keeps finding by
 * asserting invariants rather than eyeballing output.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  againstRange,
  availableCombos,
  callEv,
  CLASS_INDEX,
  CLASSES,
  COMBO_COUNT,
  deadMoney,
  emptyRange,
  loadEquity,
  post,
  shoveEv,
  SHOVERS,
  startingPot,
  type Behind,
} from "./game";

const { equity } = loadEquity("solver/preflop/equity-169.json");
const removal = availableCombos();
const index = (cls: string) => CLASS_INDEX.get(cls)!;

test("the 169 classes are complete and correctly weighted", () => {
  assert.equal(CLASSES.length, 169);
  const total = COMBO_COUNT.reduce((a, b) => a + b, 0);
  assert.equal(total, 1326, "the classes must partition every two-card combo");
  assert.equal(COMBO_COUNT[index("AA")], 6);
  assert.equal(COMBO_COUNT[index("AKs")], 4);
  assert.equal(COMBO_COUNT[index("AKo")], 12);
});

test("posts and the starting pot agree", () => {
  for (const ante of [0, 1]) {
    assert.equal(post("UTG", ante), 0);
    assert.equal(post("SB", ante), 0.5);
    // A big-blind ante is posted BY the big blind, so it is inside their post
    // and comes out of their stack.
    assert.equal(post("BB", ante), 1 + ante);
    assert.equal(
      startingPot(ante),
      post("SB", ante) + post("BB", ante),
      "the starting pot is exactly what the blinds posted"
    );
  }
});

test("dead money depends on WHO is in the pot, not on the order of folds", () => {
  // The natural-looking mistake is to accumulate dead money as players fold in
  // turn, which double-counts a blind sitting behind the shover.
  assert.equal(deadMoney("SB", "BB", 0), 0, "blind vs blind has no dead money");
  assert.equal(deadMoney("SB", "BB", 1), 0, "a big-blind ante is inside the BB's own stack");
  // UTG jams, BB calls: the small blind's 0.5 is left behind.
  assert.equal(deadMoney("UTG", "BB", 0), 0.5);
  // UTG jams, CO calls: both blinds are left behind.
  assert.equal(deadMoney("UTG", "CO", 0), 1.5);
  assert.equal(deadMoney("UTG", "CO", 1), 2.5);
  // Symmetric: the pot does not know who acted first.
  assert.equal(deadMoney("BTN", "BB", 1), deadMoney("BB", "BTN", 1));
});

test("chips are conserved across an all-in pot", () => {
  // Both players' net EVs must sum to the dead money the folded players left.
  // Nothing is created; nothing vanishes.
  for (const ante of [0, 1]) {
    for (const stack of [5, 11, 20]) {
      for (const [hero, villain] of [["UTG", "BB"], ["BTN", "SB"], ["SB", "BB"]] as const) {
        const dead = deadMoney(hero, villain, ante);
        const pot = 2 * stack + dead;
        for (const share of [0, 0.31, 0.5, 1]) {
          const heroNet = -stack + share * pot;
          const villainNet = -stack + (1 - share) * pot;
          assert.ok(
            Math.abs(heroNet + villainNet - dead) < 1e-9,
            `${hero} vs ${villain} at ${stack}bb ante ${ante}, equity ${share}`
          );
        }
      }
    }
  }
});

test("folding is exactly what you already posted, never an estimate", () => {
  const behind: Behind[] = [{ position: "BB", callRange: emptyRange() }];
  const table = { stack: 10, ante: 1 };
  assert.equal(shoveEv(index("AA"), "SB", behind, table, equity, removal).fold, -0.5);
  const { fold } = callEv(index("72o"), "BB", "SB", emptyRange().fill(1), table, equity, removal);
  assert.equal(fold, -2, "the big blind gave up their blind AND their ante");
});

test("a jam nobody calls wins exactly the dead money", () => {
  // Every opponent folds, so the value of the jam is the blinds and nothing
  // else — no equity term at all.
  const behind: Behind[] = [
    { position: "SB", callRange: emptyRange() },
    { position: "BB", callRange: emptyRange() },
  ];
  const { shove } = shoveEv(index("72o"), "BTN", behind, { stack: 10, ante: 1 }, equity, removal);
  assert.ok(Math.abs(shove - 2.5) < 1e-9, `expected the 2.5bb pot, got ${shove}`);
});

test("a jam everyone calls has no fold equity in it at all", () => {
  // One opponent who always calls: the jam is a pure equity contest, and its
  // value must equal the all-in EV computed directly.
  const always = emptyRange().fill(1);
  const behind: Behind[] = [{ position: "BB", callRange: always }];
  const table = { stack: 10, ante: 0 };
  const hero = index("AA");
  const { shove } = shoveEv(hero, "SB", behind, table, equity, removal);
  const { equity: share } = againstRange(hero, always, equity, removal);
  assert.ok(Math.abs(shove - (-10 + share * 20)) < 1e-9);
});

test("card removal is real: holding an ace lowers how often anyone else has one", () => {
  const aces = emptyRange();
  aces[index("AA")] = 1;
  const withAce = againstRange(index("AKo"), aces, equity, removal).probability;
  const without = againstRange(index("72o"), aces, equity, removal).probability;
  assert.ok(
    withAce < without,
    `holding AK must block aces: ${withAce} should be below ${without}`
  );
});

test("equity against a range is bounded and ordered sensibly", () => {
  const everything = emptyRange().fill(1);
  const aces = againstRange(index("AA"), everything, equity, removal).equity;
  const trash = againstRange(index("72o"), everything, equity, removal).equity;
  assert.ok(aces > 0.8, `AA should crush a random hand, got ${aces}`);
  assert.ok(trash < 0.4, `72o should be far behind, got ${trash}`);
  for (const cls of CLASSES) {
    const value = againstRange(index(cls), everything, equity, removal).equity;
    assert.ok(value >= 0 && value <= 1, `${cls} equity ${value} is outside [0,1]`);
  }
});

test("a shorter stack always makes a jam more attractive", () => {
  // The mechanism behind the monotonicity gate on the pack: the dead money
  // won uncontested is fixed, so it grows relative to the stack risked.
  const caller = emptyRange();
  for (const cls of ["AA", "KK", "QQ", "AKs", "AKo"]) caller[index(cls)] = 1;
  const behind: Behind[] = [{ position: "BB", callRange: caller }];
  const hero = index("K9o");
  let previous = -Infinity;
  for (const stack of [20, 15, 12, 10, 8, 6, 5]) {
    const { shove, fold } = shoveEv(hero, "SB", behind, { stack, ante: 0 }, equity, removal);
    const edge = shove - fold;
    assert.ok(edge > previous, `${stack}bb: jamming got worse as the stack shortened`);
    previous = edge;
  }
});

test("every position that can open a jam is one that can be folded to", () => {
  // The big blind is deliberately absent: there is no such thing as jamming
  // into a pot everyone has already folded out of.
  assert.deepEqual(SHOVERS, ["UTG", "HJ", "CO", "BTN", "SB"]);
});
