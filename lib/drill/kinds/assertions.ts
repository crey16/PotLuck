import assert from "node:assert/strict";
import { mulberry32 } from "../rng";
import { gradeAnswer } from "../grade";
import type { DrillKind, DrillLevel, DrillQuestion, Generator, OppMode } from "../contract";

const LEVELS: DrillLevel[] = [1, 2, 3];
const MODES: OppMode[] = ["unknown", "shown"];

/**
 * The option counts each layout permits.
 *
 * `grid3` is a row of short answers and allows 3 or 4: the money drills build
 * four choices with `buildOpts`, while the preflop drill derives its options
 * from a scenario's legal actions — three for a defence (3-bet/call/fold).
 * `two` is the binary call-or-fold layout; `one` is the single column of
 * long-text concept answers, always four.
 *
 * A count outside these sets is a bug in the generator, not in this expectation.
 */
const OPTIONS_PER_LAYOUT: Record<DrillQuestion["layout"], number[]> = {
  one: [4],
  two: [2],
  grid3: [3, 4],
};

/**
 * Label → payload field for `money` ViewBlock pills formatted as `$N`. Not
 * every label has a payload counterpart (e.g. bluff's "Fold %" or ev's "Your
 * equity" are not dollar pills at all, and some percentage-only labels have
 * no single payload field) — those are skipped rather than asserted on.
 */
const DOLLAR_LABEL_TO_PAYLOAD_KEY: Record<string, string> = {
  "Pot before bet": "potBefore",
  "Pot now": "pot",
  "To call": "call",
  "You already bet": "extra",
  "Villain bets": "bet",
  "Villain raises to": "bet",
  "Your bluff": "bet",
  "Their bet": "bet",
  "Your bet": "bet",
  Pot: "potBefore",
};

/**
 * For every `money` pill: a `$N` value must equal the payload field its label
 * maps to, and an `N% pot` value must equal `Math.round(bet / potBefore *
 * 100)`. This is the shared check behind finding CC-1 — three drills built
 * pills from intermediate variables instead of the values the answer is
 * computed from, and the pills silently disagreed with the payload.
 */
function assertMoneyPillsReconcile(q: DrillQuestion, where: string): void {
  const payload = q.payload as Record<string, unknown>;
  for (const block of q.body) {
    if (block.type !== "money") continue;
    for (const item of block.items) {
      const dollarMatch = /^\$([\d,]+)$/.exec(item.value);
      if (dollarMatch) {
        const key = DOLLAR_LABEL_TO_PAYLOAD_KEY[item.label];
        if (key === undefined) continue;
        const expected = payload[key];
        if (typeof expected !== "number") continue;
        const parsed = Number(dollarMatch[1].replace(/,/g, ""));
        assert.equal(
          parsed,
          Math.round(expected),
          `${where}: pill "${item.label}" is ${item.value} but payload.${key} is ${expected}`
        );
        continue;
      }

      const pctMatch = /^(\d+(?:\.\d+)?)% pot$/.exec(item.value);
      if (pctMatch) {
        const bet = payload["bet"];
        const potBefore = payload["potBefore"];
        if (typeof bet !== "number" || typeof potBefore !== "number") continue;
        const expected = Math.round((bet / potBefore) * 100);
        const parsed = Number(pctMatch[1]);
        assert.equal(
          parsed,
          expected,
          `${where}: pill "${item.label}" is ${item.value} but bet/potBefore rounds to ${expected}% pot`
        );
      }
    }
  }
}

/**
 * The invariants every question of every kind must satisfy, checked across
 * levels, opponent modes and seeds. Called from each kind's test file so the
 * rules live in one place and a new rule reaches all nine kinds at once.
 */
export function assertCommonShape(
  generate: Generator,
  kind: DrillKind,
  opts: { seeds?: number } = {}
): void {
  const seeds = opts.seeds ?? 40;
  for (const level of LEVELS) {
    for (const oppMode of MODES) {
      for (let seed = 1; seed <= seeds; seed++) {
        const where = `${kind} L${level} ${oppMode} seed ${seed}`;
        const q = generate({ level, oppMode, rng: mulberry32(seed) });

        assert.equal(q.kind, kind, where);
        assert.ok(q.prompt.length > 0, `${where}: empty prompt`);
        assert.ok(q.kicker.length > 0, `${where}: empty kicker`);

        // Options: distinct values, non-empty labels, arity matching layout,
        // and exactly one that grades as the canonical correct answer.
        assert.equal(new Set(q.options.map((o) => o.value)).size, q.options.length, `${where}: duplicate option values`);
        for (const o of q.options) assert.ok(o.label.length > 0, `${where}: empty option label`);
        assert.ok(
          OPTIONS_PER_LAYOUT[q.layout].includes(q.options.length),
          `${where}: ${q.options.length} options for layout "${q.layout}" (expected one of ${OPTIONS_PER_LAYOUT[q.layout].join(" or ")})`
        );
        const corrects = q.options.filter((o) => gradeAnswer(q, o.value) === "correct");
        assert.equal(corrects.length, 1, `${where}: ${corrects.length} options grade as correct`);

        // The explanation must actually explain something.
        const ex = q.explain(q.answer);
        assert.ok(ex.rows.length + ex.notes.length > 0, `${where}: empty explanation`);

        // Money pills must agree with the values the answer is computed from.
        assertMoneyPillsReconcile(q, where);

        // Payload: carries the context and survives the trip to Postgres.
        assert.equal(q.payload.level, level, `${where}: payload level`);
        assert.equal(q.payload.oppMode, oppMode, `${where}: payload oppMode`);
        assert.deepEqual(JSON.parse(JSON.stringify(q.payload)), q.payload, `${where}: payload is not JSON-clean`);
      }
    }
  }
}

/** Same seed, same question — the property every generator test relies on. */
export function assertDeterministic(generate: Generator, seed = 31): void {
  const ctx = () => ({ level: 2 as DrillLevel, oppMode: "unknown" as OppMode, rng: mulberry32(seed) });
  const a = generate(ctx());
  const b = generate(ctx());
  assert.deepEqual(a.payload, b.payload);
  assert.equal(a.answer, b.answer);
  assert.deepEqual(a.options, b.options);
}
