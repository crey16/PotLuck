# Milestone 2 — The Full Drill Set: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single outs drill into a nine-module poker trainer with per-drill adaptive difficulty, a face-up opponent mode, per-skill stats, and a written reference tab.

**Architecture:** Every drill is a pure TypeScript generator in `lib/drill/kinds/*.ts` that takes `(ctx: DrillContext)` and returns a data-only `DrillQuestion` — no React, no HTML strings. One `DrillPlayer` component renders any `DrillQuestion` by mapping its `ViewBlock`s onto the UI components M1 already built. One `gradeAnswer` function decides right/also-fine/wrong for all nine kinds. The FastAPI function gains a `skill_stats` upsert inside the existing attempt transaction and one new read endpoint that seeds the difficulty windows from history.

**Tech Stack:** Next.js 16 (App Router, TypeScript), React 19, FastAPI on Vercel Python, Supabase Postgres via the pooler, `node:test` via `tsx` for TS tests, `pytest` for Python.

**Spec:** `docs/superpowers/specs/2026-07-29-milestone-2-design.md`. Read it before Task 1.

## Global Constraints

- **Never modify `~/PycharmProjects/PokerDuolingo`.** Read-only reference.
- **Never edit `supabase/migrations/0001_initial_schema.sql` in place.** New migration files only. (This milestone needs no migration — `attempts` and `skill_stats` already have every column used here.)
- **`lib/poker/` is the tested engine.** If you believe it is wrong, show a failing test first. Never duplicate its math in `lib/drill/`.
- **Nothing goes in `app/api/`.** FastAPI owns `/api`, and the production rewrite in `next.config.ts` (`/api/:path*` → `/api/index`) must stay.
- **One betting convention everywhere:** `pot` = the total pot AFTER villain's bet (what you win). `call` = what it costs you. A function taking the pot before the bet says `potBefore` in the parameter name. Mixing these is the single largest source of wrong answers in this codebase.
- **Never hand-code an out count or an equity.** Derive from `lib/poker/engine.ts`. A test asserting `assert.equal(spot.outs, 9)` on a generated spot is itself a bug.
- **Above 8 outs the ×4 rule overstates.** Use `ruleOf4Corrected` from `lib/poker/math.ts` wherever a corrected figure is shown.
- **Label and count must agree.** In unknown-opponent mode a spot is only dealt if the named draw has exactly the out count `DRAW_OUTS` says it should.
- **Preflop ranges are reference ranges, not solver output**, and must be labelled as such anywhere they are shown.
- **XP is 10 per correct answer, 0 otherwise**, computed only in `api/index.py`. `level = xp // 100 + 1`, computed only in `api/progress.py::recalc_level`. The drill's session Score (`10 × difficulty + streak bonus`) is display-only and never written to the database.
- **Secrets stay in git-ignored `.env.local`.** `SUPABASE_SERVICE_ROLE_KEY` must never reach the browser.
- **Both suites stay green after every task:** `npm test` and `.venv/bin/python -m pytest api/ -q`. Baseline entering this plan: 49 TS tests, 17 pytest, 0 failures.
- **Relative imports carry NO file extension.** Write `from "./contract"`, never `from "./contract.js"`. `tsconfig.json` sets `moduleResolution: "bundler"`, and Turbopack does not rewrite `.js` → `.ts`, so a `.js` extension on a **value** import fails `npm run build` with `Module not found`. (M1 used `.js` and got away with it only because its one such import was type-only and therefore erased before bundling — a trap, not a precedent.) Verified: extensionless resolves correctly under both `tsx --test` and Turbopack.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `refactor:`, `test:`, `docs:`).
- **No `setState` inside `useEffect`.** `eslint-config-next` errors on it (`react-hooks/set-state-in-effect`). Derive during render, initialise with a lazy `useState(() => …)`, set state from event handlers, or reset child state with a `key` prop. Anything the server must agree with (a persisted preference, the first dealt hand) comes down as a prop from the server component — cookies are server-readable, `localStorage` is not.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `lib/drill/contract.ts` | `DrillKind`, `OppMode`, `DrillContext`, `ViewBlock`, `Explain`, `DrillQuestion`, `Generator`. Types only, zero runtime logic. |
| `lib/drill/grade.ts` | `gradeAnswer(question, chosen)` → `"correct" \| "acceptable" \| "wrong"`. The only grader. |
| `lib/drill/difficulty.ts` | `nextLevel(window, current)`, `pushResult(window, ok)`, `emptyWindows()`. Pure. |
| `lib/drill/rng.ts` | `mulberry32(seed)` — deterministic PRNG for tests. |
| `lib/drill/opts.ts` | Shared generator helpers: `pick`, `shuffled`, `roundTo`, `buildOpts`, `intOptsInRange`, `money`, `pct`, `signedMoney`, `withArticle`. |
| `lib/drill/registry.ts` | `GENERATORS: Record<DrillKind, Generator>`, `KIND_LABELS`, `TAB_ORDER`, `pickMixedKind(rng)`. |
| `lib/drill/kinds/outs.ts` … `preflop.ts` | Nine generators, one file each, each with a sibling `.test.ts`. |
| `lib/drill/drillState.ts` | Client fetch of `GET /api/progress/drill-state` + `buildDrillStateRequest`. Fails soft. |
| `components/drill/DrillPlayer.tsx` | Renders any `DrillQuestion`. Owns the answer/feedback/keyboard state machine. |
| `components/drill/DrillTabs.tsx` | Tab strip: Mixed + 9 kinds + Reference. |
| `components/drill/ReferenceTab.tsx` | Static cheat-sheet content. |
| `components/drill/OpponentToggle.tsx` | Unknown / face-up switch, `localStorage`-backed. |
| `components/ui/Pills.tsx` | Renders the `money` ViewBlock (`.potbar` / `.pill`, already styled). |
| `components/ui/RangeGrid.tsx` | Renders the `grid` ViewBlock (13×13, `.grid13` / `.gc` / `.legend`, already styled). |
| `app/drill/page.tsx` | The tabbed drill page (server component → `DrillShell`). |
| `api/skills.py` | `SKILL_TAGS: dict[str, str]` — the only `drill_kind → skill_tag` map. |
| `api/test_skills.py` | Tests for the map and the tag vocabulary. |

**Modified:**

| Path | Change |
|---|---|
| `components/drill/DrillShell.tsx` | Owns active tab, difficulty windows, opponent mode, session stats; renders `DrillTabs` + `DrillPlayer`. |
| `components/drill/OutsDrill.tsx` | **Deleted** in Task 2 — replaced by `kinds/outs.ts` + `DrillPlayer`. |
| `lib/drill/outsQuestion.ts` | **Deleted** in Task 2 — `withArticle`/`buildOpts` move to `opts.ts`, question logic to `kinds/outs.ts`. |
| `lib/drill/outsQuestion.test.ts` | **Deleted** in Task 2 — its assertions move to `opts.test.ts` and `kinds/outs.test.ts`. Nothing is lost. |
| `lib/drill/recordAttempt.ts` | `OutsDrillResult` → `DrillResult` carrying `kind` + `payload`; `drill_kind` widened from the literal `"outs"` to `DrillKind`. |
| `app/drill/outs/page.tsx` | Becomes a permanent redirect to `/drill?tab=outs`. |
| `api/index.py` | `AttemptIn.drill_kind` → `Literal[...]`, `answer` → `max_length`; `skill_stats` upsert; new `GET /api/progress/drill-state`. |
| `package.json` | `test` script picks up `lib/drill/kinds/*.test.ts`. |
| `app/globals.css` | Only if a ported block needs a class that does not exist yet. Most do exist. |

---

## Task 1: Foundation — contract, grading, difficulty, RNG, helpers

Nothing else can start until this lands, and the contract is **frozen** at the end of it. Eight generators are written against it in parallel later; a change after that point costs eight rebases.

**Files:**
- Create: `lib/drill/contract.ts`
- Create: `lib/drill/rng.ts`
- Create: `lib/drill/grade.ts`, `lib/drill/grade.test.ts`
- Create: `lib/drill/difficulty.ts`, `lib/drill/difficulty.test.ts`
- Create: `lib/drill/opts.ts`, `lib/drill/opts.test.ts`
- Modify: `package.json` (test glob)

**Interfaces:**
- Consumes: `lib/poker/engine.ts` (`Card`, `Rng`, `Spot`, `Street`).
- Produces: every type and helper the remaining tasks import. Exact signatures are in Step 3 / Step 5 / Step 9 below.

- [ ] **Step 1: Read the spec**

Read `docs/superpowers/specs/2026-07-29-milestone-2-design.md` end to end, and `reference/poker-math-trainer.html` lines 364–392 (the math and option helpers you are porting).

- [ ] **Step 2: Extend the test glob so new test directories are picked up**

In `package.json`, replace the `test` script:

```json
"test": "tsx --test lib/poker/*.test.ts lib/drill/*.test.ts lib/drill/kinds/*.test.ts lib/supabase/*.test.ts components/ui/*.test.ts"
```

Run `npm test`. Expected: still 49 passing, 0 failing (the new glob matches nothing yet — `tsx --test` tolerates a glob with no matches).

- [ ] **Step 3: Write the contract (types only, no test — types are checked by `tsc`)**

Create `lib/drill/contract.ts`:

```ts
/**
 * The frozen contract every drill generator implements. Data only: no React,
 * no HTML strings, no DOM. That is what lets each generator be unit tested
 * with a seeded Rng and written independently of the renderer.
 */
import type { Card, Rng } from "../poker/engine";

export type DrillKind =
  | "outs" | "rule24" | "potodds" | "decision" | "implied"
  | "ev" | "bluff" | "concepts" | "preflop";

export const DRILL_KINDS: DrillKind[] = [
  "outs", "rule24", "potodds", "decision", "implied",
  "ev", "bluff", "concepts", "preflop",
];

/** "unknown" = you see only your cards and the board. "shown" = villain is face-up. */
export type OppMode = "unknown" | "shown";

export type DrillLevel = 1 | 2 | 3;

export interface DrillContext {
  level: DrillLevel;
  oppMode: OppMode;
  rng: Rng;
}

/** Everything a question is allowed to put on screen. */
export type ViewBlock =
  | { type: "felt"; hero: Card[]; board: Card[]; street: "flop" | "turn"; villain?: Card[] }
  | { type: "hand"; label: string; cards: Card[] }
  | { type: "money"; items: { label: string; value: string }[] }
  | { type: "grid"; scenarioId: string; highlight?: string }
  | { type: "text"; text: string; tone?: "plain" | "warn"; center?: boolean };

export interface ExplainRow { label: string; value: string }
export interface ExplainNote {
  tone: "plain" | "warn" | "good";
  title?: string;
  text: string;
}
export interface Explain {
  rows: ExplainRow[];
  notes: ExplainNote[];
  blocks?: ViewBlock[];
}

export type OptionValue = string | number;
export interface DrillOption { label: string; value: OptionValue }

export interface DrillQuestion {
  kind: DrillKind;
  /** Small caps label, e.g. "Counting outs". */
  kicker: string;
  /** Optional chip beside the kicker, e.g. "Flop". */
  chip?: string;
  prompt: string;
  sub?: string;
  body: ViewBlock[];
  options: DrillOption[];
  /** The canonical correct value. Must appear in `options`. */
  answer: OptionValue;
  /**
   * Additional values that are also defensible — preflop mixed strategies.
   * `answer` need not be repeated here.
   */
  acceptable?: OptionValue[];
  layout: "one" | "two" | "grid3";
  explain: (chosen: OptionValue) => Explain;
  /** Written to attempts.drill_payload. Must be JSON-serialisable and
   *  sufficient to re-derive `answer`. Always carries level and oppMode. */
  payload: Record<string, unknown>;
}

export type Generator = (ctx: DrillContext) => DrillQuestion;
```

- [ ] **Step 4: Create the seeded RNG (no test — it is exercised by every generator test)**

Create `lib/drill/rng.ts`:

```ts
import type { Rng } from "../poker/engine";

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG. Used so every
 * generator test is deterministic: same seed, same hand, forever.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 5: Write the failing test for `gradeAnswer`**

Create `lib/drill/grade.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { gradeAnswer } from "./grade";
import type { DrillQuestion } from "./contract";

function q(over: Partial<DrillQuestion> = {}): DrillQuestion {
  return {
    kind: "preflop",
    kicker: "k",
    prompt: "p",
    body: [],
    options: [
      { label: "Raise", value: "r" },
      { label: "Call", value: "c" },
      { label: "Fold", value: "f" },
    ],
    answer: "r",
    layout: "grid3",
    explain: () => ({ rows: [], notes: [] }),
    payload: {},
    ...over,
  };
}

test("gradeAnswer: the canonical answer is correct", () => {
  assert.equal(gradeAnswer(q(), "r"), "correct");
});

test("gradeAnswer: a non-answer with no acceptable list is wrong", () => {
  assert.equal(gradeAnswer(q(), "f"), "wrong");
});

test("gradeAnswer: a value in acceptable grades as acceptable, not correct", () => {
  assert.equal(gradeAnswer(q({ acceptable: ["c"] }), "c"), "acceptable");
});

test("gradeAnswer: the canonical answer stays 'correct' even if also listed in acceptable", () => {
  assert.equal(gradeAnswer(q({ acceptable: ["r", "c"] }), "r"), "correct");
});

test("gradeAnswer: a value outside answer and acceptable is still wrong", () => {
  assert.equal(gradeAnswer(q({ acceptable: ["c"] }), "f"), "wrong");
});

test("gradeAnswer: numeric answers compare by value", () => {
  const numeric = q({
    options: [{ label: "9", value: 9 }, { label: "8", value: 8 }],
    answer: 9,
    layout: "two",
  });
  assert.equal(gradeAnswer(numeric, 9), "correct");
  assert.equal(gradeAnswer(numeric, 8), "wrong");
});

