import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { OTHER_ROUTE, routeKey } from "./route";

/**
 * Guards the grouping key — M8.8A.
 *
 * Two independent failures live here. A key that keeps a raw path leaks a
 * username or a `?next=` into a log file; a key that is unbounded turns every
 * URL a crawler invents into its own row and destroys every percentile in the
 * report. Both are silent.
 */

test("static routes map to themselves", () => {
  for (const route of ["/", "/learn", "/play", "/ranges", "/leaderboard", "/login"]) {
    assert.equal(routeKey(route), route);
  }
});

test("a trailing slash is not a second route", () => {
  assert.equal(routeKey("/learn/"), "/learn");
  assert.equal(routeKey("/"), "/");
});

test("dynamic segments collapse to the App Router pattern", () => {
  assert.equal(routeKey("/u/alice"), "/u/[username]");
  assert.equal(routeKey("/u/bob"), "/u/[username]");
  assert.equal(routeKey("/play/history/9f2c-4d1a"), "/play/history/[handId]");
  assert.equal(routeKey("/learn/3"), "/learn/[moduleId]");
  assert.equal(routeKey("/learn/3/12"), "/learn/[moduleId]/[lessonId]");
  // Home-game ids are group ids — other people's money; never log them raw.
  assert.equal(
    routeKey("/games/6b1f6a1e-8a1b-4a3e-9d1c-000000000000"),
    "/games/[groupId]"
  );
  assert.equal(
    routeKey("/games/6b1f6a1e-8a1b-4a3e-9d1c-000000000000/session/9f2c"),
    "/games/[groupId]/session/[sessionId]"
  );
});

test("two people's profiles are one key, so the row has a sample size", () => {
  const keys = new Set(["/u/alice", "/u/bob", "/u/carol"].map(routeKey));
  assert.equal(keys.size, 1);
});

test("the query string is dropped entirely — including `?next=`", () => {
  // Middleware stamps `?next=` on every signed-out request, so this is the one
  // value most likely to reach the collector, and it names where someone was
  // trying to go.
  assert.equal(routeKey("/login?next=/play/history/9f2c"), "/login");
  assert.equal(routeKey("/login?token=secret&next=/"), "/login");
  assert.equal(routeKey("http://localhost:3000/learn?a=1#frag"), "/learn");
});

test("an unknown path collapses to one bucket", () => {
  const invented = Array.from({ length: 1000 }, (_, i) => routeKey(`/wp-admin/${i}`));
  assert.equal(new Set(invented).size, 1);
  assert.equal(invented[0], OTHER_ROUTE);
});

test("hostile and malformed input never becomes a key", () => {
  for (const value of [
    null,
    undefined,
    "",
    123 as unknown as string,
    {} as unknown as string,
    "not a path",
    "//evil.example.com/x",
    "/u/alice/../../secret",
  ]) {
    const key = routeKey(value as string);
    assert.ok(
      key === OTHER_ROUTE || key.startsWith("/"),
      `${String(value)} -> ${key}`
    );
    assert.ok(!key.includes("?"), key);
    assert.ok(!key.includes("evil"), key);
  }
});

/**
 * The list in `route.ts` is hand-written, so this walks `app/` and fails when a
 * page exists that it does not cover. Without this the module silently starts
 * answering `/other` for a new route — a whole page missing from the baseline
 * with nothing to notice it.
 */
test("every page in app/ is covered by a pattern or the static set", () => {
  const appDir = path.join(import.meta.dirname, "..", "..", "app");

  const routes: string[] = [];
  const walk = (dir: string, urlPath: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      // Route groups `(name)` do not appear in the URL; `_private` folders and
      // the perf collector are not pages.
      if (entry.startsWith("_")) continue;
      const segment = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
      const nextPath = `${urlPath}${segment}`;
      if (readdirSync(full).includes("page.tsx")) routes.push(nextPath || "/");
      walk(full, nextPath);
    }
  };
  if (readdirSync(appDir).includes("page.tsx")) routes.push("/");
  walk(appDir, "");

  assert.ok(routes.length >= 15, `expected the app's pages, found ${routes.length}`);

  for (const route of routes) {
    // Substitute a plausible value for each dynamic segment, then check the
    // key comes back as the pattern rather than as `/other`.
    const concrete = route
      .replace(/\[moduleId\]/g, "3")
      .replace(/\[lessonId\]/g, "12")
      .replace(/\[username\]/g, "someone")
      .replace(/\[handId\]/g, "9f2c4d1a");
    const key = routeKey(concrete);
    assert.notEqual(
      key,
      OTHER_ROUTE,
      `app${route}/page.tsx has no entry in lib/observability/route.ts — it would be logged as /other`
    );
    if (route.includes("[")) {
      assert.equal(key, route, `${concrete} should key as ${route}`);
    }
  }
});
