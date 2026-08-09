import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { cache } from "react";

import {
  completedLessonIds,
  getSessionProfile,
  getUserProgress,
  getUserSkillStats,
  progressForLesson,
  type ProgressRow,
} from "./requestContext";

/**
 * Guards the shared signed-in context — M8.8B.
 *
 * This module exists to make one person's rows readable twice in one render
 * without reading them twice from the database. The failure it must never have
 * is the obvious one: one person's rows readable in someone else's render.
 *
 * The tests split into three kinds, because the risks are different:
 *
 * 1. **What cannot be tested here, and why** — `cache()` is inert outside an
 *    RSC render, so the dedup itself is evidenced by source rules and by the
 *    measured route timings, never by a mock that would pass regardless.
 * 2. **Source-level rules** — that no cross-request cache primitive appears in
 *    this module. A cross-request cache cannot be caught by a unit test in a
 *    single process (which is exactly why serverless leaks of this shape ship),
 *    so the guard reads the source, the way
 *    `lib/content/publicContent.test.ts` does from the opposite direction.
 * 3. **Pure slicing helpers** — the in-memory filters that replaced `.eq()`
 *    clauses, which must return exactly what the queries returned.
 */

/* --------------------------------- 1. what CAN and cannot be tested here */

/**
 * **`cache()` does not dedupe outside a React Server Components render, and
 * that was measured rather than assumed.**
 *
 * The obvious test for this milestone would call `getSessionProfile()` twice
 * and assert one database read. It cannot be written honestly. React's
 * `cache()` reads its store from the RSC renderer's async scope, which only
 * exists while Next is rendering a Server Component; in bare Node — and under
 * `react-dom/server`, and even with `--conditions=react-server` — every call
 * runs the function again.
 *
 * The test below pins that fact so nobody later writes the tempting version:
 * a unit test that "proves" dedup by mocking `cache()` would pass whatever the
 * implementation did, including a module-level `Map` that leaks across
 * requests. It is the exact "mocked singleton unlike production" trap.
 *
 * So the dedup is evidenced two other ways, both real:
 *
 * - **Source rules** (section 2) — the readers are wrapped in `cache()`, take
 *   no user-id argument, derive identity from the verified JWT, and reach for
 *   no cross-request store.
 * - **Measurement** — `docs/17-m88a-performance-baseline.md` records the
 *   before/after route timings from the running app, which is where a query
 *   that did not actually collapse would show up.
 */
test("cache() is inert outside an RSC render — why the guards below are source rules", () => {
  let calls = 0;
  const read = cache((key: string) => ({ key, call: ++calls }));

  const first = read("alice");
  const second = read("alice");

  // If this ever starts passing as `1`, React gained an ambient default scope
  // and a real behavioural dedup test becomes possible — write it and delete
  // this one.
  assert.equal(calls, 2, "cache() deduped outside a render — re-examine the guards below");
  assert.notEqual(first, second);
});

test("the readers are keyed by nothing, so a cache key cannot be another user", () => {
  // The leak shape this design rules out structurally. `cache()` keys on the
  // ARGUMENTS, so a `getSessionProfile(userId)` would be keyed by whatever the
  // caller passed — and a caller that passed the wrong id would be served, and
  // then serve, the wrong person's row. Ours take no arguments at all: the
  // only identity in scope is the one `getAuthUserId()` verified from the JWT.
  const keyed = cache((userId: string) => ({ userId }));
  assert.notEqual(keyed("alice").userId, keyed("bob").userId);

  // And the shipped readers have no such parameter — asserted against the
  // source in section 2, and against the compiled signature here.
  assert.equal(getSessionProfile.length, 0);
  assert.equal(getUserProgress.length, 0);
  assert.equal(getUserSkillStats.length, 0);
});

/* ------------------------------------------------- 2. source-level rules */

const SOURCE = readFileSync(path.join(import.meta.dirname, "requestContext.ts"), "utf8");