test("isRight: correct and acceptable both count as right for scoring", async () => {
  const { isRight } = await import("./grade");
  assert.equal(isRight(q(), "r"), true);
  assert.equal(isRight(q({ acceptable: ["c"] }), "c"), true);
  assert.equal(isRight(q(), "f"), false);
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx tsx --test lib/drill/grade.test.ts`
Expected: FAIL — `Cannot find module './grade.js'`.

- [ ] **Step 7: Implement `gradeAnswer`**

Create `lib/drill/grade.ts`:

```ts
import type { DrillQuestion, OptionValue } from "./contract";

export type Grade = "correct" | "acceptable" | "wrong";

/**
 * The ONE grader. Nine generators cannot disagree about what "right" means,
 * and DrillPlayer derives every button state from this single function.
 *
 * `acceptable` exists for preflop mixed strategies: a hand the solver plays
 * as 60% raise / 40% call has one canonical answer and one defensible
 * alternative. It is data rather than a predicate so it can be serialised
 * into drill_payload and re-graded server-side in M3.
 */
export function gradeAnswer(question: DrillQuestion, chosen: OptionValue): Grade {
  if (chosen === question.answer) return "correct";
  if (question.acceptable?.includes(chosen)) return "acceptable";
  return "wrong";
}

/** Scoring, streaks and the difficulty window all treat "also fine" as right. */
export function isRight(question: DrillQuestion, chosen: OptionValue): boolean {
  return gradeAnswer(question, chosen) !== "wrong";
}
```

- [ ] **Step 8: Run it to confirm it passes**

Run: `npx tsx --test lib/drill/grade.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 9: Write the failing test for difficulty**

Create `lib/drill/difficulty.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { nextLevel, pushResult, emptyWindows, WINDOW_SIZE } from "./difficulty";
import { DRILL_KINDS } from "./contract";

const rep = (n: number, v: boolean) => Array.from({ length: n }, () => v);

test("nextLevel: fewer than 6 results leaves the level alone", () => {
  assert.equal(nextLevel(rep(5, true), 1), 1);
  assert.equal(nextLevel(rep(5, false), 3), 3);
  assert.equal(nextLevel([], 2), 2);
});

test("nextLevel: 6 results is enough to move", () => {
  assert.equal(nextLevel(rep(6, true), 1), 2);
});

test("nextLevel: exactly 80% promotes (boundary is inclusive)", () => {
  // 8 of 10 = 0.80
  assert.equal(nextLevel([...rep(8, true), ...rep(2, false)], 1), 2);
});

test("nextLevel: just under 80% does not promote", () => {
  // 7 of 10 = 0.70
  assert.equal(nextLevel([...rep(7, true), ...rep(3, false)], 1), 1);
});

test("nextLevel: exactly 50% does NOT demote (boundary is exclusive)", () => {
  // 5 of 10 = 0.50
  assert.equal(nextLevel([...rep(5, true), ...rep(5, false)], 2), 2);
});

test("nextLevel: below 50% demotes", () => {
  // 4 of 10 = 0.40
  assert.equal(nextLevel([...rep(4, true), ...rep(6, false)], 2), 1);
});

test("nextLevel: promotion caps at 3 and demotion floors at 1", () => {
  assert.equal(nextLevel(rep(10, true), 3), 3);
  assert.equal(nextLevel(rep(10, false), 1), 1);
});

test("nextLevel: only the last 10 results count", () => {
  // 20 wrong then 10 right: accuracy over the window is 1.0
  const window = [...rep(20, false), ...rep(10, true)];
  assert.equal(nextLevel(window, 1), 2);
});

test("pushResult: appends and caps the window at WINDOW_SIZE", () => {
  let w: boolean[] = [];
  for (let i = 0; i < 15; i++) w = pushResult(w, i % 2 === 0);
  assert.equal(w.length, WINDOW_SIZE);
  // the survivors are the most recent 10 of the 15
  assert.deepEqual(w, Array.from({ length: 15 }, (_, i) => i % 2 === 0).slice(5));
});

test("pushResult: does not mutate its input", () => {
  const original: boolean[] = [true];
  const next = pushResult(original, false);
  assert.deepEqual(original, [true]);
  assert.deepEqual(next, [true, false]);
});

test("emptyWindows: one empty window per drill kind, and nothing else", () => {
  const w = emptyWindows();
  assert.deepEqual(Object.keys(w).sort(), [...DRILL_KINDS].sort());
  for (const k of DRILL_KINDS) assert.deepEqual(w[k], []);
});
```

- [ ] **Step 10: Run it to confirm it fails**

Run: `npx tsx --test lib/drill/difficulty.test.ts`
Expected: FAIL — `Cannot find module './difficulty.js'`.

- [ ] **Step 11: Implement difficulty**

Create `lib/drill/difficulty.ts`:

```ts
import { DRILL_KINDS, type DrillKind, type DrillLevel } from "./contract";

export const WINDOW_SIZE = 10;
const MIN_SAMPLE = 6;
const PROMOTE_AT = 0.8;
const DEMOTE_BELOW = 0.5;

export type DrillWindows = Record<DrillKind, boolean[]>;

/** One empty rolling window per drill kind. */
export function emptyWindows(): DrillWindows {
  return Object.fromEntries(DRILL_KINDS.map((k) => [k, [] as boolean[]])) as DrillWindows;
}

/** Append a result, keeping only the most recent WINDOW_SIZE. Never mutates. */
export function pushResult(window: boolean[], ok: boolean): boolean[] {
  return [...window, ok].slice(-WINDOW_SIZE);
}

/**
 * Verbatim-semantics port of the reference trainer's `levelFrom()`
 * (poker-math-trainer.html lines 1162-1167), with the window scoped to a
 * single drill kind rather than shared across all of them.
 *
 * Boundaries are as written: exactly 0.80 promotes, exactly 0.50 does not
 * demote. Both are pinned by tests.
 */
export function nextLevel(window: boolean[], current: DrillLevel): DrillLevel {
  const recent = window.slice(-WINDOW_SIZE);
  if (recent.length < MIN_SAMPLE) return current;
  const accuracy = recent.filter(Boolean).length / recent.length;
  if (accuracy >= PROMOTE_AT) return Math.min(3, current + 1) as DrillLevel;
  if (accuracy < DEMOTE_BELOW) return Math.max(1, current - 1) as DrillLevel;
  return current;
}
```

- [ ] **Step 12: Run it to confirm it passes**

Run: `npx tsx --test lib/drill/difficulty.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 13: Write the failing test for the shared generator helpers**

Create `lib/drill/opts.test.ts`. These assertions include the ones currently living in `lib/drill/outsQuestion.test.ts` (which Task 2 deletes), plus coverage for the padding guard that M1 deferred.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  withArticle, buildOpts, intOptsInRange, money, pct, signedMoney,
  roundTo, pick, shuffled,
} from "./opts";
import { mulberry32 } from "./rng";

test("withArticle: consonant-leading label gets 'a'", () => {
  assert.equal(withArticle("gutshot"), "a gutshot");
});

test("withArticle: vowel-leading label gets 'an'", () => {
  assert.equal(withArticle("open-ended straight draw"), "an open-ended straight draw");
});

test("withArticle: combo draw label starts with 'flush', so 'a'", () => {
  assert.equal(withArticle("flush draw + gutshot"), "a flush draw + gutshot");
});

test("money: rounds to whole dollars with a thousands separator", () => {
  assert.equal(money(60), "$60");
  assert.equal(money(1234.6), "$1,235");
});

test("pct: one decimal place", () => {
  assert.equal(pct(0.3497), "35.0%");
  assert.equal(pct(0.1739), "17.4%");
});

test("signedMoney: explicit sign, minus sign is U+2212", () => {
  assert.equal(signedMoney(12.4), "+$12");
  assert.equal(signedMoney(-12.4), "−$12");
  assert.equal(signedMoney(0), "+$0");
});

test("roundTo: rounds to the nearest step", () => {
  assert.equal(roundTo(37, 5), 35);
  assert.equal(roundTo(38, 5), 40);
  assert.equal(roundTo(37.4, 1), 37);
});

test("pick / shuffled: deterministic under a seeded rng and non-mutating", () => {
  const source = [1, 2, 3, 4, 5];
  const a = shuffled(source, mulberry32(7));
  const b = shuffled(source, mulberry32(7));
  assert.deepEqual(a, b);
  assert.deepEqual(source, [1, 2, 3, 4, 5]);
  assert.deepEqual([...a].sort(), [...source].sort());
  assert.equal(pick(source, mulberry32(7)), pick(source, mulberry32(7)));
});

test("buildOpts: always returns exactly n options containing the answer once", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = mulberry32(seed);
    const answer = 25.4;
    const opts = buildOpts(answer, [12.1, 30.2, 44.9, 25.4, 26.0], 4, 1.2, rng);
    assert.equal(opts.length, 4);
    assert.equal(opts.filter((v) => v === answer).length, 1, `seed ${seed}`);
  }
});

test("buildOpts: no two options are within minGap of each other", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const opts = buildOpts(25.4, [25.9, 26.0, 40, 55], 4, 1.2, mulberry32(seed));
    for (let i = 0; i < opts.length; i++) {
      for (let j = i + 1; j < opts.length; j++) {
        assert.ok(Math.abs(opts[i] - opts[j]) >= 1.2, `seed ${seed}: ${opts[i]} vs ${opts[j]}`);
      }
    }
  }
});

test("buildOpts: pads up to n when candidates are too few or too close", () => {
  // every candidate collides with the answer, so all three fillers must be generated
  const opts = buildOpts(20, [20.1, 20.2, 20.3], 4, 1.2, mulberry32(3));
  assert.equal(opts.length, 4);
  assert.ok(opts.includes(20));
  assert.equal(new Set(opts).size, 4);
});

test("buildOpts: never returns a non-finite value", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const opts = buildOpts(0.1, [Infinity, NaN, -Infinity], 4, 0.05, mulberry32(seed));
    assert.equal(opts.length, 4);
    for (const v of opts) assert.ok(Number.isFinite(v), `seed ${seed}: ${v}`);
  }
});

test("intOptsInRange: 4 distinct integers in range, answer included", () => {
  for (let seed = 1; seed <= 200; seed++) {
    for (const answer of [1, 4, 9, 12, 15, 20]) {
      const cands = [answer - 1, answer + 1, answer - 2, answer + 2, answer + 3];
      const opts = intOptsInRange(answer, cands, 4, 1, 20, mulberry32(seed));
      assert.equal(opts.length, 4, `seed ${seed} answer ${answer}`);
      assert.equal(new Set(opts).size, 4);
      assert.ok(opts.includes(answer));
      for (const v of opts) {
        assert.ok(Number.isInteger(v) && v >= 1 && v <= 20, `bad option ${v}`);
      }
    }
  }
});

test("intOptsInRange: pads inside the range even when every candidate is invalid", () => {
  // the deferred M1 finding: answer at the very bottom with unusable candidates
  const opts = intOptsInRange(1, [0, -1, -5, 1], 4, 1, 20, mulberry32(11));
  assert.equal(opts.length, 4);
  assert.equal(new Set(opts).size, 4);
  assert.ok(opts.includes(1));
  for (const v of opts) assert.ok(v >= 1 && v <= 20);
});

test("intOptsInRange: pads inside the range at the top edge too", () => {
  const opts = intOptsInRange(20, [21, 22, 25], 4, 1, 20, mulberry32(12));
  assert.equal(opts.length, 4);
  assert.equal(new Set(opts).size, 4);
  assert.ok(opts.includes(20));
  for (const v of opts) assert.ok(v >= 1 && v <= 20);
});
```

- [ ] **Step 14: Run it to confirm it fails**

Run: `npx tsx --test lib/drill/opts.test.ts`
Expected: FAIL — `Cannot find module './opts.js'`.

- [ ] **Step 15: Implement the shared helpers**

Create `lib/drill/opts.ts`. `buildOpts` is a port of reference lines 380–392 with the implicit `Math.random` replaced by an injected `rng`; `intOptsInRange` is new and closes M1's deferred padding-guard finding.

```ts
/**
 * Shared, pure helpers every generator uses. Ported from
 * reference/poker-math-trainer.html lines 364-392, with Math.random replaced
 * by an injected Rng so every generator test is deterministic.
 *
 * Poker math itself lives in lib/poker/math.ts — never re-derive it here.
 */
import type { Rng } from "../poker/engine";

export const rnd = (n: number, rng: Rng): number => Math.floor(rng() * n);

export const pick = <T>(arr: readonly T[], rng: Rng): T => arr[rnd(arr.length, rng)];

export function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd(i + 1, rng);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const roundTo = (v: number, step: number): number => Math.round(v / step) * step;

/** "a gutshot" / "an open-ended straight draw". */
export const withArticle = (label: string): string =>
  (/^[aeiou]/i.test(label) ? "an " : "a ") + label;

export const money = (v: number): string => "$" + Math.round(v).toLocaleString("en-US");

export const pct = (v: number): string => (v * 100).toFixed(1) + "%";

/** "+$12" / "−$12" — note the true minus sign, U+2212, as the reference uses. */
export const signedMoney = (v: number): string =>
  (v >= 0 ? "+" : "−") + money(Math.abs(v));

/** Dedupe on 2-decimal precision, preserving the first occurrence's value. */
function uniqNums(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of values) {
    const key = Math.round(v * 100) / 100;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/**
 * Build exactly `n` distinct numeric choices that always contain `answer`,
 * with no two choices closer than `minGap`. Candidates are tried in random
 * order; if they run out, fillers are generated by scaling the answer.
 */
export function buildOpts(
  answer: number,
  candidates: readonly number[],
  n: number,
  minGap: number,
  rng: Rng
): number[] {
  const gap = minGap || 0.05;
  const out: number[] = [answer];
  const tooClose = (v: number) => out.some((x) => Math.abs(x - v) < gap);

  for (const v of shuffled(uniqNums(candidates), rng)) {
    if (out.length >= n) break;
    if (Number.isFinite(v) && !tooClose(v)) out.push(v);
  }

  // Fillers, when the candidate list was too short or too tightly clustered.
  const base = answer || 10;
  for (let k = 1; out.length < n && k < 60; k++) {
    const v = +(base * (1 + 0.22 * k)).toFixed(1);
    if (Number.isFinite(v) && v !== 0 && !tooClose(v)) out.push(v);
  }
  // Last resort, only reachable for pathological answers: step by minGap.
  for (let k = 1; out.length < n && k < 200; k++) {
    const v = +(answer + gap * k * 1.5).toFixed(2);
    if (Number.isFinite(v) && !tooClose(v)) out.push(v);
  }

  return shuffled(out, rng);
}

/**
 * Integer flavour: exactly `n` distinct integers inside [lo, hi], always
 * containing `answer`. Candidates outside the range are dropped, and padding
 * walks outward from the answer so the range is never violated — the guard
 * M1 deferred, needed once difficulty 3 widens the out-count range.
 */
export function intOptsInRange(
  answer: number,
  candidates: readonly number[],
  n: number,
  lo: number,
  hi: number,
  rng: Rng
): number[] {
  const valid = (v: number) => Number.isInteger(v) && v >= lo && v <= hi;
  const out: number[] = [answer];
  const push = (v: number) => {
    if (valid(v) && !out.includes(v) && out.length < n) out.push(v);
  };

  for (const v of shuffled(uniqNums(candidates), rng)) push(v);
  // Pad by walking outward from the answer: answer±1, ±2, … staying in range.
  for (let d = 1; out.length < n && d <= hi - lo; d++) {
    push(answer - d);
    push(answer + d);
  }
  return shuffled(out, rng);
}
```

- [ ] **Step 16: Run it to confirm it passes**

Run: `npx tsx --test lib/drill/opts.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 17: Run both full suites**

Run: `npm test`
Expected: 0 failures. Count is now 49 + 7 + 11 + 16 = 83 passing.

Run: `.venv/bin/python -m pytest api/ -q`
Expected: 17 passed.

- [ ] **Step 18: Commit**

```bash
git add lib/drill/contract.ts lib/drill/rng.ts lib/drill/grade.ts lib/drill/grade.test.ts \
        lib/drill/difficulty.ts lib/drill/difficulty.test.ts \
        lib/drill/opts.ts lib/drill/opts.test.ts package.json
git commit -m "feat: freeze the M2 drill contract, grading, difficulty and helpers"
```

**The contract is now frozen.** Any later change to `contract.ts` must be announced, because Tasks 4–11 are written against it in parallel.

---

## Task 2: DrillPlayer, tabs, and `outs` as the first kind on the contract

This task proves the contract by putting one real drill through it end to end, and it is where the M1 components get retired. Do it before the parallel fan-out: if the contract is wrong, this is where it shows.

**Files:**
- Create: `lib/drill/kinds/outs.ts`, `lib/drill/kinds/outs.test.ts`
- Create: `lib/drill/registry.ts`
- Create: `components/drill/DrillPlayer.tsx`, `components/drill/DrillTabs.tsx`, `components/drill/OpponentToggle.tsx`
- Create: `components/ui/Pills.tsx`
- Create: `app/drill/page.tsx`
- Modify: `components/drill/DrillShell.tsx`, `lib/drill/recordAttempt.ts`, `lib/drill/recordAttempt.test.ts`, `app/drill/outs/page.tsx`
- Delete: `components/drill/OutsDrill.tsx`, `lib/drill/outsQuestion.ts`, `lib/drill/outsQuestion.test.ts`

**Interfaces:**
- Consumes: everything from Task 1; `lib/poker/engine.ts` (`dealDrawSpot`, `dealVsHandSpot`, `deadOuts`, `describeOuts`, `cardStr`, `handName`, `DRAW_OUTS`, `Spot`); `lib/poker/math.ts`.
- Produces:
  - `lib/drill/kinds/outs.ts` → `export const generateOuts: Generator`
  - `lib/drill/registry.ts` → `export const GENERATORS: Record<DrillKind, Generator>`, `export const KIND_LABELS: Record<DrillKind, string>`, `export const TAB_ORDER: TabId[]`, `export type TabId = "mixed" | DrillKind | "reference"`, `export function pickMixedKind(rng: Rng): DrillKind`
  - `components/drill/DrillPlayer.tsx` → `export function DrillPlayer(props: { question: DrillQuestion; difficulty: DrillLevel; modeLabel?: string; onAnswered: (chosen: OptionValue, right: boolean) => void; onNext: () => void })`
  - `lib/drill/recordAttempt.ts` → `export interface DrillResult { kind: DrillKind; payload: Record<string, unknown>; answer: OptionValue; correct: boolean }`

- [ ] **Step 1: Write the failing test for the `outs` generator**

Create `lib/drill/kinds/outs.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { generateOuts } from "./outs";
import { mulberry32 } from "../rng";
import { DRAW_OUTS, coreDraw, drawOuts, outsVsHand, type Spot } from "../../poker/engine";
import type { DrillContext, DrillLevel } from "../contract";

const ctx = (seed: number, level: DrillLevel = 2, oppMode: "unknown" | "shown" = "unknown"): DrillContext =>
  ({ level, oppMode, rng: mulberry32(seed) });

test("generateOuts: shape is well formed for every level and mode", () => {
  for (const level of [1, 2, 3] as DrillLevel[]) {
    for (const oppMode of ["unknown", "shown"] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const q = generateOuts(ctx(seed, level, oppMode));
        assert.equal(q.kind, "outs");
        assert.equal(q.layout, "grid3");
        assert.equal(q.options.length, 4);
        assert.equal(new Set(q.options.map((o) => o.value)).size, 4);
        assert.equal(q.options.filter((o) => o.value === q.answer).length, 1);
        assert.ok(q.prompt.length > 0);
        assert.ok(q.body.some((b) => b.type === "felt"));
      }
    }
  }
});

test("generateOuts: the answer is the engine's out count, never a hand-written number", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateOuts(ctx(seed, 2, "unknown"));
    const spot = q.payload.spot as Spot;
    assert.equal(q.answer, spot.outCards.length);
    assert.equal(q.answer, drawOuts(spot.hero, spot.board).length);
  }
});

