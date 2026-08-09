import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { PublicContent } from "./publicContent";
import { readPublicContent, resolvePublicContent } from "./publicContent";

/**
 * Guards M8.8C: the shared content cache must never carry anything personal.
 *
 * The dangerous version of this change is the one that works. A cache that
 * accidentally holds one account's progress makes every page faster and the
 * product wrong, and nothing in a normal render will say so — the second user
 * simply sees the first user's ticks. So the tests here are split between the
 * two ways that can happen:
 *
 * 1. **Something user-scoped gets read inside the cached layer.** Enforced by
 *    reading this module's own source: no user-scoped table, no cookies, no
 *    user id parameter. A source scan because the failure is a query that
 *    behaves perfectly in isolation.
 * 2. **Something user-scoped gets written back onto the shared object.**
 *    Enforced by `lib/learn/compose.test.ts`, which runs two readers through
 *    one frozen content object.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SOURCE = readFileSync(path.join(ROOT, "lib", "content", "publicContent.ts"), "utf8");

/** Tables whose rows belong to one account. None may be read here. */
const USER_SCOPED_TABLES = [
  "progress",
  "attempts",
  "skill_stats",
  "profiles",
  "user_daily_activity",
  "placement_assessments",
  "placement_responses",
  "friends",
  "play_hands",
  "play_sessions",
  "play_decisions",
  "xp_events",
];

test("the cached layer reads no user-scoped table", () => {
  const offenders = USER_SCOPED_TABLES.filter((table) =>
    new RegExp(`\\.from\\(\\s*["']${table}["']`).test(SOURCE)
  );
  assert.deepEqual(
    offenders,
    [],
    "a user-scoped table inside the shared content cache would serve one account's rows to everyone"
  );
});

test("the cached layer reads only the three content tables", () => {
  const tables = [...SOURCE.matchAll(/\.from\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)].sort(), ["lessons", "modules", "scenarios"]);
});