test("personalized reads use request dedup, never a cross-request cache", () => {
  // Each of these is a store that outlives the response. A profile row in any
  // of them is one person's XP rendered into another person's page, and no
  // single-process test can catch it — which is why this is a source rule.
  const forbidden = [
    "unstable_cache",
    "revalidate",
    "next/cache",
    "createContentClient",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  for (const token of forbidden) {
    assert.ok(!code.includes(token), `requestContext.ts must not use ${token}`);
  }
  // And it must use the one that IS request-scoped.
  assert.match(code, /import \{ cache \} from "react"/);
});

test("no module-level mutable state could survive between requests", () => {
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  // `let`/`var` at column 0 is a module-level binding. A Map or object literal
  // held there would be per-instance, not per-request — the classic serverless
  // cross-user leak.
  assert.equal(/^(let|var)\s/m.test(code), false, "module-level mutable binding");
  assert.equal(/^const\s+\w+\s*[:=]\s*new (Map|Set|WeakMap)/m.test(code), false);
});

test("every exported reader is wrapped in cache()", () => {
  // An un-wrapped reader is not a leak, but it is a silent regression of the
  // dedup this milestone is measured on.
  const readers = [...SOURCE.matchAll(/export const (\w+) = cache\(/g)].map((m) => m[1]);
  assert.deepEqual(
    readers.sort(),
    ["getRequestClient", "getSessionProfile", "getUserProgress", "getUserSkillStats"],
    "a reader was added or removed without cache()"
  );
});

test("the readers derive identity themselves and take no user id argument", () => {
  // A `getSessionProfile(userId)` would be a caller-supplied identity, and the
  // cache key would then be whatever the caller passed — including another
  // person's id. Identity comes from the verified JWT via `getAuthUserId()`,
  // and there is no parameter through which it could come from anywhere else.
  for (const reader of ["getSessionProfile", "getUserProgress", "getUserSkillStats"]) {
    const signature = new RegExp(`export const ${reader} = cache\\(\\s*async \\(\\)`);
    assert.match(SOURCE, signature, `${reader} must take no arguments`);
  }
  assert.match(SOURCE, /getAuthUserId\(\)/);
});

test("every user-scoped query is filtered to the authenticated id", () => {
  // RLS is the real boundary, but an explicit server-side ownership check is
  // what M8.8B's last bullet requires alongside it — a faster read must not
  // widen what one account can see.
  const queries = [...SOURCE.matchAll(/\.from\("(\w+)"\)([\s\S]*?);/g)];
  assert.ok(queries.length >= 3, "expected the three user-scoped reads");
  for (const [, table, body] of queries) {
    assert.ok(
      /\.eq\("(user_id|id)", userId\)/.test(body),
      `the read of ${table} is not scoped to the authenticated user`
    );
  }
});

/* -------------------------------------------- 3. the in-memory slices */

const ROWS: ProgressRow[] = [
  { lesson_id: 1, status: "completed", completed_at: "2026-01-01", attempts_count: 2, best_score: 90 },
  { lesson_id: 2, status: "in_progress", completed_at: null, attempts_count: 1, best_score: 40 },
  { lesson_id: 3, status: "completed", completed_at: "2026-01-02", attempts_count: 1, best_score: 100 },
  { lesson_id: null, status: "completed", completed_at: null, attempts_count: 0, best_score: 0 },
];

test("completedLessonIds returns exactly what `.eq(status, completed)` returned", () => {
  assert.deepEqual([...completedLessonIds(ROWS)].sort(), [1, 3]);
  // A null lesson_id was dropped by the old `.filter(typeof === number)` too.
  assert.equal(completedLessonIds(ROWS).has(NaN), false);
});

test("completedLessonIds is safe on null and empty input", () => {
  assert.equal(completedLessonIds(null).size, 0);
  assert.equal(completedLessonIds([]).size, 0);
});

test("progressForLesson returns what `.eq(lesson_id).maybeSingle()` returned", () => {
  assert.equal(progressForLesson(ROWS, 2)?.status, "in_progress");
  assert.equal(progressForLesson(ROWS, 1)?.status, "completed");
  // Absent means null, not undefined-shaped truthiness — `fetchLesson` reads
  // `?.status === "completed"` off it.
  assert.equal(progressForLesson(ROWS, 99), null);
  assert.equal(progressForLesson(null, 1), null);
});

/* ------------------------------------- 4. the call sites actually share */

const root = path.join(import.meta.dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

test("no server module reads `profiles` for the signed-in reader directly", () => {
  // The duplicate this milestone removed: the root layout and the dashboard
  // both selected the same row on `/`. Anything wanting it now goes through
  // `getSessionProfile()`.
  //
  // `lib/social/queries.ts` is exempt: its profile reads are of OTHER people
  // (a leaderboard row, a public profile by username), which is a different
  // row and cannot be served from the viewer's context.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      if (entry.isDirectory()) {
        if (["node_modules", ".next", "solver", "public"].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) continue;
      if (relative === path.join("lib", "social", "queries.ts")) continue;
      if (relative === path.join("lib", "supabase", "requestContext.ts")) continue;
      if (readFileSync(full, "utf8").includes('.from("profiles")')) offenders.push(relative);
    }
  };
  for (const dir of ["app", "lib", "components"]) walk(path.join(root, dir));
  assert.deepEqual(offenders, [], `these read profiles directly: ${offenders.join(", ")}`);
});

test("placement routing shares the progress read instead of probing", () => {
  // It was a `limit(1)` existence probe on a table `/` and `/learn` were
  // already reading in full — a whole round trip for a subset of rows in
  // flight. The `attempts` probe beside it stays a probe on purpose: routing
  // gates a redirect and must not wait on the dashboard's 5,000-row read.
  const source = read("lib", "placement", "server.ts");
  assert.ok(!source.includes('.from("progress")'), "routing still probes progress itself");
  assert.match(source, /getUserProgress\(\)/);
  assert.match(source, /\.from\("attempts"\)[\s\S]{0,80}\.limit\(1\)/);
});

test("the learn readers all share one progress read", () => {
  const source = read("lib", "learn", "server.ts");
  assert.ok(!source.includes('.from("progress")'), "learn/server.ts still queries progress itself");
  assert.ok(!source.includes('.from("skill_stats")'), "learn/server.ts still queries skill_stats itself");
  assert.match(source, /getUserProgress\(\)/);
});

test("the weakest-skill threshold is one constant, not three spellings", () => {
  // It was a `.gte("total_attempts", 5)` in one query and a `>= 5` in two
  // other places. That is the drift M8.8B's "one recommendation
  // implementation" bullet names: Home and Learn disagreeing about what to
  // work on next.
  const stats = read("lib", "drill", "serverStats.ts");
  assert.match(stats, /export const MIN_SKILL_ATTEMPTS = (\d+);/);
  const value = Number(/export const MIN_SKILL_ATTEMPTS = (\d+);/.exec(stats)![1]);

  for (const file of [["app", "page.tsx"], ["lib", "learn", "server.ts"]]) {
    const source = read(...file);
    assert.match(source, /MIN_SKILL_ATTEMPTS/, `${file.join("/")} must use the constant`);
  }
  // And the Python recommendation route must agree, or the two engines rank
  // different tags as weakest.
  const python = read("api", "learning.py");
  const pyThreshold = /MIN_RECOMMENDATION_ATTEMPTS\s*=\s*(\d+)/.exec(python);
  assert.ok(pyThreshold, "api/learning.py must name the threshold as a constant");
  assert.equal(
    Number(pyThreshold[1]),
    value,
    "MIN_SKILL_ATTEMPTS and MIN_RECOMMENDATION_ATTEMPTS disagree — two engines, two answers for 'weakest'"
  );
});