test("generateOuts: unknown mode — the draw label's count agrees with DRAW_OUTS", () => {
  for (let seed = 1; seed <= 80; seed++) {
    const q = generateOuts(ctx(seed, 3, "unknown"));
    const spot = q.payload.spot as Spot;
    const label = coreDraw(spot.draw);
    assert.equal(
      DRAW_OUTS[label],
      spot.outCards.length,
      `seed ${seed}: label "${label}" vs ${spot.outCards.length} outs`
    );
  }
});

test("generateOuts: face-up mode counts only cards that actually beat the villain", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateOuts(ctx(seed, 2, "shown"));
    const spot = q.payload.spot as Spot;
    assert.ok(spot.villain, "face-up mode must deal a villain");
    const clean = outsVsHand(spot.hero, spot.villain!, spot.board).clean;
    assert.equal(q.answer, clean.length);
  }
});

test("generateOuts: face-up mode shows the villain on the felt, unknown mode does not", () => {
  const shown = generateOuts(ctx(5, 2, "shown"));
  const feltShown = shown.body.find((b) => b.type === "felt") as { villain?: unknown[] };
  assert.ok(feltShown.villain && feltShown.villain.length === 2);

  const hidden = generateOuts(ctx(5, 2, "unknown"));
  const feltHidden = hidden.body.find((b) => b.type === "felt") as { villain?: unknown[] };
  assert.equal(feltHidden.villain, undefined);
});

test("generateOuts: options are integers in 1..20", () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const oppMode of ["unknown", "shown"] as const) {
      const q = generateOuts(ctx(seed, 3, oppMode));
      for (const o of q.options) {
        assert.ok(Number.isInteger(o.value) && (o.value as number) >= 1 && (o.value as number) <= 20);
      }
    }
  }
});

test("generateOuts: payload carries level and oppMode and survives JSON", () => {
  const q = generateOuts(ctx(9, 3, "shown"));
  assert.equal(q.payload.level, 3);
  assert.equal(q.payload.oppMode, "shown");
  const round = JSON.parse(JSON.stringify(q.payload));
  assert.deepEqual(round, q.payload);
});

test("generateOuts: the answer is re-derivable from the payload alone", () => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const oppMode of ["unknown", "shown"] as const) {
      const q = generateOuts(ctx(seed, 2, oppMode));
      const p = JSON.parse(JSON.stringify(q.payload)) as { spot: Spot; oppMode: string };
      const regraded =
        p.oppMode === "shown"
          ? outsVsHand(p.spot.hero, p.spot.villain!, p.spot.board).clean.length
          : drawOuts(p.spot.hero, p.spot.board).length;
      assert.equal(regraded, q.answer, `seed ${seed} ${oppMode}`);
    }
  }
});

test("generateOuts: explain lists the outs and, face-up, names the dead ones", () => {
  const q = generateOuts(ctx(5, 2, "shown"));
  const ex = q.explain(q.answer);
  assert.ok(ex.rows.some((r) => r.label === "Outs"));
  assert.ok(ex.rows.some((r) => /equity|hitting/i.test(r.label)));
  assert.ok(ex.notes.length > 0);
});

test("generateOuts: level 1 deals a single draw at a time", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateOuts(ctx(seed, 1, "unknown"));
    const spot = q.payload.spot as Spot;
    assert.ok(!spot.draw.includes(" + "), `seed ${seed}: level 1 dealt a combo draw "${spot.draw}"`);
  }
});

