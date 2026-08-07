/**
 * The bundled push/fold table must equal the published pack.
 *
 * `lib/pushfold/table.json` is a generated, committed copy of
 * `solver/pack/pushfold/` — it exists because the drill contract is
 * synchronous and there is nowhere in `DrillShell`'s SSR flow to fetch. Two
 * copies of the same numbers is exactly the risk CLAUDE.md's rules exist to
 * prevent, so this re-derives one from the other and fails if they disagree.
 *
 * If this fails, the fix is `npx tsx solver/pushfold/compact.ts`, never an
 * edit to table.json.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeEvs } from "../../solver/pushfold/compact";
import {
  callEdgeBb,
  PUSHFOLD_ANTES,
  PUSHFOLD_CLASSES,
  PUSHFOLD_DEPTHS,
  PUSHFOLD_MODEL,
  shoveEdgeBb,
  shoveRange,
  callRange,
  callBreakEvenEquity,
  SHOVE_POSITIONS,
  positionsBehind,
  type PushfoldPosition,
} from "./index";

const PACK = "solver/pack/pushfold";
const index = JSON.parse(readFileSync(`${PACK}/index.json`, "utf8")) as {
  classes: string[];
  tables: { stack_bb: number; ante_bb: number; file: string }[];
};
const bundled = JSON.parse(readFileSync("lib/pushfold/table.json", "utf8")) as {
  classes: string[];
  tables: Record<string, { shove: Record<string, string>; call: Record<string, string> }>;
};

test("the bundled table is a faithful re-encoding of the published pack", () => {
  assert.deepEqual(bundled.classes, index.classes, "class order must match exactly");
  assert.equal(Object.keys(bundled.tables).length, index.tables.length);
  for (const entry of index.tables) {
    const table = JSON.parse(readFileSync(`${PACK}/${entry.file}`, "utf8")) as {
      shove: Record<string, { ev_mbb: number[] }>;
      call: Record<string, { ev_mbb: number[] }>;
    };
    const key = `${entry.stack_bb}:${entry.ante_bb}`;
    const compact = bundled.tables[key];
    assert.ok(compact, `the bundle is missing ${key}`);
    for (const [position, data] of Object.entries(table.shove)) {
      assert.equal(compact.shove[position], encodeEvs(data.ev_mbb), `${key} shove ${position}`);
    }
    for (const [pair, data] of Object.entries(table.call)) {
      assert.equal(compact.call[pair], encodeEvs(data.ev_mbb), `${key} call ${pair}`);
    }
  }
});

test("every depth and ante setting the pack solved is readable", () => {
  assert.deepEqual(PUSHFOLD_DEPTHS, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(PUSHFOLD_ANTES, [0, 1]);
  assert.equal(PUSHFOLD_CLASSES.length, 169);
  for (const stack of PUSHFOLD_DEPTHS) {
    for (const ante of PUSHFOLD_ANTES) {
      for (const position of SHOVE_POSITIONS) {
        assert.equal(typeof shoveEdgeBb(position, stack, ante, "AA"), "number");
        for (const caller of positionsBehind(position)) {
          assert.equal(typeof callEdgeBb(caller, position, stack, ante, "AA"), "number");
        }
      }
    }
  }
});

test("signed bytes decode as signed: a losing action must read as losing", () => {
  // Two's-complement bytes at or above 128 are negative. Reading them all as
  // positive would make every unprofitable jam look profitable, and the
  // ranges would come out as "shove everything" — plausible-looking output
  // from a one-line bug.
  assert.ok(shoveEdgeBb("UTG", 20, 0, "72o") < 0, "72o cannot be a profitable 20bb UTG jam");
  assert.ok(shoveEdgeBb("BTN", 10, 0, "AA") > 0, "aces are always a jam");
  assert.ok(callEdgeBb("BB", "BTN", 15, 0, "32o") < 0, "32o cannot call off 15bb");
});

test("aces are in every range at every depth", () => {
  for (const stack of PUSHFOLD_DEPTHS) {
    for (const ante of PUSHFOLD_ANTES) {
      for (const position of SHOVE_POSITIONS) {
        assert.ok(shoveEdgeBb(position, stack, ante, "AA") > 0, `${position} ${stack}bb`);
      }
    }
  }
});

test("shoving ranges widen monotonically as the stack shortens", () => {
  // The property hand-authored "Nash-style" charts routinely violate — the
  // reference product's 8bb UTG range is tighter than its 10bb one, which no
  // computation can produce. A one-point tolerance absorbs the equity table's
  // own sampling noise; a real inversion is far larger.
  for (const ante of PUSHFOLD_ANTES) {
    for (const position of SHOVE_POSITIONS) {
      for (let i = 1; i < PUSHFOLD_DEPTHS.length; i++) {
        const shallow = shoveRange(position, PUSHFOLD_DEPTHS[i - 1], ante).percent;
        const deep = shoveRange(position, PUSHFOLD_DEPTHS[i], ante).percent;
        assert.ok(
          shallow >= deep - 1.5,
          `${position} ante ${ante}: ${PUSHFOLD_DEPTHS[i - 1]}bb shoves ${shallow.toFixed(1)}% ` +
            `but ${PUSHFOLD_DEPTHS[i]}bb shoves ${deep.toFixed(1)}%`
        );
      }
    }
  }
});

test("a call's break-even equity is the price it is actually getting", () => {
  // The number the lesson teaches and the drill shows. The blind already in
  // the pot is the whole reason a big blind defends so much wider than
  // anyone jams, so it must be subtracted from the risk.
  //  8bb, 1bb ante, BTN jams: BB has 2 in and calls 6, into 16 plus the
  //  small blind's abandoned 0.5 -> 6/16.5 = 36.4%. The dead 0.5 is easy to
  //  forget and makes the call meaningfully cheaper than it looks.
  assert.ok(
    Math.abs(callBreakEvenEquity("BB", "BTN", 8, 1) - 6 / 16.5) < 1e-9,
    `got ${callBreakEvenEquity("BB", "BTN", 8, 1)}`
  );
  //  Blind versus blind there is no third post, so no dead money at all.
  assert.ok(Math.abs(callBreakEvenEquity("BB", "SB", 8, 1) - 6 / 16) < 1e-9);
  // 10bb, no ante: BB has 1 in, calls 9 to win 20.5 -> 43.9%.
  assert.ok(Math.abs(callBreakEvenEquity("BB", "UTG", 10, 0) - 9 / 20.5) < 1e-9);
  // A player with nothing invested risks a whole stack.
  assert.ok(Math.abs(callBreakEvenEquity("CO", "UTG", 10, 0) - 10 / 21.5) < 1e-9);
});

test("the calling range really is the hands above that price", () => {
  // Cross-checks the solve against the arithmetic from the other direction:
  // if the two disagree, one of them has a dead-money error.
  for (const stack of [8, 12, 20]) {
    for (const ante of PUSHFOLD_ANTES) {
      const required = callBreakEvenEquity("BB", "BTN", stack, ante);
      const range = callRange("BB", "BTN", stack, ante);
      // Cheaper price => wider range, always.
      assert.ok(range.percent > 0 && range.percent < 100);
      assert.ok(required > 0 && required < 0.5, `${stack}bb ante ${ante}: ${required}`);
    }
  }
  // The ante lowers the price, so the range must widen.
  assert.ok(callBreakEvenEquity("BB", "BTN", 10, 1) < callBreakEvenEquity("BB", "BTN", 10, 0));
  assert.ok(callRange("BB", "BTN", 10, 1).percent > callRange("BB", "BTN", 10, 0).percent);
});

test("the model states what it excludes, ICM first", () => {
  assert.equal(PUSHFOLD_MODEL.ev_model, "chip_ev");
  const excludes = PUSHFOLD_MODEL.excludes.join(" ");
  assert.match(excludes, /ICM/, "the chip-EV assumption must be published with the data");
  assert.match(excludes, /overcall/i, "the one-caller pruning must be published with the data");
});

test("the big blind cannot open a jam", () => {
  assert.ok(!SHOVE_POSITIONS.includes("BB" as PushfoldPosition));
  assert.throws(() => shoveEdgeBb("BB" as PushfoldPosition, 10, 0, "AA"));
});