test("the cached layer never touches cookies, headers or a user id", () => {
  assert.ok(!/\bcookies\s*\(/.test(SOURCE), "cookies() in a cached function is a per-user input");
  assert.ok(!/next\/headers/.test(SOURCE), "next/headers must not reach the shared cache");
  assert.ok(!/\buserId\b/.test(SOURCE), "no function here may accept or use a user id");
  assert.ok(!/auth\.uid|getAuthUserId/.test(SOURCE));
});

test("the cache key parts are passed to the cached function, not just declared", () => {
  // The bug this catches: `unstable_cache(fn, ["public-content"], …)` with a
  // zero-argument `fn` keys on a constant, so bumping the version changes
  // nothing and the old course is served forever. The version has to arrive as
  // an ARGUMENT, because that is what Next folds into the key.
  assert.match(SOURCE, /unstable_cache\(/);
  assert.match(
    SOURCE,
    /loadCached\(publicContentKeyParts\(\)\)/,
    "the key parts must be handed to the cached function on every call"
  );
  assert.match(
    SOURCE,
    /async \(_keyParts: string\[\]\)/,
    "the cached function must take the key parts as its parameter"
  );
});

test("the cached entry is tagged and time-bounded", () => {
  assert.match(SOURCE, /tags:\s*\[PUBLIC_CONTENT_TAG\]/);
  assert.match(SOURCE, /revalidate:\s*PUBLIC_CONTENT_MAX_AGE_SECONDS/);
});

test("the cached payload holds no Set or Map", () => {
  // The Data Cache serializes what it stores, and a Set survives that as `{}`
  // — an empty course with no error. The personalized side owns every Set.
  assert.ok(!/new Set|new Map/.test(SOURCE.split("export const lessonsForModule")[0]));
});

test("the personalized read path no longer queries a content table", () => {
  // The measurable half of the separation, and the one that regresses
  // quietly: adding `supabase.from("lessons")` back into a page's own read
  // would work perfectly and silently undo the cache. Content reaches
  // lib/learn/server.ts only through loadPublicContent().
  const server = readFileSync(path.join(ROOT, "lib", "learn", "server.ts"), "utf8");
  const tables = [...server.matchAll(/\.from\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
  const contentTables = tables.filter((t) =>
    ["modules", "lessons", "scenarios", "table_scenarios", "daily_content"].includes(t)
  );
  assert.deepEqual(contentTables, [], "read shipped content through loadPublicContent(), not directly");
  assert.match(server, /loadPublicContent\(\)/);

  // …and what remains really is the per-user half.
  //
  // M8.8B moved those queries one file along: `lib/learn/server.ts` used to
  // issue `progress` and `skill_stats` itself, four and two times over, and
  // now composes them from the shared request context. So the assertion
  // follows the code rather than being relaxed — the per-user reads still have
  // to exist, still have to be exactly these tables, and still have to be
  // somewhere that has a user in scope.
  assert.deepEqual(tables, [], "learn/server.ts should compose reads, not issue them");
  const context = readFileSync(
    path.join(ROOT, "lib", "supabase", "requestContext.ts"),
    "utf8"
  );
  const contextTables = [...context.matchAll(/\.from\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(contextTables)].sort(),
    ["profiles", "progress", "skill_stats"],
    "the shared context must hold the per-user half and nothing else"
  );
  for (const table of contextTables) {
    assert.ok(
      !["modules", "lessons", "scenarios", "table_scenarios", "daily_content"].includes(table),
      `${table} is shipped content and must not be read per-request`
    );
  }
});

/* ------------------------------------------------------------------ */
/* readPublicContent, against a fake client                            */
/* ------------------------------------------------------------------ */

type Table = { data: unknown[] | null; error: { message: string } | null };

/**
 * The smallest thing that answers the query builder this module uses.
 *
 * `.select().eq().order()` has to remain thenable at every step because the
 * three queries stop chaining at different points.
 */
function fakeClient(tables: Record<string, Table>) {
  const seen: string[] = [];
  return {
    seen,
    client: {
      from(table: string) {
        seen.push(table);
        const result = tables[table] ?? { data: [], error: null };
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          then: (resolve: (value: Table) => unknown) => resolve(result),
        };
        return chain;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

const MODULE_ROW = { id: 1, title: "Foundations", description: "d", order_index: 1 };
const LESSON_ROW = {
  id: 10,
  module_id: 1,
  lesson_type: "concept",
  title: "Pot odds",
  order_index: 1,
  content_json: { screens: [{ type: "info", content: "x" }], skill_tags: ["pot_odds"], xp_reward: 10 },
  estimated_time_seconds: 300,
  difficulty: 1,
  version: 1,
};
const SCENARIO_ROW = { id: 5, module_id: 1, skill_tag: "pot_odds", difficulty: 2 };

test("readPublicContent parses the three content tables and nothing else", async () => {
  const { client, seen } = fakeClient({
    modules: { data: [MODULE_ROW], error: null },
    lessons: { data: [LESSON_ROW], error: null },
    scenarios: { data: [SCENARIO_ROW], error: null },
  });
  const content = await readPublicContent(client);
  assert.deepEqual(seen.sort(), ["lessons", "modules", "scenarios"]);
  assert.equal(content.modules.length, 1);
  assert.equal(content.lessons[0].title, "Pot odds");
  assert.deepEqual(content.scenarios, [
    { id: 5, moduleId: 1, skillTag: "pot_odds", difficulty: 2 },
  ]);
});

test("readPublicContent throws on a query error rather than caching an empty course", async () => {
  const { client } = fakeClient({
    modules: { data: null, error: { message: "connection reset" } },
    lessons: { data: [LESSON_ROW], error: null },
    scenarios: { data: [], error: null },
  });
  await assert.rejects(() => readPublicContent(client), /connection reset/);
});

test("a malformed row is dropped, not allowed to throw", async () => {
  const { client } = fakeClient({
    modules: { data: [MODULE_ROW, { id: "nope" }], error: null },
    lessons: { data: [LESSON_ROW, { id: 11 }], error: null },
    scenarios: { data: [SCENARIO_ROW, {}], error: null },
  });
  const content = await readPublicContent(client);
  assert.equal(content.modules.length, 1);
  assert.equal(content.lessons.length, 1);
  assert.equal(content.scenarios.length, 1);
});

/* ------------------------------------------------------------------ */
/* resolvePublicContent — the fallback policy                          */
/* ------------------------------------------------------------------ */

const SAMPLE: PublicContent = { modules: [], lessons: [], scenarios: [] };
const cachedContent: PublicContent = { ...SAMPLE, scenarios: [{ id: 1, moduleId: 1, skillTag: "a", difficulty: 1 }] };
const directContent: PublicContent = { ...SAMPLE, scenarios: [{ id: 2, moduleId: 1, skillTag: "b", difficulty: 1 }] };

test("the shared cache is preferred when it is available and works", async () => {
  let directCalls = 0;
  const result = await resolvePublicContent({
    cached: async () => cachedContent,
    direct: async () => {
      directCalls++;
      return directContent;
    },
  });
  assert.equal(result.scenarios[0].id, 1);
  assert.equal(directCalls, 0, "the direct read must not run when the cache answered");
});

test("with no service-role key there is no cached reader, and content still loads", async () => {
  const result = await resolvePublicContent({ cached: null, direct: async () => directContent });
  assert.equal(result.scenarios[0].id, 2);
});

test("a failing cached read falls back to the per-request read", async () => {
  const result = await resolvePublicContent({
    cached: async () => {
      throw new Error("data cache unavailable");
    },
    direct: async () => directContent,
  });
  assert.equal(result.scenarios[0].id, 2);
});

test("both paths failing propagates, so an outage is not shown as an empty course", async () => {
  // `/learn` renders an empty course as "the learning tables are ready, but
  // empty — apply seed.sql". Swallowing a database outage into `[]` would tell
  // someone to reseed a database that is merely unreachable, so the failure
  // has to reach the caller.
  await assert.rejects(
    () =>
      resolvePublicContent({
        cached: async () => {
          throw new Error("cache down");
        },
        direct: async () => {
          throw new Error("database down");
        },
      }),
    /database down/
  );
});

test("every reader in lib/learn/server.ts handles that rejection", () => {
  // A bare `loadPublicContent()` in one of these readers turns a database
  // outage into an unhandled server error instead of the failure value that
  // reader returned before the content/progress split. Each call must either
  // carry its own `.catch` or sit inside a try/catch.
  const server = readFileSync(path.join(ROOT, "lib", "learn", "server.ts"), "utf8");
  const lines = server.split("\n");
  //
  // Matched anywhere on the line, not just at its start: M8.8B collapsed the
  // three-line `Promise.all([...])` arguments onto one line each, and a guard
  // that only saw a call in leading position would have silently stopped
  // checking three of the four readers while still passing.
  const callLines = lines
    .map((line, index) => ({ line, index }))
    // Comment lines are excluded, or this file's own doc comment counts as a
    // fifth reader and the count assertion below becomes noise.
    .filter(({ line }) => !/^\s*(\*|\/\/)/.test(line))
    .filter(({ line }) => /\bloadPublicContent\(\)/.test(line));
  assert.equal(callLines.length, 4, "expected all four learn readers to load shared content");

  for (const { line, index } of callLines) {
    if (/\.catch\(\(\) => null\)/.test(line)) continue;
    // Otherwise the nearest preceding `try {` must be closer than the nearest
    // preceding `} catch`, i.e. this call is inside an open try block.
    const before = lines.slice(0, index);
    const lastTry = before.map((l) => /^\s*try \{/.test(l)).lastIndexOf(true);
    const lastCatch = before.map((l) => /^\s*\} catch/.test(l)).lastIndexOf(true);
    assert.ok(
      lastTry > lastCatch,
      `loadPublicContent() on line ${index + 1} is neither caught nor inside a try block`
    );
  }
});