test("generateOuts: same seed gives the same question, different seeds differ", () => {
  const a = generateOuts(ctx(21));
  const b = generateOuts(ctx(21));
  assert.deepEqual(a.payload, b.payload);
  const c = generateOuts(ctx(22));
  assert.notDeepEqual(a.payload, c.payload);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx --test lib/drill/kinds/outs.test.ts`
Expected: FAIL — `Cannot find module './outs.js'`.

- [ ] **Step 3: Note the engine surface (already confirmed — no investigation needed)**

`Spot` is `{ hero, board, villain?, street, outs, outCards, draw, unseen, equity }` (`lib/poker/engine.ts:322-332`). `DrawSpotOptions` is `{ street?, level?, rng?, gutshotKeepRate? }` (`:363-370`). Both `dealDrawSpot` and `dealVsHandSpot` take it and return a fully-populated `Spot`; `dealVsHandSpot` sets `villain` and throws `Error("dealVsHandSpot: no qualifying spot found")` if it exhausts 8000 attempts. Pass `ctx.rng` through as `rng`. Do not modify `lib/poker/`.

- [ ] **Step 4: Implement the `outs` generator**

Create `lib/drill/kinds/outs.ts`. This ports `Q.outs` (reference lines 601–625) and `makeSpot` (585–595) onto the contract, folding in the existing `lib/drill/outsQuestion.ts`.

```ts
/**
 * "Count your outs" — a port of the reference trainer's Q.outs
 * (poker-math-trainer.html lines 601-625) and makeSpot (585-595) onto the
 * M2 drill contract.
 *
 * Unknown mode: outs are the cards that complete your draw, and a spot is
 * only dealt when the named draw's count matches DRAW_OUTS — the label can
 * never disagree with the answer. Face-up mode: outs are the cards that
 * actually beat the villain's hand, so dead outs are stripped and named.
 */
import {
  dealDrawSpot, dealVsHandSpot, deadOuts, describeOuts, cardStr,
  type Spot, type Street,
} from "../../poker/engine";
import { intOptsInRange, pct, withArticle } from "../opts";
import type { DrillContext, DrillQuestion, Generator, ViewBlock } from "../contract";

/**
 * The spot a question is built on, in whichever opponent mode is active.
 *
 * Both engine dealers already return a fully-populated Spot — `dealVsHandSpot`
 * derives outs/outCards/unseen/equity from `outsVsHand` and `equityVsHand`
 * itself (engine.ts:419-447), so face-up mode needs no post-processing here.
 * Recomputing them would duplicate engine math for identical results.
 */
export function dealSpotOnStreet(ctx: DrillContext, street: Street): Spot {
  const opts = { street, level: ctx.level, rng: ctx.rng };
  return ctx.oppMode === "shown" ? dealVsHandSpot(opts) : dealDrawSpot(opts);
}

/** Street choice for the outs drill: turns appear from level 2 upward. */
export function dealOutsSpot(ctx: DrillContext): Spot {
  const street = ctx.level >= 2 && ctx.rng() < 0.4 ? "turn" : "flop";
  return dealSpotOnStreet(ctx, street);
}

const COUNT_PROMPT = "How many outs do you have?";
const SUB_UNKNOWN =
  "Count the cards that complete your draw: the ones that give you a straight, a flush, or better.";
const SUB_SHOWN =
  "Count only the cards that actually beat them — a card that completes your draw but improves their hand more is not an out.";

export const generateOuts: Generator = (ctx): DrillQuestion => {
  const spot = dealOutsSpot(ctx);
  const n = spot.outs;
  const candidates = [n - 1, n + 1, n - 2, n + 2, n + 3, n - 3, n + 6, Math.max(1, n - 4)];
  const options = intOptsInRange(n, candidates, 4, 1, 20, ctx.rng);

  const body: ViewBlock[] = [
    {
      type: "felt",
      hero: spot.hero,
      board: spot.board,
      street: spot.street,
      ...(ctx.oppMode === "shown" ? { villain: spot.villain } : {}),
    },
    { type: "text", text: `You have ${withArticle(spot.draw)}.`, center: true },
  ];

  const chanceLabel =
    ctx.oppMode === "shown"
      ? "Exact equity vs their hand"
      : spot.street === "flop"
        ? "Chance of hitting by the river"
        : "Chance of hitting on the river";

  return {
    kind: "outs",
    kicker: "Counting outs",
    chip: spot.street === "flop" ? "Flop" : "Turn",
    prompt: COUNT_PROMPT,
    sub: ctx.oppMode === "shown" ? SUB_SHOWN : SUB_UNKNOWN,
    body,
    options: options.map((v) => ({ label: `${v} out${v === 1 ? "" : "s"}`, value: v })),
    answer: n,
    layout: "grid3",
    explain: () => {
      const notes = [
        { tone: "plain" as const, title: "Your outs:", text: describeOuts(spot.outCards) },
      ];
      if (ctx.oppMode === "shown") {
        const dead = deadOuts(spot.hero, spot.villain!, spot.board);
        if (dead.length) {
          notes.push({
            tone: "warn" as const,
            title: `Dead outs (${dead.length}).`,
            text:
              dead.map((d) => `${cardStr(d.card)} gives you ${d.you} but hands them ${d.them}`).join("; ") +
              ". These complete your draw and still lose, so they never counted. This is the most " +
              "expensive miscount in poker — always check what the card does for them before you " +
              "add it to your total.",
          });
        }
      } else {
        notes.push({
          tone: "warn" as const,
          title: "Next step, when you are ready.",
          text:
            "These are the cards that complete your draw. Against a real hand some of them can be " +
            "dead — a card that makes your flush can pair the board and give them a full house. " +
            "Flip Opponent in the header to face-up and the drills will start stripping those out " +
            "and showing you which ones.",
        });
      }
      return {
        rows: [
          { label: "Your draw", value: spot.draw },
          { label: "Unseen cards", value: String(spot.unseen) },
          { label: "Outs", value: String(n) },
          { label: chanceLabel, value: pct(spot.equity) },
        ],
        notes,
      };
    },
    payload: { level: ctx.level, oppMode: ctx.oppMode, spot },
  };
};
```

`DrawSpotOptions` already has an optional `rng` field (`lib/poker/engine.ts:363-370`), so pass `ctx.rng` straight through. No engine change is needed for this task — if you find yourself editing `lib/poker/`, stop and report instead.

- [ ] **Step 5: Run it to confirm it passes**

Run: `npx tsx --test lib/drill/kinds/outs.test.ts`
Expected: PASS, 11 tests. If the `DRAW_OUTS` agreement test fails in level 3, the spot dealer is falling back to a loose deal — fix the generator to reject and re-deal in unknown mode, never the test.

- [ ] **Step 5b: Create the shared invariant assertions the eight later kinds reuse**

Create `lib/drill/kinds/assertions.ts`. The filename deliberately does not match the `*.test.ts` glob, so it is a helper rather than a test file. Every generator task calls these instead of copying the same four tests eight times.

```ts
import assert from "node:assert/strict";
import { mulberry32 } from "../rng";
import { gradeAnswer } from "../grade";
import type { DrillKind, DrillLevel, Generator, OppMode } from "../contract";

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
```

Then in `lib/drill/kinds/outs.test.ts`, replace the first shape test and the determinism test with calls to these two helpers, keeping every outs-specific test as it is. Re-run `npx tsx --test lib/drill/kinds/outs.test.ts` and confirm it still passes.

- [ ] **Step 6: Create the registry**

Create `lib/drill/registry.ts`. Only `outs` is wired now; the eight later tasks each add exactly one import and one entry.

```ts
import type { DrillKind, Generator } from "./contract";
import type { Rng } from "../poker/engine";
import { DRILL_KINDS } from "./contract";
import { generateOuts } from "./kinds/outs";
import { rnd } from "./opts";

export type TabId = "mixed" | DrillKind | "reference";

/** Tab order, matching the reference trainer's MODULES list (line 1141). */
export const TAB_ORDER: TabId[] = [
  "mixed", "outs", "rule24", "potodds", "decision", "implied",
  "ev", "bluff", "concepts", "preflop", "reference",
];

export const KIND_LABELS: Record<DrillKind, string> = {
  outs: "Count outs",
  rule24: "Rule of 2 & 4",
  potodds: "Pot odds",
  decision: "Call or fold",
  implied: "Implied odds",
  ev: "Expected value",
  bluff: "Bluff math",
  concepts: "OMC mistakes",
  preflop: "Preflop drill",
};

export const TAB_LABELS: Record<TabId, string> = {
  mixed: "Mixed drill",
  reference: "Reference",
  ...KIND_LABELS,
};

/**
 * Generators registered so far. Kinds are added here as each is implemented;
 * Mixed mode and the tab strip only offer registered kinds, so a partially
 * built milestone is always runnable.
 */
export const GENERATORS: Partial<Record<DrillKind, Generator>> = {
  outs: generateOuts,
};

export const REGISTERED_KINDS = (): DrillKind[] => DRILL_KINDS.filter((k) => GENERATORS[k]);

export const pickMixedKind = (rng: Rng): DrillKind => {
  const kinds = REGISTERED_KINDS();
  return kinds[rnd(kinds.length, rng)];
};
```

- [ ] **Step 7: Create the `money` ViewBlock renderer**

Create `components/ui/Pills.tsx` (the `.potbar` / `.pill` classes already exist in `app/globals.css` lines 105–108):

```tsx
export interface PillsProps {
  items: { label: string; value: string }[];
}

/** Renders the `money` ViewBlock — the pot / bet / to-call strip. */
export function Pills({ items }: PillsProps) {
  return (
    <div className="potbar">
      {items.map((p) => (
        <div className="pill" key={p.label}>
          <div className="k">{p.label}</div>
          <div className="v">{p.value}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Create `DrillPlayer`**

Create `components/drill/DrillPlayer.tsx`. This replaces `OutsDrill`'s state machine with one that works for every kind. `RangeGrid` is added in Task 12 (preflop) — until then the `grid` block renders nothing, which no registered kind emits.

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { DrillQuestion, Explain, OptionValue, ViewBlock } from "@/lib/drill/contract";
import { gradeAnswer, isRight } from "@/lib/drill/grade";
import { Felt, Seat, Divider } from "@/components/ui/Felt";
import { PlayingCard } from "@/components/ui/PlayingCard";
import { Pills } from "@/components/ui/Pills";
import { OptionButton, type OptionButtonState } from "@/components/ui/OptionButton";
import { FeedbackPanel, WorkTable, WorkRow } from "@/components/ui/FeedbackPanel";

function Blocks({ blocks }: { blocks: ViewBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "felt":
            return (
              <Felt key={i}>
                <Seat label="Your hand">
                  {b.hero.map((c) => <PlayingCard key={c} card={c} />)}
                </Seat>
                <Divider />
                <Seat label={`Board — ${b.street}`}>
                  {b.board.map((c) => <PlayingCard key={c} card={c} />)}
                </Seat>
                {b.villain && (
                  <>
                    <Divider />
                    <Seat label="Villain (shown)">
                      {b.villain.map((c) => <PlayingCard key={c} card={c} />)}
                    </Seat>
                  </>
                )}
              </Felt>
            );
          case "hand":
            return (
              <Felt key={i}>
                <Seat label={b.label}>
                  {b.cards.map((c) => <PlayingCard key={c} card={c} />)}
                </Seat>
              </Felt>
            );
          case "money":
            return <Pills key={i} items={b.items} />;
          case "text":
            return (
              <div
                key={i}
                className={b.tone === "warn" ? "note warnl" : "sub"}
                style={b.center ? { textAlign: "center", margin: "6px 0 0" } : undefined}
              >
                {b.text}
              </div>
            );
          case "grid":
            return null; // RangeGrid arrives with the preflop drill (Task 12).
        }
      })}
    </>
  );
}

function ExplainBody({ explain }: { explain: Explain }) {
  return (
    <>
      <WorkTable>
        {explain.rows.map((r) => <WorkRow key={r.label} label={r.label} value={r.value} />)}
      </WorkTable>
      {explain.notes.map((n, i) => (
        <div key={i} className={n.tone === "warn" ? "note warnl" : "note"}>
          {n.title && <b>{n.title} </b>}
          {n.text}
        </div>
      ))}
      {explain.blocks && <Blocks blocks={explain.blocks} />}
    </>
  );
}

export interface DrillPlayerProps {
  question: DrillQuestion;
  /** Fired once per question, with whether it counted as right. */
  onAnswered: (chosen: OptionValue, right: boolean) => void;
  onNext: () => void;
}

/** Renders and drives ANY DrillQuestion. The only drill state machine. */
export function DrillPlayer({ question, onAnswered, onNext }: DrillPlayerProps) {
  const [chosen, setChosen] = useState<OptionValue | null>(null);
  const answered = chosen !== null;

  // A new question resets the panel. Keyed on the question object identity.
  useEffect(() => { setChosen(null); }, [question]);

  const handleAnswer = useCallback(
    (value: OptionValue) => {
      if (chosen !== null) return;
      setChosen(value);
      onAnswered(value, isRight(question, value));
    },
    [chosen, question, onAnswered]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Never swallow keys while the user is typing in a field.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!answered) {
        const idx = Number(e.key) - 1;
        if (Number.isInteger(idx) && idx >= 0 && idx < question.options.length) {
          e.preventDefault();
          handleAnswer(question.options[idx].value);
        }
      } else if (e.key.toUpperCase() === "N" || e.key === "Enter") {
        e.preventDefault();
        onNext();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answered, question, handleAnswer, onNext]);

  const grade = answered ? gradeAnswer(question, chosen) : null;

  return (
    <>
      <div className="prompt">{question.prompt}</div>
      {question.sub && <div className="sub">{question.sub}</div>}
      <Blocks blocks={question.body} />

      <div className={`opts ${question.layout === "one" ? "" : question.layout}`.trim()}>
        {question.options.map((o, i) => {
          let state: OptionButtonState = "idle";
          if (answered) {
            const g = gradeAnswer(question, o.value);
            if (g === "correct" || g === "acceptable") state = "correct";
            else if (o.value === chosen) state = "wrong";
            else state = "disabled";
          }
          return (
            <OptionButton
              key={String(o.value)}
              keyHint={String(i + 1)}
              state={state}
              onClick={() => handleAnswer(o.value)}
            >
              {o.label}
              {answered && gradeAnswer(question, o.value) === "acceptable" && " — also fine"}
            </OptionButton>
          );
        })}
      </div>

      {answered && (
        <>
          <FeedbackPanel
            ok={grade !== "wrong"}
            message={
              grade === "correct" ? "Correct." : grade === "acceptable" ? "Also fine." : "Not quite."
            }
          >
            <ExplainBody explain={question.explain(chosen)} />
          </FeedbackPanel>
          <div className="actions">
            <button className="btn" onClick={onNext}>Next hand →</button>
            <span className="hint">or press <b>N</b> / Enter</span>
          </div>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 9: Create the tab strip and the opponent toggle**

Create `components/drill/DrillTabs.tsx`:

```tsx
"use client";

import { TAB_ORDER, TAB_LABELS, REGISTERED_KINDS, type TabId } from "@/lib/drill/registry";

export interface DrillTabsProps {
  active: TabId;
  onSelect: (tab: TabId) => void;
}

/** Mixed + every registered kind + Reference. Unimplemented kinds are hidden
 *  rather than shown broken, so the app is runnable mid-milestone. */
export function DrillTabs({ active, onSelect }: DrillTabsProps) {
  const registered = new Set<string>(REGISTERED_KINDS());
  const tabs = TAB_ORDER.filter((t) => t === "mixed" || t === "reference" || registered.has(t));
  return (
    <nav className="tabs">
      {tabs.map((t) => (
        <button
          key={t}
          className={`tab${t === active ? " active" : ""}`}
          onClick={() => onSelect(t)}
        >
          {TAB_LABELS[t]}
        </button>
      ))}
    </nav>
  );
}
```

Create `components/drill/OpponentToggle.tsx`:

```tsx
"use client";

import type { OppMode } from "@/lib/drill/contract";

export const OPP_MODE_KEY = "hcwk.oppMode";

/** Read the persisted mode. Safe on the server and in private-mode browsers. */
export function readOppMode(): OppMode {
  if (typeof window === "undefined") return "unknown";
  try {
    return window.localStorage.getItem(OPP_MODE_KEY) === "shown" ? "shown" : "unknown";
  } catch {
    return "unknown";
  }
}

export function writeOppMode(mode: OppMode): void {
  try {
    window.localStorage.setItem(OPP_MODE_KEY, mode);
  } catch {
    /* storage unavailable — the toggle still works for this session */
  }
}

export interface OpponentToggleProps {
  mode: OppMode;
  onChange: (mode: OppMode) => void;
}

export function OpponentToggle({ mode, onChange }: OpponentToggleProps) {
  return (
    <button
      className="tab"
      onClick={() => onChange(mode === "unknown" ? "shown" : "unknown")}
      title="Face-up mode shows the villain's hand and strips dead outs"
    >
      Opponent: <b>{mode === "shown" ? "face-up" : "unknown"}</b>
    </button>
  );
}
```

- [ ] **Step 10: Rewrite `DrillShell` to own tabs, windows, mode and session stats**

Replace `components/drill/DrillShell.tsx` entirely:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "@/components/ui/Header";
import { StatTile } from "@/components/ui/StatTile";
import { DrillTabs } from "@/components/drill/DrillTabs";
import { DrillPlayer } from "@/components/drill/DrillPlayer";
import { OpponentToggle, readOppMode, writeOppMode } from "@/components/drill/OpponentToggle";
import { GENERATORS, pickMixedKind, type TabId } from "@/lib/drill/registry";
import { emptyWindows, nextLevel, pushResult, type DrillWindows } from "@/lib/drill/difficulty";
import type { DrillKind, DrillLevel, DrillQuestion, OppMode, OptionValue } from "@/lib/drill/contract";
import { recordAttempt } from "@/lib/drill/recordAttempt";

export interface Profile {
  username: string;
  xp: number;
  level: number;
  streak_count: number;
}

export interface DrillShellProps {
  profile: Profile | null;
  /** Initial tab from the ?tab= query string. */
  initialTab?: TabId;
}

interface Live {
  question: DrillQuestion;
  kind: DrillKind;
  difficulty: DrillLevel;
}

export function DrillShell({ profile: initialProfile, initialTab = "mixed" }: DrillShellProps) {
  const [profile, setProfile] = useState<Profile | null>(initialProfile);
  const [tab, setTab] = useState<TabId>(initialTab);
  const [oppMode, setOppMode] = useState<OppMode>("unknown");
  const [windows, setWindows] = useState<DrillWindows>(() => emptyWindows());
  const [levels, setLevels] = useState<Record<string, DrillLevel>>({});
  const [live, setLive] = useState<Live | null>(null);

  const [score, setScore] = useState(0);
  const [right, setRight] = useState(0);
  const [total, setTotal] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);

  const latestRequestId = useRef(0);

  // localStorage is client-only: read it after mount, never during render.
  useEffect(() => { setOppMode(readOppMode()); }, []);

  const deal = useCallback(
    (forTab: TabId, mode: OppMode, w: DrillWindows, lv: Record<string, DrillLevel>) => {
      if (forTab === "reference") { setLive(null); return; }
      const kind = forTab === "mixed" ? pickMixedKind(Math.random) : (forTab as DrillKind);
      const generate = GENERATORS[kind];
      if (!generate) { setLive(null); return; }
      const difficulty = nextLevel(w[kind] ?? [], lv[kind] ?? 1);
      setLevels((prev) => ({ ...prev, [kind]: difficulty }));
      setLive({
        question: generate({ level: difficulty, oppMode: mode, rng: Math.random }),
        kind,
        difficulty,
      });
    },
    []
  );

  // Deal on mount, and whenever the tab or the opponent mode changes.
  useEffect(() => { deal(tab, oppMode, windows, levels); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, oppMode]);

  const handleAnswered = useCallback(
    (chosen: OptionValue, ok: boolean) => {
      if (!live) return;
      setTotal((t) => t + 1);
      setWindows((w) => ({ ...w, [live.kind]: pushResult(w[live.kind] ?? [], ok) }));
      if (ok) {
        setRight((r) => r + 1);
        setStreak((s) => {
          const next = s + 1;
          setBest((b) => Math.max(b, next));
          setScore((sc) => sc + 10 * live.difficulty + Math.min(20, (next - 1) * 2));
          return next;
        });
      } else {
        setStreak(0);
      }

      const requestId = ++latestRequestId.current;
      void recordAttempt({
        kind: live.kind,
        payload: live.question.payload,
        answer: chosen,
        correct: ok,
      }).then((update) => {
        if (!update || requestId !== latestRequestId.current) return;
        setProfile({
          username: update.username,
          xp: update.xp,
          level: update.level,
          streak_count: update.streak_count,
        });
      });
    },
    [live]
  );

  const handleNext = useCallback(() => {
    deal(tab, oppMode, windows, levels);
  }, [deal, tab, oppMode, windows, levels]);

  const handleMode = useCallback((mode: OppMode) => {
    writeOppMode(mode);
    setOppMode(mode);
  }, []);

  const accuracy = total === 0 ? 0 : Math.round((right / total) * 100);
  const difficulty = live?.difficulty ?? 1;
  const kicker = useMemo(
    () => (live ? live.question.kicker : ""),
    [live]
  );

  return (
    <>
      <Header
        username={profile?.username}
        xp={profile?.xp}
        level={profile?.level}
        streak={profile?.streak_count}
      />

      <DrillTabs active={tab} onSelect={setTab} />

      <div className="stats">
        <StatTile label="Score" value={score} sub={total ? `${right} of ${total} correct` : "answer to earn points"} />
        <StatTile label="Accuracy" value={total ? `${accuracy}%` : "—"} meterPercent={accuracy} />
        <StatTile label="Streak" value={streak} sub={`best ${best}`} />
        <StatTile label="Difficulty" value={difficulty} pips={difficulty} />
      </div>

      <div className="panel">
        <div className="qhead">
          <span className="kicker">{kicker}</span>
          {live?.question.chip && <span className="chip">{live.question.chip}</span>}
          <span className="chip">Level {difficulty}</span>
          <OpponentToggle mode={oppMode} onChange={handleMode} />
        </div>
        {live && (
          <DrillPlayer question={live.question} onAnswered={handleAnswered} onNext={handleNext} />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 11: Widen `recordAttempt` from outs-only to any kind**

In `lib/drill/recordAttempt.ts`, replace the `OutsDrillResult` interface, the `AttemptRequestBody.drill_kind` type, and `buildAttemptRequest`:

```ts
import type { DrillKind, OptionValue } from "./contract";

/** One answered question, from DrillShell. */
export interface DrillResult {
  kind: DrillKind;
  payload: Record<string, unknown>;
  answer: OptionValue;
  correct: boolean;
}

/** Body shape expected by `AttemptIn` in api/index.py. Names must match exactly. */
export interface AttemptRequestBody {
  drill_kind: DrillKind;
  drill_payload: Record<string, unknown>;
  answer: string;
  is_correct: boolean;
}

export function buildAttemptRequest(result: DrillResult): AttemptRequest {
  return {
    path: "/api/progress/attempts",
    body: {
      drill_kind: result.kind,
      drill_payload: result.payload,
      answer: String(result.answer),
      is_correct: result.correct,
    },
  };
}
```

Change `recordAttempt`'s parameter type from `OutsDrillResult` to `DrillResult`. Leave the fail-soft behaviour exactly as it is.

Then update `lib/drill/recordAttempt.test.ts`: the six existing tests keep their assertions but build a `DrillResult` (`{ kind: "outs", payload: { level: 2, oppMode: "unknown", spot }, answer: 9, correct: true }`) instead of an `OutsDrillResult`. Add one test:

```ts
test("buildAttemptRequest: drill_kind passes through for a non-outs kind", () => {
  const req = buildAttemptRequest({
    kind: "potodds",
    payload: { level: 1, oppMode: "unknown", pot: 150, call: 50 },
    answer: 25,
    correct: false,
  });
  assert.equal(req.body.drill_kind, "potodds");
  assert.equal(req.body.answer, "25");
  assert.equal(req.body.is_correct, false);
});
```

- [ ] **Step 12: Create the `/drill` page and redirect the old route**

Create `app/drill/page.tsx`:

```tsx
import { DrillShell, type Profile } from "@/components/drill/DrillShell";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";
import { TAB_ORDER, type TabId } from "@/lib/drill/registry";

/** Best-effort profile fetch — returns null, never throws, when Supabase is
 *  unconfigured, there is no session, or the row is missing. */
async function fetchProfile(): Promise<Profile | null> {
  if (!supabaseConfigured()) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, xp, level, streak_count")
    .eq("id", user.id)
    .single();
  return profile;
}

export default async function DrillPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab: TabId =
    tab && (TAB_ORDER as string[]).includes(tab) ? (tab as TabId) : "mixed";
  const profile = await fetchProfile();

  return (
    <div className="wrap">
      <DrillShell profile={profile} initialTab={initialTab} />
    </div>
  );
}
```

Replace `app/drill/outs/page.tsx` entirely:

```tsx
import { redirect } from "next/navigation";

/** M1 shipped this URL; M2 moved the drills onto one tabbed page. */
export default function OutsDrillPage() {
  redirect("/drill?tab=outs");
}
```

- [ ] **Step 13: Delete the superseded M1 files**

```bash
git rm components/drill/OutsDrill.tsx lib/drill/outsQuestion.ts lib/drill/outsQuestion.test.ts
```

Every assertion in `outsQuestion.test.ts` now lives in `opts.test.ts` (`withArticle`, option building) or `kinds/outs.test.ts` (answer correctness, formatting, street/label carry-through). Confirm before deleting by re-reading it; if an assertion has no new home, add it to the right new file first.

- [ ] **Step 14: Run the suites and the type checker**

Run: `npm test`
Expected: 0 failures. Count is 83 − 14 (deleted outsQuestion tests) + 11 (outs kind) + 1 (recordAttempt) = 81 passing.

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 15: Check it in a browser**

Run: `npm run dev:all` (or `npm run dev:all:bare` without credentials).
Open `http://localhost:3000/drill`. Confirm: the tab strip renders with Mixed, Count outs and Reference; a hand deals; keys 1–4 answer and N deals the next one; the Difficulty tile shows 1 and climbs to 2 after six correct answers in a row on the Count outs tab; flipping Opponent to face-up re-deals and shows the villain's cards plus a dead-outs note when one exists; `http://localhost:3000/drill/outs` redirects to `/drill?tab=outs`.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "feat: generic DrillPlayer, tab strip, and the outs drill on the M2 contract"
```

---

## Task 3: API — skill tags, skill_stats, and the drill-state endpoint

Independent of Task 2; the two can run in parallel.

**Files:**
- Create: `api/skills.py`, `api/test_skills.py`
- Create: `lib/drill/drillState.ts`, `lib/drill/drillState.test.ts`
- Modify: `api/index.py`, `api/test_progress.py`
- Modify: `components/drill/DrillShell.tsx` (seed the windows on mount — after Task 2 lands)

**Interfaces:**
- Consumes: `api/db.py::get_connection`, `api/deps.py::current_user_id`, `api/progress.py`.
- Produces:
  - `api/skills.py` → `SKILL_TAGS: dict[str, str]`, `DRILL_KINDS: tuple[str, ...]`, `skill_tag_for(kind: str) -> str`
  - `GET /api/progress/drill-state` → `{"windows": {kind: [bool, ...]}, "totals": {kind: {"total": int, "correct": int}}}`
  - `lib/drill/drillState.ts` → `export async function fetchDrillState(): Promise<DrillWindows | null>`, `export function windowsFromResponse(json: unknown): DrillWindows`

- [ ] **Step 1: Write the failing test for the tag map**

Create `api/test_skills.py`:

```python
from api.skills import DRILL_KINDS, SKILL_TAGS, skill_tag_for


def test_every_drill_kind_has_a_tag():
    assert set(SKILL_TAGS) == set(DRILL_KINDS)


def test_nine_kinds():
    assert len(DRILL_KINDS) == 9


def test_existing_stackschool_tags_are_reused_verbatim():
    # These tags already exist on lessons/scenarios, so drill and lesson
    # accuracy pool into one skill_stats row and M4's recommendations work.
    assert SKILL_TAGS["potodds"] == "pot_odds"
    assert SKILL_TAGS["decision"] == "pot_odds"
    assert SKILL_TAGS["bluff"] == "bluffing"
    assert SKILL_TAGS["concepts"] == "discipline"
    assert SKILL_TAGS["preflop"] == "hand_selection"


def test_new_tags_for_kinds_with_no_existing_home():
    assert SKILL_TAGS["outs"] == "counting_outs"
    assert SKILL_TAGS["rule24"] == "equity_estimation"
    assert SKILL_TAGS["implied"] == "implied_odds"
    assert SKILL_TAGS["ev"] == "expected_value"


def test_tags_are_snake_case_identifiers():
    for tag in SKILL_TAGS.values():
        assert tag == tag.lower()
        assert tag.replace("_", "").isalpha()


def test_skill_tag_for_rejects_an_unknown_kind():
    try:
        skill_tag_for("nonsense")
    except KeyError:
        return
    raise AssertionError("skill_tag_for must raise KeyError on an unknown kind")
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `.venv/bin/python -m pytest api/test_skills.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.skills'`.

- [ ] **Step 3: Implement the tag map**

Create `api/skills.py`:

```python
"""The ONE drill_kind -> skill_tag map.

Kept server-side only and deliberately absent from the drill contract, so the
browser can never report a tag it got wrong: it sends drill_kind, we derive
the tag.

Where StackSchool already has a tag that genuinely matches, we reuse it, so
drill accuracy and lesson accuracy accumulate on the same skill_stats row and
M4's recommendations can route a botched pot-odds drill to the pot-odds
lesson. Four kinds have no existing home and get new tags; M4 must tolerate a
weakest tag with no lesson behind it.
"""
from __future__ import annotations

SKILL_TAGS: dict[str, str] = {
    # reused from StackSchool's vocabulary
    "potodds": "pot_odds",
    "decision": "pot_odds",   # "call or fold" IS a pot-odds question
    "bluff": "bluffing",
    "concepts": "discipline",
    "preflop": "hand_selection",
    # new
    "outs": "counting_outs",
    "rule24": "equity_estimation",
    "implied": "implied_odds",
    "ev": "expected_value",
}

DRILL_KINDS: tuple[str, ...] = (
    "outs", "rule24", "potodds", "decision", "implied",
    "ev", "bluff", "concepts", "preflop",
)


def skill_tag_for(kind: str) -> str:
    """The canonical skill tag for a drill kind. Raises KeyError if unknown."""
    return SKILL_TAGS[kind]
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `.venv/bin/python -m pytest api/test_skills.py -q`
Expected: 6 passed.

- [ ] **Step 5: Write the failing tests for the endpoint changes**

Append to `api/test_progress.py` (it already has the pattern for building an `AttemptIn` and for the SQL-shape assertions — follow whatever is there rather than inventing a second style; read the file first):

```python
import pytest
from pydantic import ValidationError

from api.index import AttemptIn, DRILL_STATE_SQL, SKILL_STATS_SQL


def test_attempt_in_rejects_an_unknown_drill_kind():
    with pytest.raises(ValidationError):
        AttemptIn(drill_kind="nonsense", drill_payload={}, answer="9", is_correct=True)


def test_attempt_in_accepts_every_real_drill_kind():
    from api.skills import DRILL_KINDS
    for kind in DRILL_KINDS:
        got = AttemptIn(drill_kind=kind, drill_payload={}, answer="9", is_correct=True)
        assert got.drill_kind == kind


def test_attempt_in_caps_the_answer_length():
    with pytest.raises(ValidationError):
        AttemptIn(drill_kind="outs", drill_payload={}, answer="x" * 300, is_correct=True)


def test_skill_stats_sql_increments_rather_than_overwriting():
    sql = " ".join(SKILL_STATS_SQL.split())
    assert "on conflict (user_id, skill_tag) do update" in sql.lower()
    # the increment must come from the existing row, never a read-modify-write
    assert "skill_stats.total_attempts + 1" in sql
    assert "skill_stats.correct_attempts + excluded.correct_attempts" in sql


def test_drill_state_sql_windows_the_last_ten_per_kind():
    sql = " ".join(DRILL_STATE_SQL.split()).lower()
    assert "row_number() over (partition by drill_kind" in sql
    assert "order by created_at desc" in sql
    assert "rn <= 10" in sql
    assert "drill_kind is not null" in sql
    # RLS is belt; the explicit predicate is braces
    assert "user_id = %s" in sql
```

- [ ] **Step 6: Run them to confirm they fail**

Run: `.venv/bin/python -m pytest api/test_progress.py -q`
Expected: FAIL — `ImportError: cannot import name 'DRILL_STATE_SQL'`.

- [ ] **Step 7: Implement the endpoint changes**

In `api/index.py`:

Add to the imports:

```python
from typing import Any, Literal

from api.skills import DRILL_KINDS, skill_tag_for
```

Replace `AttemptIn`:

```python
class AttemptIn(BaseModel):
    drill_kind: Literal[
        "outs", "rule24", "potodds", "decision", "implied",
        "ev", "bluff", "concepts", "preflop",
    ]
    drill_payload: dict
    answer: str = Field(max_length=256)
    is_correct: bool
```

Import `Field` from pydantic alongside `BaseModel`.

Add the two SQL constants at module level, so tests can assert their shape without a database:

```python
SKILL_STATS_SQL = """
    insert into skill_stats (user_id, skill_tag, total_attempts, correct_attempts)
    values (%s, %s, 1, %s)
    on conflict (user_id, skill_tag) do update
    set total_attempts   = skill_stats.total_attempts + 1,
        correct_attempts = skill_stats.correct_attempts + excluded.correct_attempts
"""

DRILL_STATE_SQL = """
    select drill_kind, is_correct
    from (
      select drill_kind, is_correct,
             row_number() over (partition by drill_kind
                                order by created_at desc, id desc) as rn
      from attempts
      where user_id = %s and drill_kind is not null
    ) t
    where rn <= 10
    order by drill_kind, rn desc
"""

DRILL_TOTALS_SQL = """
    select drill_kind, count(*), count(*) filter (where is_correct)
    from attempts
    where user_id = %s and drill_kind is not null
    group by drill_kind
"""
```

In `record_attempt`, immediately after the `insert into attempts` execute and before the XP block:

```python
                # 1b. Skill stats. The tag is derived server-side from
                # drill_kind so the client cannot report the wrong one.
                cur.execute(
                    SKILL_STATS_SQL,
                    (user_id, skill_tag_for(body.drill_kind), 1 if body.is_correct else 0),
                )
```

Add the new endpoint after `record_attempt`:

```python
@app.get("/api/progress/drill-state")
def drill_state(user_id: str = Depends(current_user_id)) -> Any:
    """Per-drill rolling windows so adaptive difficulty survives a reload.

    Read-only and fail-soft by design: the client treats any error as "no
    history", which simply starts every drill at level 1.
    """
    windows: dict[str, list[bool]] = {kind: [] for kind in DRILL_KINDS}
    totals: dict[str, dict[str, int]] = {}

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(DRILL_STATE_SQL, (user_id,))
            for kind, is_correct in cur.fetchall():
                if kind in windows:
                    windows[kind].append(bool(is_correct))

            cur.execute(DRILL_TOTALS_SQL, (user_id,))
            for kind, total, correct in cur.fetchall():
                if kind in windows:
                    totals[kind] = {"total": int(total), "correct": int(correct)}
        conn.commit()

    return {"windows": windows, "totals": totals}
```

- [ ] **Step 8: Run the Python suite**

Run: `.venv/bin/python -m pytest api/ -q`
Expected: 17 + 6 + 5 = 28 passed.

- [ ] **Step 9: Write the failing test for the client fetch**

Create `lib/drill/drillState.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { windowsFromResponse } from "./drillState";
import { DRILL_KINDS } from "./contract";
import { WINDOW_SIZE } from "./difficulty";

test("windowsFromResponse: fills every kind, even ones absent from the response", () => {
  const w = windowsFromResponse({ windows: { outs: [true, false] } });
  assert.deepEqual(Object.keys(w).sort(), [...DRILL_KINDS].sort());
  assert.deepEqual(w.outs, [true, false]);
  assert.deepEqual(w.preflop, []);
});

test("windowsFromResponse: caps a window at WINDOW_SIZE, keeping the most recent", () => {
  const many = Array.from({ length: 25 }, (_, i) => i % 2 === 0);
  const w = windowsFromResponse({ windows: { outs: many } });
  assert.equal(w.outs.length, WINDOW_SIZE);
  assert.deepEqual(w.outs, many.slice(-WINDOW_SIZE));
});

test("windowsFromResponse: coerces to booleans and drops non-arrays", () => {
  const w = windowsFromResponse({ windows: { outs: [1, 0, true], ev: "nope" } });
  assert.deepEqual(w.outs, [true, false, true]);
  assert.deepEqual(w.ev, []);
});

test("windowsFromResponse: garbage in gives empty windows, never a throw", () => {
  for (const junk of [null, undefined, 42, "x", {}, { windows: null }, { windows: [] }]) {
    const w = windowsFromResponse(junk);
    assert.deepEqual(Object.keys(w).sort(), [...DRILL_KINDS].sort());
    for (const k of DRILL_KINDS) assert.deepEqual(w[k], []);
  }
});

test("windowsFromResponse: ignores kinds that are not real drill kinds", () => {
  const w = windowsFromResponse({ windows: { nonsense: [true, true] } });
  assert.equal("nonsense" in w, false);
});
```

- [ ] **Step 10: Run it to confirm it fails**

Run: `npx tsx --test lib/drill/drillState.test.ts`
Expected: FAIL — `Cannot find module './drillState.js'`.

- [ ] **Step 11: Implement the client fetch**

Create `lib/drill/drillState.ts`:

```ts
import { createClient } from "../supabase/client";
import { supabaseConfigured } from "../supabase/env";
import { DRILL_KINDS, type DrillKind } from "./contract";
import { emptyWindows, WINDOW_SIZE, type DrillWindows } from "./difficulty";

const KINDS = new Set<string>(DRILL_KINDS);

/**
 * Defensive parse: any shape that is not what we expect yields empty windows,
 * which simply starts every drill at level 1. Never throws.
 */
export function windowsFromResponse(json: unknown): DrillWindows {
  const out = emptyWindows();
  const raw = (json as { windows?: unknown })?.windows;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KINDS.has(kind) || !Array.isArray(value)) continue;
    out[kind as DrillKind] = value.map(Boolean).slice(-WINDOW_SIZE);
  }
  return out;
}

/**
 * Seed the difficulty windows from history. Returns null (and the caller keeps
 * empty windows) whenever Supabase is unconfigured, there is no session, or
 * the request fails — difficulty seeding is never on the critical path.
 */
export async function fetchDrillState(): Promise<DrillWindows | null> {
  if (!supabaseConfigured()) return null;
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const res = await fetch("/api/progress/drill-state", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      console.warn(`fetchDrillState: responded ${res.status}`);
      return null;
    }
    return windowsFromResponse(await res.json());
  } catch (err) {
    console.warn("fetchDrillState: failed", err);
    return null;
  }
}
```

- [ ] **Step 12: Run it to confirm it passes**

Run: `npx tsx --test lib/drill/drillState.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 13: Seed the windows in `DrillShell` (requires Task 2)**

In `components/drill/DrillShell.tsx`, add the import and one effect. The initial deal already happens on mount; this replaces the windows once history arrives and lets the *next* deal use the seeded level.

```tsx
import { fetchDrillState } from "@/lib/drill/drillState";

  // Seed difficulty from history. Fails soft: no session, no network, no
  // problem — every window just stays empty and difficulty starts at 1.
  useEffect(() => {
    let cancelled = false;
    void fetchDrillState().then((seeded) => {
      if (cancelled || !seeded) return;
      setWindows(seeded);
      setLevels((prev) => {
        const next = { ...prev };
        for (const kind of DRILL_KINDS) {
          next[kind] = nextLevel(seeded[kind], prev[kind] ?? 1);
        }
        return next;
      });
    });
    return () => { cancelled = true; };
  }, []);
```

Import `DRILL_KINDS` from `@/lib/drill/contract`.

- [ ] **Step 14: Run both suites, the type checker and the linter**

Run: `npm test` → expected 86 passing, 0 failures.
Run: `.venv/bin/python -m pytest api/ -q` → expected 28 passed.
Run: `npx tsc --noEmit` → no errors.
Run: `npm run lint` → no errors.

- [ ] **Step 15: Verify the endpoint against the real database**

Run `npm run dev:all`. Sign in as the test account in `.env.local`, answer three outs questions, reload `/drill?tab=outs`, and confirm in the browser's network tab that `GET /api/progress/drill-state` returns 200 with three booleans under `windows.outs`. Then check the row landed:

```bash
psql "$DATABASE_URL" -c "select skill_tag, total_attempts, correct_attempts from skill_stats order by skill_tag;"
```

Expected: one `counting_outs` row whose `total_attempts` equals the number of questions you answered. If it is empty, suspect a missing RLS policy before suspecting the query — `skill_stats` has an "own rows" policy in migration `0001`.

- [ ] **Step 16: Commit**

```bash
git add api/skills.py api/test_skills.py api/index.py api/test_progress.py \
        lib/drill/drillState.ts lib/drill/drillState.test.ts components/drill/DrillShell.tsx
git commit -m "feat: skill_stats upsert, drill-state seeding, and Literal drill kinds"
```

---

## Tasks 4–11: the eight remaining generators (parallel fan-out)

These eight tasks are independent. Dispatch them in parallel once Task 2 has landed, using `superpowers:dispatching-parallel-agents`.

**Every one of these tasks follows the same six steps.** They are written out per task below only where the code differs; the shared procedure is:

0. Open the test file with the two shared invariant helpers from `lib/drill/kinds/assertions.ts` (created in Task 2), then add the kind-specific tests:

```ts
import { assertCommonShape, assertDeterministic } from "./assertions";

test("<kind>: satisfies the shared question invariants", () => {
  assertCommonShape(generateX, "<kind>");
});

test("<kind>: deterministic under a seed", () => {
  assertDeterministic(generateX);
});
```

1. Write the test file first, in full.
2. Run `npx tsx --test lib/drill/kinds/<kind>.test.ts` and confirm it fails with a missing module.
3. Write the generator.
4. Run the test file and confirm it passes.
5. Register the kind: add `import { generateX } from "./kinds/<kind>";` and `<kind>: generateX,` to `GENERATORS` in `lib/drill/registry.ts`. Run `npm test` and `npx tsc --noEmit`.
6. Commit with `feat: add the <name> drill`.

**Shared rules for all eight, non-negotiable:**

- Import poker math from `lib/poker/math.ts`. Never re-derive a formula inline. The mapping from the reference's helpers to ours is:

  | Reference (lines 364–371) | Ours in `lib/poker/math.ts` |
  |---|---|
  | `reqEquity(pot, call)` | `requiredEquity(pot, call)` |
  | `evCall(e, pot, call)` | `evOfCall(equity, pot, call)` |
  | `bluffBE(potBefore, bet)` | `breakEvenFoldRate(potBefore, bet)` |
  | `mdf(potBefore, bet)` | `minDefenceFrequency(potBefore, bet)` |
  | `impliedNeeded(e, pot, call)` | `impliedOddsNeeded(equity, pot, call)` |
  | `trueTwoCard(n)` | `hitByRiver(n)` |
  | `trueOneCard(n)` | `hitOnRiver(n)` |
  | `oddsStr(e)` | `asOdds(equity)` |
  | `pct`, `money`, `roundTo`, `pick`, `shuffle`, `buildOpts` | `lib/drill/opts.ts` |

- `pot` is always the total AFTER villain's bet; `call` is always what it costs. Where the reference names a variable `pot` but means the pot before the bet (`Q.bluff`, `Q.rule24`'s pot arguments), rename it `potBefore` in our port.
- Every generator takes its randomness from `ctx.rng`. No `Math.random()` anywhere in `lib/drill/`.
- Every payload includes `level: ctx.level` and `oppMode: ctx.oppMode`, and must be JSON-round-trippable.
- Prose (prompts, subs, notes) is copied from the reference so the pedagogy survives the port. Straight-quote it or keep the curly quotes consistently; don't mix.
- **Annotate note arrays as `ExplainNote[]`.** Writing `const notes = [{ tone: "plain", ... }]` lets the first element's literal type narrow the whole array, and every later `notes.push({ tone: "warn", ... })` then fails to compile with `Type '"warn"' is not assignable to type '"plain"'`. This bit the outs generator in Task 2; the fix is `const notes: ExplainNote[] = [...]` with no `as const`. Same applies to `ExplainRow[]` and `ViewBlock[]` arrays you build up conditionally. Import the types from `../contract.js`.
- The shared invariants (option arity vs layout, exactly one correct option, non-empty explanation, payload carries `level`/`oppMode` and is JSON-clean, determinism under a seed) come from `assertCommonShape` and `assertDeterministic` — do not re-implement them per kind. On top of those, every kind's test file must add a **"the answer is re-derivable from the payload alone"** test: recompute the answer from the JSON-round-tripped payload using `lib/poker/math.ts`, and assert it equals `q.answer`. That test is what keeps eight independently written generators honest about the betting convention, and its kind-specific form is spelled out in each task below.

---

### Task 4: Rule of 2 & 4 drill

**Files:** Create `lib/drill/kinds/rule24.ts`, `lib/drill/kinds/rule24.test.ts`. Modify `lib/drill/registry.ts`.
**Reference:** lines 628–662 (`Q.rule24`).
**Interfaces:** Consumes `dealOutsSpot` from `lib/drill/kinds/outs.js` (reuse it — do not re-implement spot dealing), `ruleOf2And4`, `ruleOf4Corrected`, `hitByRiver`, `hitOnRiver`. Produces `export const generateRule24: Generator`.

- [ ] **Step 1: Write the test file**

Include the four shared tests, plus:

```ts
test("rule24: the answer is exactly the uncorrected rule — outs×4 on the flop, outs×2 on the turn", () => {
  for (let seed = 1; seed <= 80; seed++) {
    const q = generateRule24({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const { spot, street } = q.payload as { spot: Spot; street: "flop" | "turn" };
    assert.equal(q.answer, ruleOf2And4(spot.outs, street === "flop" ? 2 : 1));
  }
});

test("rule24: the explanation's true chance comes from the engine, not the rule", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const q = generateRule24({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const { spot, street } = q.payload as { spot: Spot; street: "flop" | "turn" };
    const truth = street === "flop" ? hitByRiver(spot.outs) : hitOnRiver(spot.outs);
    const row = q.explain(q.answer).rows.find((r) => /true chance/i.test(r.label));
    assert.ok(row);
    assert.equal(row!.value, pct(truth));
  }
});

test("rule24: above 8 outs on the flop, the correction is shown with ruleOf4Corrected", () => {
  let checked = 0;
  for (let seed = 1; seed <= 400 && checked < 5; seed++) {
    const q = generateRule24({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const { spot, street } = q.payload as { spot: Spot; street: "flop" | "turn" };
    if (street !== "flop" || spot.outs <= 8) continue;
    checked++;
    const note = q.explain(q.answer).notes.find((n) => /drifts high/i.test(n.text));
    assert.ok(note, `seed ${seed}: no correction note for ${spot.outs} outs`);
    assert.ok(note!.text.includes(String(ruleOf4Corrected(spot.outs))));
  }
  assert.ok(checked > 0, "no >8-out flop spot was generated in 400 seeds — widen the search");
});

test("rule24: options are whole percentages in 1..100", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateRule24({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    for (const o of q.options) {
      const v = o.value as number;
      assert.ok(v > 0 && v <= 100, `bad option ${v}`);
    }
  }
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx --test lib/drill/kinds/rule24.test.ts` → FAIL, missing module.

- [ ] **Step 3: Write the generator**

Port lines 628–662. Structure:

```ts
export const generateRule24: Generator = (ctx) => {
  const street = ctx.rng() < 0.5 ? "flop" : "turn";
  const spot = dealOutsSpotOnStreet(ctx, street);   // dealOutsSpot, street forced
  const n = spot.outs;
  const est = ruleOf2And4(n, street === "flop" ? 2 : 1);
  const candidates = [ /* reference line 633-635, unchanged */ ];
  const options = buildOpts(est, candidates, 4, 1, ctx.rng).map(Math.round);
  // ... kicker "Rule of 2 and 4", chip "Two cards to come" / "One card to come"
  // explain rows: Outs, Rule applied, Rule estimate, True chance of hitting
  //   (hitByRiver / hitOnRiver), Estimate error in points
  // note: >8 outs on the flop → the correction note, using ruleOf4Corrected(n);
  //   otherwise the flop "×4 assumes you see both cards" note or the turn note
  payload: { level: ctx.level, oppMode: ctx.oppMode, street, spot },
};
```

`dealSpotOnStreet(ctx, street)` is already exported from `lib/drill/kinds/outs.ts` (Task 2) and handles both opponent modes. Import and use it — do not write another spot dealer.

- [ ] **Step 4: Run the test file** → PASS.
- [ ] **Step 5: Register and run the full suites** — add to `GENERATORS`; `npm test`, `npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `git commit -m "feat: add the rule of 2 and 4 drill"`

---

### Task 5: Pot odds drill

**Files:** Create `lib/drill/kinds/potodds.ts`, `lib/drill/kinds/potodds.test.ts`. Modify `lib/drill/registry.ts`.
**Reference:** lines 665–695 (`Q.potodds`).
**Interfaces:** Consumes `requiredEquity`, `asOdds`. Produces `export const generatePotodds: Generator`.

This is the drill where the betting convention is easiest to get wrong. Note the reference's variables: `potBefore` is the pot before villain bets, `bet` is their bet, `extra` is your own earlier bet when they raised, `pot = potBefore + bet + extra` (the total you win) and `call = bet − extra` (what it costs you *more*).

- [ ] **Step 1: Write the test file**

Include the four shared tests, plus:

```ts
test("potodds: the answer is requiredEquity(pot, call) to one decimal", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const q = generatePotodds({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const { pot, call } = q.payload as { pot: number; call: number };
    assert.equal(q.answer, +(requiredEquity(pot, call) * 100).toFixed(1));
  }
});

test("potodds: pot is the total AFTER the bet and call is what it costs more", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const q = generatePotodds({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { potBefore: number; bet: number; extra: number; pot: number; call: number };
    assert.equal(p.pot, p.potBefore + p.bet + p.extra);
    assert.equal(p.call, p.bet - p.extra);
    assert.ok(p.call > 0, `seed ${seed}: call must be positive`);
    assert.ok(p.pot > p.call, `seed ${seed}: pot must exceed the call`);
  }
});

test("potodds: raise spots improve the price versus treating your own bet as a cost", () => {
  // The OMC leak the drill teaches: your already-committed money is not a cost.
  for (let seed = 1; seed <= 200; seed++) {
    const q = generatePotodds({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { extra: number; pot: number; call: number };
    if (p.extra === 0) continue;
    const wrong = +(requiredEquity(p.pot, p.call + p.extra) * 100).toFixed(1);
    assert.ok((q.answer as number) < wrong);
  }
});

test("potodds: levels 1 and 2 never produce a raise spot; level 3 sometimes does", () => {
  for (const level of [1, 2] as DrillLevel[]) {
    for (let seed = 1; seed <= 60; seed++) {
      const q = generatePotodds({ level, oppMode: "unknown", rng: mulberry32(seed) });
      assert.equal((q.payload as { extra: number }).extra, 0);
    }
  }
  const anyRaise = Array.from({ length: 60 }, (_, i) =>
    generatePotodds({ level: 3, oppMode: "unknown", rng: mulberry32(i + 1) })
  ).some((q) => (q.payload as { extra: number }).extra > 0);
  assert.ok(anyRaise, "level 3 must sometimes deal a raise spot");
});

test("potodds: every option is a plausible percentage, distinct by at least 1.2 points", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const q = generatePotodds({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const values = q.options.map((o) => o.value as number);
    for (const v of values) assert.ok(v > 0 && v < 100);
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        assert.ok(Math.abs(values[i] - values[j]) >= 1.2);
      }
    }
  }
});
```

- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Write the generator.** Port lines 665–695. Level tables for `potBefore` and the bet fractions are at lines 667–670 — copy them exactly, including level 3's 50% chance of a raise spot. `extra` is `0` when there is no raise (never `null`, so the payload has a stable shape and the tests above can read it unconditionally). Body is a single `money` block with the four pills from line 683–684. The `explain` rows are lines 688–691 and the two notes are 692–693 (the second only for raise spots).
- [ ] **Step 4: Run the test file** → PASS.
- [ ] **Step 5: Register; `npm test`; `npx tsc --noEmit`.**
- [ ] **Step 6: Commit** — `git commit -m "feat: add the pot odds drill"`

---

### Task 6: Call-or-fold drill

**Files:** Create `lib/drill/kinds/decision.ts`, `lib/drill/kinds/decision.test.ts`. Modify `lib/drill/registry.ts`.
**Reference:** lines 698–736 (`Q.decision`).
**Interfaces:** Consumes `dealSpotOnStreet` from `kinds/outs.js`, `requiredEquity`, `evOfCall`, `ruleOf2And4`, `describeOuts`, `deadOuts`. Produces `export const generateDecision: Generator`.

- [ ] **Step 1: Write the test file**

Include the four shared tests, plus:

```ts
test("decision: the answer is call exactly when equity >= required equity", () => {
  for (let seed = 1; seed <= 120; seed++) {
    for (const oppMode of ["unknown", "shown"] as const) {
      const q = generateDecision({ level: 2, oppMode, rng: mulberry32(seed) });
      const p = q.payload as { spot: Spot; pot: number; call: number };
      const req = requiredEquity(p.pot, p.call);
      assert.equal(q.answer, p.spot.equity >= req ? "call" : "fold");
    }
  }
});

test("decision: two options, exactly Call and Fold", () => {
  const q = generateDecision({ level: 1, oppMode: "unknown", rng: mulberry32(4) });
  assert.equal(q.layout, "two");
  assert.deepEqual(q.options.map((o) => o.value).sort(), ["call", "fold"]);
});

test("decision: the EV row agrees with evOfCall on the payload", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateDecision({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { spot: Spot; pot: number; call: number };
    const ev = evOfCall(p.spot.equity, p.pot, p.call);
    const row = q.explain(q.answer).rows.find((r) => /EV of calling/i.test(r.label));
    assert.ok(row);
    assert.equal(row!.value, signedMoney(ev));
  }
});

test("decision: pot is potBefore + bet and call equals the bet", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateDecision({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { potBefore: number; bet: number; pot: number; call: number };
    assert.equal(p.pot, p.potBefore + p.bet);
    assert.equal(p.call, p.bet);
  }
});

test("decision: most spots are close ones, so the drill is not trivially one-sided", () => {
  const answers = Array.from({ length: 200 }, (_, i) =>
    generateDecision({ level: 2, oppMode: "unknown", rng: mulberry32(i + 1) }).answer
  );
  const calls = answers.filter((a) => a === "call").length;
  assert.ok(calls > 40 && calls < 160, `lopsided: ${calls}/200 calls`);
});

test("decision: face-up mode lists dead outs when there are any", () => {
  let found = 0;
  for (let seed = 1; seed <= 200 && found < 3; seed++) {
    const q = generateDecision({ level: 3, oppMode: "shown", rng: mulberry32(seed) });
    const p = q.payload as { spot: Spot };
    if (!deadOuts(p.spot.hero, p.spot.villain!, p.spot.board).length) continue;
    found++;
    assert.ok(q.explain(q.answer).notes.some((n) => /dead out/i.test(n.title ?? "" + n.text)));
  }
  assert.ok(found > 0, "no dead-out spot in 200 seeds — widen the search");
});
```

- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Write the generator.** Port lines 698–736. The "close spot" construction at lines 704–709 is what keeps the drill honest — port it exactly, including the clamp to `[0.2, 2]` and the `Math.max(5, roundTo(potBefore*frac, 5))` bet. Rename the reference's `potBefore`/`pot` consistently with our convention. The explain rows are lines 722–729; the outcome note is 730–732; the implied-odds caveat at 734 always shows.
- [ ] **Step 4: Run the test file** → PASS.
- [ ] **Step 5: Register; `npm test`; `npx tsc --noEmit`.**
- [ ] **Step 6: Commit** — `git commit -m "feat: add the call-or-fold drill"`

---

### Task 7: Implied odds drill

**Files:** Create `lib/drill/kinds/implied.ts`, `lib/drill/kinds/implied.test.ts`. Modify `lib/drill/registry.ts`.
**Reference:** lines 739–797 (`Q.implied`) — two modes: a math question (62%) and a concept question from a 6-item bank.
**Interfaces:** Consumes `dealSpotOnStreet`, `impliedOddsNeeded`, `requiredEquity`. Produces `export const generateImplied: Generator`.

- [ ] **Step 1: Write the test file**

Include the four shared tests (noting that this kind's `layout` is `"grid3"` in math mode and `"one"` in concept mode, so the shared shape test must allow both), plus:

```ts
test("implied: math mode's answer is impliedOddsNeeded rounded to the nearest 5", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 40; seed++) {
    const q = generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; spot?: Spot; pot?: number; call?: number };
    if (p.mode !== "math") continue;
    checked++;
    const need = impliedOddsNeeded(p.spot!.equity, p.pot!, p.call!);
    assert.equal(q.answer, Math.max(5, roundTo(need, 5)));
  }
  assert.ok(checked > 0);
});

test("implied: math mode only ever asks when the direct call is losing", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generateImplied({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; spot?: Spot; pot?: number; call?: number };
    if (p.mode !== "math") continue;
    // a positive implied requirement is what makes the question meaningful
    assert.ok(impliedOddsNeeded(p.spot!.equity, p.pot!, p.call!) > 0, `seed ${seed}`);
    assert.ok(p.spot!.equity < requiredEquity(p.pot!, p.call!), `seed ${seed}`);
  }
});

test("implied: math mode is always a turn spot — one card to come", () => {
  for (let seed = 1; seed <= 120; seed++) {
    const q = generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; spot?: Spot };
    if (p.mode === "math") assert.equal(p.spot!.street, "turn");
  }
});

