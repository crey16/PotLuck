import test from "node:test";
import assert from "node:assert/strict";

import { DRILL_KINDS } from "./contract";
import type { DrillKind, DrillLevel, OppMode, ViewBlock } from "./contract";
import {
  GENERATORS,
  REGISTERED_KINDS,
  KIND_LABELS,
  TAB_LABELS,
  TAB_ORDER,
  pickMixedKind,
  drillHref,
} from "./registry";
import { gradeAnswer, isRight } from "./grade";
import { mulberry32 } from "./rng";

const LEVELS: DrillLevel[] = [1, 2, 3];
const MODES: OppMode[] = ["unknown", "shown"];
const SEEDS = 25;

/** Same allowed option counts assertions.ts uses — kept in sync, not duplicated logic. */
const OPTIONS_PER_LAYOUT: Record<string, number[]> = {
  one: [4],
  two: [2],
  grid3: [3, 4],
};

const KNOWN_BLOCK_TYPES = new Set(["felt", "hand", "money", "grid", "text"]);

test("1. every drill kind is registered", () => {
  const registered = new Set(REGISTERED_KINDS());
  const declared = new Set(DRILL_KINDS);
  assert.equal(registered.size, declared.size);
  for (const k of declared) assert.ok(registered.has(k), `${k} missing from REGISTERED_KINDS()`);
  for (const k of registered) assert.ok(declared.has(k), `${k} registered but not a declared DrillKind`);
});

test("2. every kind has a non-empty label and a tab position", () => {
  for (const k of DRILL_KINDS) {
    assert.ok(KIND_LABELS[k] && KIND_LABELS[k].length > 0, `${k}: missing/empty KIND_LABELS`);
    assert.ok(TAB_ORDER.includes(k), `${k}: missing from TAB_ORDER`);
    assert.ok(TAB_LABELS[k] && TAB_LABELS[k].length > 0, `${k}: missing/empty TAB_LABELS`);
  }
});

test("3. TAB_ORDER is coherent: mixed + reference once each, every kind once, no unknowns/dupes", () => {
  const counts = new Map<string, number>();
  for (const id of TAB_ORDER) counts.set(id, (counts.get(id) ?? 0) + 1);

  assert.equal(counts.get("mixed"), 1, "mixed must appear exactly once");
  assert.equal(counts.get("reference"), 1, "reference must appear exactly once");

  for (const k of DRILL_KINDS) {
    assert.equal(counts.get(k), 1, `${k} must appear exactly once in TAB_ORDER`);
  }

  const knownIds = new Set<string>(["mixed", "reference", ...DRILL_KINDS]);
  for (const id of TAB_ORDER) assert.ok(knownIds.has(id), `unknown TAB_ORDER entry: ${id}`);

  assert.equal(TAB_ORDER.length, DRILL_KINDS.length + 2, "TAB_ORDER length must be kinds + mixed + reference");
});

test("4+5+6. every generator produces a valid, gradeable question across level x oppMode x seed", () => {
  for (const kind of DRILL_KINDS) {
    const generate = GENERATORS[kind];
    for (const level of LEVELS) {
      for (const oppMode of MODES) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const where = `${kind} L${level} ${oppMode} seed ${seed}`;
          const q = generate({ level, oppMode, rng: mulberry32(seed) });

          // kind matches registry key
          assert.equal(q.kind, kind, `${where}: q.kind mismatch`);

          // gradeable: chosen === answer grades correct
          assert.equal(gradeAnswer(q, q.answer), "correct", `${where}: answer does not grade correct`);

          // options: non-empty labels
          for (const o of q.options) {
            assert.ok(typeof o.label === "string" && o.label.length > 0, `${where}: empty/invalid option label`);
          }

          // exactly one option grades as correct
          const corrects = q.options.filter((o) => gradeAnswer(q, o.value) === "correct");
          assert.equal(corrects.length, 1, `${where}: ${corrects.length} options grade as correct`);

          // option count agrees with layout
          const allowed = OPTIONS_PER_LAYOUT[q.layout];
          assert.ok(allowed, `${where}: unknown layout "${q.layout}"`);
          assert.ok(
            allowed.includes(q.options.length),
            `${where}: ${q.options.length} options for layout "${q.layout}" (expected one of ${allowed.join(" or ")})`
          );

          // prompt & kicker non-empty
          assert.ok(q.prompt.length > 0, `${where}: empty prompt`);
          assert.ok(q.kicker.length > 0, `${where}: empty kicker`);

          // explanation has content
          const ex = q.explain(q.answer);
          assert.ok(ex.rows.length + ex.notes.length > 0, `${where}: empty explanation`);

          // payload carries level/oppMode and round-trips through JSON
          assert.equal(q.payload.level, level, `${where}: payload.level mismatch`);
          assert.equal(q.payload.oppMode, oppMode, `${where}: payload.oppMode mismatch`);
          assert.deepEqual(
            JSON.parse(JSON.stringify(q.payload)),
            q.payload,
            `${where}: payload not JSON-clean`
          );
        }
      }
    }
  }
});

