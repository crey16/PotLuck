import assert from "node:assert/strict";
import { mulberry32 } from "../rng.js";
import { gradeAnswer } from "../grade.js";
import type { DrillKind, DrillLevel, Generator, OppMode } from "../contract.js";

const LEVELS: DrillLevel[] = [1, 2, 3];
const MODES: OppMode[] = ["unknown", "shown"];

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
        assert.equal(q.options.length, q.layout === "two" ? 2 : 4, `${where}: ${q.options.length} options for layout ${q.layout}`);
        const corrects = q.options.filter((o) => gradeAnswer(q, o.value) === "correct");
        assert.equal(corrects.length, 1, `${where}: ${corrects.length} options grade as correct`);

        // The explanation must actually explain something.
        const ex = q.explain(q.answer);
        assert.ok(ex.rows.length + ex.notes.length > 0, `${where}: empty explanation`);

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