test("implied: concept mode has 4 options, the single-column layout, and an id in the payload", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 6; seed++) {
    const q = generateImplied({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; conceptId?: number };
    if (p.mode !== "concept") continue;
    checked++;
    assert.equal(q.layout, "one");
    assert.equal(q.options.length, 4);
    assert.equal(typeof p.conceptId, "number");
    assert.equal(q.body.length, 0);
  }
  assert.ok(checked > 0);
});

test("implied: concept answers survive shuffling — the answer value indexes the right option", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generateImplied({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; conceptId?: number };
    if (p.mode !== "concept") continue;
    const correct = q.options.find((o) => o.value === q.answer);
    assert.ok(correct, `seed ${seed}: answer not among options`);
    assert.equal(CONCEPT_BANK[p.conceptId!].options[0], correct!.label);
  }
});

test("implied: both modes appear across seeds", () => {
  const modes = new Set(
    Array.from({ length: 80 }, (_, i) =>
      (generateImplied({ level: 2, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { mode: string }).mode
    )
  );
  assert.deepEqual([...modes].sort(), ["concept", "math"]);
});
```

- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Write the generator.** Port lines 739–797. Export the concept bank as `export const CONCEPT_BANK` so the test can assert the answer survived shuffling — each entry `{ prompt, options: string[], explain }` with `options[0]` the correct one (as the reference has it, `a:0`), and shuffle at generation time carrying the correct value along. Level does not change the concept bank. The bet-size escalation at line 746 (bump to 1.75× pot when the implied requirement is not positive) is what guarantees the question is meaningful — port it, and if it still is not positive, re-deal rather than emit a degenerate question.
- [ ] **Step 4: Run the test file** → PASS.
- [ ] **Step 5: Register; `npm test`; `npx tsc --noEmit`.**
- [ ] **Step 6: Commit** — `git commit -m "feat: add the implied odds drill"`

---

### Task 8: Expected value drill

**Files:** Create `lib/drill/kinds/ev.ts`, `lib/drill/kinds/ev.test.ts`. Modify `lib/drill/registry.ts`.
**Reference:** lines 800–856 (`Q.ev`) — two modes: EV of a call (55%) and EV of a semi-bluff shove with fold equity.
**Interfaces:** Consumes `evOfCall`, `requiredEquity`. Produces `export const generateEv: Generator`.

- [ ] **Step 1: Write the test file**

Include the four shared tests, plus:

```ts
test("ev: call mode's answer is evOfCall to one decimal", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 40; seed++) {
    const q = generateEv({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; equity: number; pot: number; call: number };
    if (p.mode !== "call") continue;
    checked++;
    assert.equal(q.answer, +evOfCall(p.equity, p.pot, p.call).toFixed(1));
  }
  assert.ok(checked > 0);
});

test("ev: shove mode's answer is the two-branch fold-equity EV to one decimal", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 40; seed++) {
    const q = generateEv({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as {
      mode: string; potBefore: number; bet: number; foldRate: number; equityWhenCalled: number;
    };
    if (p.mode !== "shove") continue;
    checked++;
    const called =
      p.equityWhenCalled * (p.potBefore + p.bet) - (1 - p.equityWhenCalled) * p.bet;
    const ev = p.foldRate * p.potBefore + (1 - p.foldRate) * called;
    assert.equal(q.answer, +ev.toFixed(1));
  }
  assert.ok(checked > 0);
});

test("ev: option labels carry an explicit sign", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const q = generateEv({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    for (const o of q.options) assert.match(o.label, /^[+−]\$/);
  }
});

test("ev: the answer appears once even when a distractor equals its negation", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generateEv({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    assert.equal(q.options.filter((o) => o.value === q.answer).length, 1, `seed ${seed}`);
  }
});

test("ev: call mode shows the break-even equity from requiredEquity", () => {
  let checked = 0;
  for (let seed = 1; seed <= 200 && checked < 10; seed++) {
    const q = generateEv({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; pot: number; call: number };
    if (p.mode !== "call") continue;
    checked++;
    const row = q.explain(q.answer).rows.find((r) => /break-even equity/i.test(r.label));
    assert.ok(row);
    assert.equal(row!.value, pct(requiredEquity(p.pot, p.call)));
  }
  assert.ok(checked > 0);
});

test("ev: both modes appear across seeds", () => {
  const modes = new Set(
    Array.from({ length: 80 }, (_, i) =>
      (generateEv({ level: 2, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { mode: string }).mode
    )
  );
  assert.deepEqual([...modes].sort(), ["call", "shove"]);
});
```

- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Write the generator.** Port lines 800–856. Note that in shove mode the reference's `pot` is the pot *before* the bet — name it `potBefore` in our port, and keep `potIfCalled = potBefore + 2*bet` for the explanation only. Both modes emit a single `money` block. `pick` the equity values from the level-dependent tables at lines 806 and 833. Explain rows are 819–824 (call) and 848–853 (shove); notes are 825–826 and 854.
- [ ] **Step 4: Run the test file** → PASS.
- [ ] **Step 5: Register; `npm test`; `npx tsc --noEmit`.**
- [ ] **Step 6: Commit** — `git commit -m "feat: add the expected value drill"`

---

### Task 9: Bluff math drill

**Files:** Create `lib/drill/kinds/bluff.ts`, `lib/drill/kinds/bluff.test.ts`. Modify `lib/drill/registry.ts`.
**Reference:** lines 859–922 (`Q.bluff`) — three sub-kinds picked as `["be","be","mdf","size"]`, so break-even appears twice as often.
**Interfaces:** Consumes `breakEvenFoldRate`, `minDefenceFrequency`, `bluffSizeForFoldRate`. Produces `export const generateBluff: Generator`.

- [ ] **Step 1: Write the test file**

Include the four shared tests, plus:

```ts
test("bluff: break-even mode's answer is breakEvenFoldRate(potBefore, bet)", () => {
  let checked = 0;
  for (let seed = 1; seed <= 300 && checked < 40; seed++) {
    const q = generateBluff({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; potBefore: number; bet: number };
    if (p.mode !== "be") continue;
    checked++;
    assert.equal(q.answer, +(breakEvenFoldRate(p.potBefore, p.bet) * 100).toFixed(1));
  }
  assert.ok(checked > 0);
});

test("bluff: MDF mode's answer is minDefenceFrequency(potBefore, bet)", () => {
  let checked = 0;
  for (let seed = 1; seed <= 300 && checked < 25; seed++) {
    const q = generateBluff({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; potBefore: number; bet: number };
    if (p.mode !== "mdf") continue;
    checked++;
    assert.equal(q.answer, +(minDefenceFrequency(p.potBefore, p.bet) * 100).toFixed(1));
  }
  assert.ok(checked > 0);
});

test("bluff: MDF and break-even are complements at the same price", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const q = generateBluff({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; potBefore: number; bet: number };
    if (p.mode === "size") continue;
    const be = breakEvenFoldRate(p.potBefore, p.bet);
    const mdf = minDefenceFrequency(p.potBefore, p.bet);
    assert.ok(Math.abs(be + mdf - 1) < 1e-9, `seed ${seed}: ${be} + ${mdf}`);
  }
});

test("bluff: size mode's answer is the pot percentage that needs exactly the stated fold rate", () => {
  let checked = 0;
  for (let seed = 1; seed <= 300 && checked < 25; seed++) {
    const q = generateBluff({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const p = q.payload as { mode: string; foldRate: number };
    if (p.mode !== "size") continue;
    checked++;
    assert.equal(q.answer, Math.round(bluffSizeForFoldRate(p.foldRate) * 100));
    // and the round trip holds: a bet of that size needs that many folds
    const asFraction = (q.answer as number) / 100;
    assert.ok(Math.abs(breakEvenFoldRate(1, asFraction) - p.foldRate) < 0.01);
  }
  assert.ok(checked > 0);
});

test("bluff: all three modes appear, with break-even the most common", () => {
  const modes = Array.from({ length: 400 }, (_, i) =>
    (generateBluff({ level: 2, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { mode: string }).mode
  );
  for (const m of ["be", "mdf", "size"]) assert.ok(modes.includes(m), `missing mode ${m}`);
  const be = modes.filter((m) => m === "be").length;
  assert.ok(be > modes.filter((m) => m === "mdf").length, "break-even should be weighted 2x");
});
```

- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Write the generator.** Port lines 859–922. The reference's `pot` throughout this generator is the pot **before** the bluff — name it `potBefore`. `bet=roundTo(potBefore*frac,5)||5` keeps the bet non-zero; keep that guard. Explain rows: 876–878 (be), 895–898 (mdf), 916–919 (size). Notes: 879–880, 899–900, 920.
- [ ] **Step 4: Run the test file** → PASS.
- [ ] **Step 5: Register; `npm test`; `npx tsc --noEmit`.**
- [ ] **Step 6: Commit** — `git commit -m "feat: add the bluff math drill"`

---

### Task 10: OMC mistakes (concepts) drill

**Files:** Create `lib/drill/kinds/concepts.ts`, `lib/drill/kinds/concepts.test.ts`. Modify `lib/drill/registry.ts`.
**Reference:** lines 925–978 — a 16-item bank (`CONCEPTS`) and `Q.concepts`.
**Interfaces:** Produces `export const generateConcepts: Generator`, `export const CONCEPTS: ConceptItem[]`.

This one has no poker math to get wrong, but it has a trap the reference itself contains: **item index 9 (line 953–955) has `a:2`, not `a:0`** — its correct answer is the third option, and options 0 and 2 say nearly the same thing. Port the bank with an explicit correct index per item; do not assume index 0.

- [ ] **Step 1: Write the test file**

Include the four shared tests, plus:

```ts
test("concepts: the bank is fully populated and internally consistent", () => {
  assert.equal(CONCEPTS.length, 16);
  for (const [i, item] of CONCEPTS.entries()) {
    assert.ok(item.prompt.length > 10, `item ${i}: prompt`);
    assert.equal(item.options.length, 4, `item ${i}: four options`);
    assert.equal(new Set(item.options).size, 4, `item ${i}: distinct options`);
    assert.ok(item.correct >= 0 && item.correct < 4, `item ${i}: correct index in range`);
    assert.ok(item.explain.length > 20, `item ${i}: explanation`);
  }
});

test("concepts: the item whose correct answer is not the first option is preserved", () => {
  // reference line 954: a:2 — the $120/$40 call-or-fold item
  const item = CONCEPTS.find((c) => /Pot is \$120 after villain bets \$40/.test(c.prompt));
  assert.ok(item, "the $120/$40 item must exist");
  assert.equal(item!.correct, 2);
});

test("concepts: the graded answer always points at the item's correct option text", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const q = generateConcepts({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const item = CONCEPTS[(q.payload as { conceptId: number }).conceptId];
    const chosen = q.options.find((o) => o.value === q.answer);
    assert.ok(chosen, `seed ${seed}: answer not among options`);
    assert.equal(chosen!.label, item.options[item.correct], `seed ${seed}`);
  }
});

test("concepts: options are shuffled, not always in bank order", () => {
  const firsts = new Set(
    Array.from({ length: 60 }, (_, i) => {
      const q = generateConcepts({ level: 1, oppMode: "unknown", rng: mulberry32(i + 1) });
      const id = (q.payload as { conceptId: number }).conceptId;
      return `${id}:${q.options[0].label}`;
    })
  );
  assert.ok(firsts.size > 20, "options do not appear to be shuffled");
});

test("concepts: single-column layout, no board, and an explanation note", () => {
  const q = generateConcepts({ level: 2, oppMode: "unknown", rng: mulberry32(5) });
  assert.equal(q.layout, "one");
  assert.deepEqual(q.body, []);
  assert.ok(q.explain(q.answer).notes.length >= 1);
});

test("concepts: the whole bank is reachable", () => {
  const seen = new Set(
    Array.from({ length: 800 }, (_, i) =>
      (generateConcepts({ level: 1, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { conceptId: number }).conceptId
    )
  );
  assert.equal(seen.size, CONCEPTS.length);
});
```

- [ ] **Step 2: Run it and confirm it fails.**
- [ ] **Step 3: Write the generator.** Port the 16 items from lines 925–971 as `{ prompt, options, correct, explain }`, then `Q.concepts` from 972–978. Shuffle the options with `ctx.rng`, and set `answer` to the shuffled index of the correct option (or, more robustly, use the option *text* as the value — either is fine as long as the test above passes). Payload: `{ level, oppMode, conceptId }`.
- [ ] **Step 4: Run the test file** → PASS.
- [ ] **Step 5: Register; `npm test`; `npx tsc --noEmit`.**
- [ ] **Step 6: Commit** — `git commit -m "feat: add the OMC mistakes drill"`

---

### Task 11: Preflop drill

**Files:** Create `lib/drill/kinds/preflop.ts`, `lib/drill/kinds/preflop.test.ts`, `components/ui/RangeGrid.tsx`. Modify `lib/drill/registry.ts`, `components/drill/DrillPlayer.tsx` (wire the `grid` block).
**Reference:** lines 1096–1130 (`Q.preflop`), 1069–1094 (grid rendering, `dealPFHand`).
**Interfaces:** Consumes `lib/poker/ranges.ts` (`SCENARIOS`, `getScenario`, `cellFrequency`, `rangePercent`, `handAt`, `combosOf`, `dealGridHand`, `GRID_RANKS`). Produces `export const generatePreflop: Generator`, `export const MIX_THRESHOLD = 0.2`.

This is the only kind that uses `acceptable`, and the only one that renders a `grid` block.

- [ ] **Step 1: Write the test file**

Include the four shared tests (allowing `layout` to be `"two"` or `"grid3"` — scenarios have 2 or 3 actions), plus:

```ts
test("preflop: the answer is the highest-frequency action for the dealt hand", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generatePreflop({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const { scenarioId, hand } = q.payload as { scenarioId: string; hand: string };
    const sc = getScenario(scenarioId)!;
    const f = cellFrequency(sc, hand);
    // Scenario.actions is Array<[Action, string]> — [key, label] tuples.
    const best = sc.actions.map(([key]) => key).sort((x, y) => f[y] - f[x])[0];
    assert.equal(q.answer, best, `seed ${seed}: ${hand} in ${scenarioId}`);
  }
});

test("preflop: acceptable holds every action at >= 20% frequency, excluding the answer", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generatePreflop({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const { scenarioId, hand } = q.payload as { scenarioId: string; hand: string };
    const sc = getScenario(scenarioId)!;
    const f = cellFrequency(sc, hand);
    const expected = sc.actions
      .map(([key]) => key)
      .filter((k) => f[k] >= MIX_THRESHOLD && k !== q.answer)
      .sort();
    assert.deepEqual([...(q.acceptable ?? [])].sort(), expected, `seed ${seed}: ${hand}`);
  }
});

test("preflop: a pure hand has no acceptable alternatives", () => {
  // AA from UTG is a pure raise in every reference scenario that opens
  let checked = 0;
  for (let seed = 1; seed <= 500 && checked < 5; seed++) {
    const q = generatePreflop({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    const { hand } = q.payload as { hand: string };
    if (hand !== "AA") continue;
    checked++;
    assert.deepEqual(q.acceptable ?? [], []);
  }
  assert.ok(checked > 0, "AA never dealt in 500 seeds — widen the search");
});

test("preflop: the displayed cards match the named hand", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const q = generatePreflop({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
    const { hand, cards } = q.payload as { hand: string; cards: number[] };
    assert.equal(cards.length, 2);
    const ranks = cards.map((c) => RANKS[c >> 2]);
    const suited = (cards[0] & 3) === (cards[1] & 3);
    if (hand.length === 2) {
      assert.equal(ranks[0], ranks[1], `${hand} must be a pair`);
      assert.ok(!suited, "a pair cannot be suited");
    } else {
      assert.equal(suited, hand.endsWith("s"), `${hand} suitedness`);
      assert.deepEqual([...ranks].sort(), [hand[0], hand[1]].sort());
    }
  }
});

test("preflop: level 1 only uses the five opening scenarios", () => {
  const opens = SCENARIOS.slice(0, 5).map((s) => s.id);
  for (let seed = 1; seed <= 120; seed++) {
    const q = generatePreflop({ level: 1, oppMode: "unknown", rng: mulberry32(seed) });
    assert.ok(opens.includes((q.payload as { scenarioId: string }).scenarioId));
  }
});

test("preflop: levels 2+ reach the defence scenarios too", () => {
  const ids = new Set(
    Array.from({ length: 200 }, (_, i) =>
      (generatePreflop({ level: 3, oppMode: "unknown", rng: mulberry32(i + 1) }).payload as { scenarioId: string }).scenarioId
    )
  );
  assert.ok(ids.size > 5, "level 3 should reach beyond the opening scenarios");
});

test("preflop: higher levels weight toward hands that are actually decisions", () => {
  const pureFoldRate = (level: DrillLevel) => {
    let folds = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const q = generatePreflop({ level, oppMode: "unknown", rng: mulberry32(seed) });
      const { scenarioId, hand } = q.payload as { scenarioId: string; hand: string };
      if (cellFrequency(getScenario(scenarioId)!, hand).f >= 0.999) folds++;
    }
    return folds / 300;
  };
  assert.ok(pureFoldRate(3) < pureFoldRate(1), "level 3 should deal fewer trivial pure folds");
});

test("preflop: the explanation shows every action's frequency and labels the ranges as reference ranges", () => {
  const q = generatePreflop({ level: 2, oppMode: "unknown", rng: mulberry32(3) });
  const ex = q.explain(q.answer);
  const sc = getScenario((q.payload as { scenarioId: string }).scenarioId)!;
  for (const [, label] of sc.actions) {
    assert.ok(ex.rows.some((r) => r.label === label), `missing row for ${label}`);
  }
  assert.ok(ex.rows.some((r) => r.label === "Hand"));
  assert.ok(ex.blocks?.some((b) => b.type === "grid"));
  assert.ok(
    ex.notes.some((n) => /reference range/i.test(n.text)),
    "the ranges must be labelled as reference ranges, not solver output"
  );
});

test("preflop: payload is JSON-clean and re-grades to the same answer", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const q = generatePreflop({ level: 3, oppMode: "unknown", rng: mulberry32(seed) });
    const p = JSON.parse(JSON.stringify(q.payload)) as { scenarioId: string; hand: string };
    const f = cellFrequency(getScenario(p.scenarioId)!, p.hand);
    const sc = getScenario(p.scenarioId)!;
    const best = sc.actions.map(([key]) => key).sort((x, y) => f[y] - f[x])[0];
    assert.equal(best, q.answer);
  }
});
```

- [ ] **Step 2: Run it and confirm it fails.**

- [ ] **Step 3: Check the `lib/poker/ranges.ts` surface first**

Run: `grep -n "export interface Scenario" -A 20 lib/poker/ranges.ts`

Confirmed shape (`lib/poker/ranges.ts:46-54`): `Scenario` is `{ id, name, description, actions: Array<[Action, string]>, r, c? }`. The reference calls this field `acts`; ours is `actions`, and it holds `[key, label]` tuples — destructure them (`sc.actions.map(([key, label]) => …)`), never `a.key`. Also note `description`, not the reference's `desc`. `lib/poker/ranges.ts` is the tested engine and does not change to suit the port.

- [ ] **Step 4: Write the generator**

Port lines 1096–1119. Key points:
- `MIX_THRESHOLD = 0.2`, matching the reference's `isCorrect: v => f[v] >= 0.2`.
- `answer` = the highest-frequency action; `acceptable` = the other actions at ≥ `MIX_THRESHOLD`.
- Level 1 uses `SCENARIOS.slice(0, 5)` (the opens); levels 2–3 use all of them, and re-roll a pure-fold hand 75% of the time (reference lines 1099–1103) so high levels drill borderline hands.
- `body` is a `hand` block with the dealt cards (`dealGridHand`).
- `explain` returns one row per action with its percentage, a `Hand` row with the combo count, a `Scenario` row, the mixed / pure note (lines 1114–1115), **and** a note stating these are 6-max 100bb reference ranges in the shape solvers produce, not solver output. That note is mandatory — the roadmap calls it non-negotiable.
- `explain.blocks` carries `{ type: "grid", scenarioId, highlight: hand }`.
- Payload: `{ level, oppMode, scenarioId, hand, cards }`.

- [ ] **Step 5: Create `RangeGrid` and wire the `grid` block**

Create `components/ui/RangeGrid.tsx`, porting `gridHTML` and `legendHTML` (reference lines 1069–1088) to React. Use `cellFrequency` and `rangePercent` from `lib/poker/ranges.ts`; the `.grid13`, `.gc`, `.gc.dim`, `.gc.pick`, `.legend` and `.lg` classes already exist in `app/globals.css`. Split cells get the same `linear-gradient` background the reference builds. Include the legend with each action's range percentage and the "Total played" figure.

Then in `components/drill/DrillPlayer.tsx`, replace the `case "grid": return null;` line with:

```tsx
          case "grid":
            return <RangeGrid key={i} scenarioId={b.scenarioId} highlight={b.highlight} />;
```

and import it.

- [ ] **Step 6: Run the test file** → PASS.
- [ ] **Step 7: Register; `npm test`; `npx tsc --noEmit`; `npm run lint`.**
- [ ] **Step 8: Commit** — `git commit -m "feat: add the preflop range drill and the 13x13 grid"`

---

## Task 12: Reference tab

**Files:**
- Create: `components/drill/ReferenceTab.tsx`
- Modify: `components/drill/DrillShell.tsx` (render it when `tab === "reference"`)

**Reference:** the `REF` string in `reference/poker-math-trainer.html`. Find it with `grep -n "const REF" reference/poker-math-trainer.html` and read from there to the end of the template literal.

**Interfaces:** Consumes `lib/poker/math.ts` (`BET_SIZE_TABLE`, `ruleOf4Corrected`, `hitByRiver`, `minDefenceFrequency`, `breakEvenFoldRate`). Produces `export function ReferenceTab()`.

- [ ] **Step 1: Read the reference content**

Run: `grep -n "const REF" reference/poker-math-trainer.html` then read that block in full.

- [ ] **Step 2: Port it to a component**

Create `components/drill/ReferenceTab.tsx` as a plain server-safe component (no `"use client"` needed — it has no state). Sections, in order: the one-line identities (required equity, EV, break-even bluff, MDF), the pot-odds / bet-size table, the rule of 2 & 4 with the >8-outs correction, implied and reverse implied odds, and the OMC mistake list.

**Compute every number rather than hard-coding it.** The bet-size table's rows come from `BET_SIZE_TABLE` in `lib/poker/math.ts`; the rule-of-4 correction examples come from `ruleOf4Corrected` and `hitByRiver`. A hard-coded "15 outs = 54%" in this file is exactly the kind of number that silently rots when the engine is corrected — and a table whose figures disagree with the drills is worse than no table.

Include the reference-ranges caveat wherever preflop ranges are mentioned.

- [ ] **Step 3: Render it from the shell**

In `DrillShell`, when `tab === "reference"`, render `<div className="panel"><ReferenceTab /></div>` instead of the stats + question panel. The stat tiles may stay visible; the question panel must not render (there is no live question).

- [ ] **Step 4: Verify in the browser**

Run `npm run dev:all:bare`, open `/drill?tab=reference`. Confirm every table renders, no number is blank or `NaN`, and the figures agree with what the drills teach: a half-pot bet needs 33% folds, MDF against a pot-sized bet is 50%, 15 outs is 54% and not 60%.

- [ ] **Step 5: Run the suites**

Run: `npm test` → 0 failures. `npx tsc --noEmit` → clean. `npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add components/drill/ReferenceTab.tsx components/drill/DrillShell.tsx
git commit -m "feat: add the reference cheat-sheet tab"
```

---

## Task 13: Integration, Mixed mode, and live verification

**Files:**
- Create: `lib/drill/registry.test.ts`
- Modify: whatever the integration pass turns up
- Modify: `docs/04-roadmap.md`, `CLAUDE.md` (current-state section)

- [ ] **Step 1: Write the registry integration test**

Create `lib/drill/registry.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { GENERATORS, KIND_LABELS, TAB_ORDER, pickMixedKind, REGISTERED_KINDS } from "./registry";
import { DRILL_KINDS, type DrillLevel } from "./contract";
import { gradeAnswer } from "./grade";
import { mulberry32 } from "./rng";

test("registry: every drill kind is registered", () => {
  assert.deepEqual([...REGISTERED_KINDS()].sort(), [...DRILL_KINDS].sort());
});

test("registry: every kind has a label and a tab position", () => {
  for (const kind of DRILL_KINDS) {
    assert.ok(KIND_LABELS[kind], `no label for ${kind}`);
    assert.ok(TAB_ORDER.includes(kind), `no tab for ${kind}`);
  }
});

test("registry: every generator produces a gradeable question at every level and mode", () => {
  for (const kind of DRILL_KINDS) {
    for (const level of [1, 2, 3] as DrillLevel[]) {
      for (const oppMode of ["unknown", "shown"] as const) {
        for (let seed = 1; seed <= 25; seed++) {
          const q = GENERATORS[kind]!({ level, oppMode, rng: mulberry32(seed) });
          assert.equal(q.kind, kind);
          assert.equal(gradeAnswer(q, q.answer), "correct", `${kind} L${level} ${oppMode} seed ${seed}`);
          for (const o of q.options) assert.ok(o.label.length > 0);
          assert.ok(q.explain(q.answer).rows.length + q.explain(q.answer).notes.length > 0);
          assert.equal(q.payload.level, level);
          assert.equal(q.payload.oppMode, oppMode);
          assert.deepEqual(JSON.parse(JSON.stringify(q.payload)), q.payload);
        }
      }
    }
  }
});

test("registry: exactly one option is graded correct in every generated question", () => {
  for (const kind of DRILL_KINDS) {
    for (let seed = 1; seed <= 40; seed++) {
      const q = GENERATORS[kind]!({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
      const corrects = q.options.filter((o) => gradeAnswer(q, o.value) === "correct");
      assert.equal(corrects.length, 1, `${kind} seed ${seed}`);
    }
  }
});

test("registry: option count agrees with layout for every kind", () => {
  for (const kind of DRILL_KINDS) {
    for (let seed = 1; seed <= 40; seed++) {
      const q = GENERATORS[kind]!({ level: 2, oppMode: "unknown", rng: mulberry32(seed) });
      if (q.layout === "two") assert.equal(q.options.length, 2);
      else assert.equal(q.options.length, 4);
    }
  }
});

test("pickMixedKind: reaches every registered kind", () => {
  const seen = new Set(
    Array.from({ length: 600 }, (_, i) => pickMixedKind(mulberry32(i + 1)))
  );
  assert.deepEqual([...seen].sort(), [...DRILL_KINDS].sort());
});
```

- [ ] **Step 2: Run it and fix what it finds**

Run: `npx tsx --test lib/drill/registry.test.ts`

This is the test that catches contract drift across eight independently written generators. Any failure is a real bug in a generator, not in this test. Fix the generator.

- [ ] **Step 3: Tighten `GENERATORS` to a total map**

All nine kinds are now registered, so change the type in `lib/drill/registry.ts` from `Partial<Record<DrillKind, Generator>>` to `Record<DrillKind, Generator>` and drop the `!` assertions at its call sites. The type checker now enforces that a tenth kind cannot be added to `DrillKind` without a generator.

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Full-suite run**

Run: `npm test` → 0 failures. Record the count in the commit message.
Run: `.venv/bin/python -m pytest api/ -q` → 28 passed.
Run: `npx tsx --test lib/poker/*.test.ts` → 14/14, the regression suite for the whole project.
Run: `npm run lint` → clean.
Run: `npm run build` → succeeds. A build failure here is usually a client component importing a server-only module.

- [ ] **Step 5: Manual pass over every tab**

Run `npm run dev:all`, sign in, and for each of the eleven tabs confirm: the question renders with no missing block, answering shows worked feedback whose numbers agree with the question, `N` deals the next one, and the Difficulty tile moves after six answers on a single tab. On Mixed, confirm the kicker changes between kinds. Flip Opponent to face-up and confirm the six villain-dealing kinds show the villain and the two concept kinds are unaffected.

- [ ] **Step 6: Verify persistence against the real database**

After the manual pass:

```bash
psql "$DATABASE_URL" -c "select drill_kind, count(*) from attempts group by drill_kind order by drill_kind;"
psql "$DATABASE_URL" -c "select skill_tag, total_attempts, correct_attempts from skill_stats order by skill_tag;"
```

Expected: an `attempts` row for every kind you answered, and `skill_stats` totals that sum to the attempt count — with `pot_odds` carrying both `potodds` and `decision` answers. Then reload `/drill` and confirm the Difficulty tile starts above 1 for a kind you did well at: that is the drill-state seeding working end to end.

- [ ] **Step 7: Deploy and verify in production**

```bash
git push
```

Wait for the Vercel deploy, then against the production URL: sign in, answer one question in three different drills, reload, and confirm difficulty and XP both survived. Check `/api/health?db=1` returns `{"status":"ok","db":"ok"}`.

- [ ] **Step 8: Update the docs**

In `docs/04-roadmap.md`, mark M2 shipped with the date and list what is live. In `CLAUDE.md`, update the "Current state" section: the nine drills, the per-drill difficulty, the two opponent modes, the new test counts, and the two carryovers still open (Google OAuth, confirm-email).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: complete the M2 drill set — nine drills, mixed mode, reference tab"
git push
```

---

## Task 14: The M1 carryovers

Deliberately last: neither of these makes the app more valuable, and both are blocked on things outside the codebase.

**Files:** `docs/05-m1-status.md`, `docs/04-roadmap.md` (record the decisions).

- [ ] **Step 1: Decide on email confirmation**

The recommendation is **leave "Confirm email" off** until there is an SMTP story. Reasons: nothing in the app trusts the email address, Supabase's default mail sender is rate-limited and lands in spam often enough to lose a friend at the signup step, and an unverified signup that works beats a confirmation mail that does not arrive. Revisit in M5, when public profiles and challenges give a reason to care who owns an address.

Record the decision (either way) in `docs/05-m1-status.md` under the inherited-decisions list, with the date and the reasoning. Commit: `docs: record the email-confirmation decision`.

- [ ] **Step 2: Enable MFA on the Google account**

This is the user's action, not the implementer's — Google Cloud console access is blocked until it is done. Ask the user to confirm before proceeding to Step 3.

- [ ] **Step 3: Create the Google OAuth client**

Google Cloud console → APIs & Services → OAuth consent screen (External, app name "HCWK Wizard", the owner's email as support contact) → Credentials → Create Credentials → OAuth client ID → Web application. Authorised redirect URI, exactly:

```
https://ajaryvyorhwnhinzubqd.supabase.co/auth/v1/callback
```

- [ ] **Step 4: Wire it into Supabase**

Supabase dashboard → Authentication → Providers → Google → enable, paste the client ID and secret, save.

- [ ] **Step 5: Verify end to end**

The app-side button already exists from M1 (`app/login/page.tsx`) and needs no code change. On the production URL, click "Continue with Google", complete the flow, and confirm: you land signed in, `profiles` has a row for the new user created by the `on_auth_user_created` trigger, and a drill answer persists XP for that account.

```bash
psql "$DATABASE_URL" -c "select id, username, xp from profiles order by created_at desc limit 3;"
```

If the redirect fails, check the `redirect_to` allowlist in Supabase → Authentication → URL Configuration includes the production origin — that is the usual cause, not the provider config.

- [ ] **Step 6: Record it and close the milestone**

Update `docs/05-m1-status.md` (Google OAuth is no longer deferred) and `docs/04-roadmap.md`. Commit: `feat: enable Google sign-in`. Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: contract → Task 1; nine generators → Tasks 2, 4–11; Mixed mode → Task 2 (`pickMixedKind`) and Task 13; per-drill difficulty + `drill-state` seeding → Tasks 1 and 3; face-up mode → Task 2 (dealer and toggle) and each villain-dealing generator; `attempts` + `skill_stats` → Task 3; the tag map → Task 3; `Literal` drill kinds and `answer` length → Task 3; UI, tabs, `?tab=`, `/drill/outs` redirect, Difficulty tile rename → Task 2; Reference tab → Task 12; testing rules → the shared rules before Task 4 plus each test file; XP unchanged and session score display-only → Global Constraints and Task 2's `DrillShell`; carryovers → Task 14. The spec's payload table is enforced by the "re-derivable from the payload" test in every generator task. The spec's M6/M3 exclusions appear nowhere in the plan, as intended.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N" standing in for code. The eight generator tasks give complete test code and specify the implementation by exact reference line range plus the porting rules, rather than reproducing 500 lines of the reference verbatim — the reference file is in the repo and is the behavioural spec the roadmap names. Three places deliberately instruct the implementer to check a real signature before coding (`Spot`'s villain field in Task 2, `Scenario`'s action field in Task 11, `test_progress.py`'s existing style in Task 3), because inventing a name that disagrees with the tested engine is the more likely failure.

**Type consistency.** `DrillQuestion`, `ViewBlock`, `Explain`, `DrillContext`, `Generator`, `OptionValue`, `DrillLevel`, `OppMode` are defined once in Task 1 Step 3 and used with those exact names throughout. `gradeAnswer`/`isRight` (Task 1) are the names used in `DrillPlayer` and `registry.test.ts`. `nextLevel`/`pushResult`/`emptyWindows`/`WINDOW_SIZE` (Task 1) are the names used in `DrillShell` and `drillState.ts`. `buildOpts`/`intOptsInRange`/`money`/`pct`/`signedMoney`/`roundTo`/`pick`/`shuffled`/`withArticle` (Task 1) are the names used in every generator task. `DrillResult` replaces `OutsDrillResult` in Task 2 and is the type `DrillShell` passes to `recordAttempt`. `dealSpotOnStreet` is introduced in Task 4 as an addition to `kinds/outs.ts` and consumed by Tasks 6 and 7 — flagged in Task 4 so it is not a surprise. `SKILL_TAGS`/`skill_tag_for`/`DRILL_KINDS` (Python, Task 3) are distinct from the TypeScript `DRILL_KINDS`; both exist deliberately, and `api/test_skills.py` pins that the Python one has all nine.

Two gaps found during pre-flight verification against the real code, both closed above: (1) `dealSpotOnStreet` — needed by Tasks 4, 6 and 7 — is now created in Task 2 and merely imported by them, rather than one of three concurrent agents having to author it; (2) the Task 2 spot dealer originally re-derived `outs`/`outCards`/`unseen`/`equity` in face-up mode, which `dealVsHandSpot` already computes internally, so it now returns the engine's `Spot` untouched.