test("7. acceptable is used only by preflop; when set, gradeAnswer/isRight treat it as right", () => {
  for (const kind of DRILL_KINDS) {
    const generate = GENERATORS[kind];
    for (const level of LEVELS) {
      for (const oppMode of MODES) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const where = `${kind} L${level} ${oppMode} seed ${seed}`;
          const q = generate({ level, oppMode, rng: mulberry32(seed) });

          // Only two kinds legitimately have more than one right answer:
          // preflop (mixed strategies — every action the solver takes at
          // >= 20%) and concepts (one bank item pairs the canonical answer
          // with a differently-worded option stating the same conclusion).
          // Any other kind offering an alternative means two options grade
          // as right when exactly one should.
          if (kind !== "preflop" && kind !== "concepts") {
            assert.ok(
              q.acceptable === undefined || q.acceptable.length === 0,
              `${where}: ${kind} has non-empty acceptable`
            );
          }

          if (q.acceptable && q.acceptable.length > 0) {
            for (const v of q.acceptable) {
              assert.equal(gradeAnswer(q, v), "acceptable", `${where}: acceptable value ${v} does not grade acceptable`);
              assert.equal(isRight(q, v), true, `${where}: acceptable value ${v} is not isRight`);
            }
          }
        }
      }
    }
  }
});

test("8. pickMixedKind reaches every registered kind and never returns an unregistered one", () => {
  const registered = new Set(REGISTERED_KINDS());
  const seen = new Set<DrillKind>();
  const N = 500;
  const rng = mulberry32(999);
  for (let i = 0; i < N; i++) {
    const k = pickMixedKind(rng);
    assert.ok(registered.has(k), `pickMixedKind returned unregistered kind: ${k}`);
    seen.add(k);
  }
  for (const k of registered) {
    assert.ok(seen.has(k), `pickMixedKind never returned ${k} over ${N} draws`);
  }
});

test("9. every ViewBlock emitted (body + explain blocks) is a known variant", () => {
  const badTypes = new Set<string>();
  for (const kind of DRILL_KINDS) {
    const generate = GENERATORS[kind];
    for (const level of LEVELS) {
      for (const oppMode of MODES) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const q = generate({ level, oppMode, rng: mulberry32(seed) });
          const blocks: ViewBlock[] = [...q.body, ...(q.explain(q.answer).blocks ?? [])];
          for (const b of blocks) {
            if (!KNOWN_BLOCK_TYPES.has(b.type)) {
              badTypes.add(`${kind}: ${b.type}`);
            }
          }
        }
      }
    }
  }
  assert.equal(badTypes.size, 0, `unknown ViewBlock types found: ${[...badTypes].join(", ")}`);
});

test("10. determinism across the registry: same seed/context -> deeply-equal payload and answer, twice", () => {
  for (const kind of DRILL_KINDS) {
    const generate = GENERATORS[kind];
    for (const level of LEVELS) {
      for (const oppMode of MODES) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const where = `${kind} L${level} ${oppMode} seed ${seed}`;
          const a = generate({ level, oppMode, rng: mulberry32(seed) });
          const b = generate({ level, oppMode, rng: mulberry32(seed) });
          assert.deepEqual(a.payload, b.payload, `${where}: payload not deterministic`);
          assert.equal(a.answer, b.answer, `${where}: answer not deterministic`);
          assert.deepEqual(a.options, b.options, `${where}: options not deterministic`);
        }
      }
    }
  }
});

/**
 * The drill switcher writes the current drill into the URL so a refresh,
 * bookmark or shared link lands back on the same drill. That only works if
 * what the client WRITES is what the server page ACCEPTS: app/drill/page.tsx
 * keeps `?tab=` only when the value is in TAB_ORDER and otherwise silently
 * falls back to "mixed". A helper both sides share is what keeps the two from
 * drifting — the home page's drill cards link with the same function.
 */
test("drillHref: every drill's URL round-trips through the page's own parsing", () => {
  const parse = (href: string): string => {
    const tab = new URL(href, "http://localhost").searchParams.get("tab");
    return tab && (TAB_ORDER as string[]).includes(tab) ? tab : "mixed";
  };
  for (const tab of TAB_ORDER) {
    assert.equal(parse(drillHref(tab)), tab, `${tab} must survive the round trip`);
  }
});

test("drillHref: points at the drill route", () => {
  assert.equal(drillHref("outs"), "/drill?tab=outs");
  assert.equal(drillHref("mixed"), "/drill?tab=mixed");
});
