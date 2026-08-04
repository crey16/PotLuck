import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guards the "exactly one implementation of the module/lesson list" rule.
 *
 * `/learn` is the only route that renders the learning path. M8.5A briefly put
 * it on `/` too and that was reverted — a first-run problem is solved by
 * routing (signup → placement → `/learn`), not by restructuring the dashboard
 * every established player sees on every visit.
 *
 * Two distinct rules, and they apply to different files:
 *
 *  1. NO route may re-declare the course-map markup. This one still covers `/`,
 *     and covers it for two reasons now: pasting the JSX into a second page
 *     works perfectly until one copy gains a completion rule or a different
 *     "next lesson" derivation, at which point the two quietly disagree about
 *     where the player is — nothing throws, nothing fails to build, and the
 *     answer just depends on which route you came through. And it is the
 *     tripwire for the obvious wrong fix if new-user onboarding regresses:
 *     putting the lessons back on Home.
 *  2. `/learn` must actually render the shared components.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Class names owned by CourseMap.tsx / ContinuePath.tsx alone. */
const OWNED_CLASSES = [
  "course-map-row",
  "course-module-head",
  "course-module-foot",
  "course-node",
  "continue-path-progress",
];

/** Every route that renders lesson-path UI at all. */
const ROUTES = ["app/page.tsx", "app/learn/page.tsx"];

/** The one route that owns the path. */
const PATH_ROUTE = "app/learn/page.tsx";

for (const route of ROUTES) {
  test(`${route}: never re-declares the course-map markup`, () => {
    const source = read(route);
    for (const cls of OWNED_CLASSES) {
      assert.ok(
        !source.includes(cls),
        `${route} declares "${cls}" itself — the module list must come from ` +
          `components/learn/CourseMap.tsx, not a second copy in the route`,
      );
    }
  });
}

test(`${PATH_ROUTE}: renders the path through the shared components`, () => {
  const source = read(PATH_ROUTE);
  assert.ok(
    source.includes("CourseMap"),
    `${PATH_ROUTE} owns the learning path, so it must render <CourseMap>`,
  );
  assert.ok(
    source.includes("ContinuePath"),
    `${PATH_ROUTE} must offer the path's single continue action via <ContinuePath>`,
  );
});

test("the home page stays a dashboard, not a second course map", () => {
  // Belt and braces alongside the markup check above: the shared components
  // must not be imported here either. Rendering <CourseMap> on `/` is the
  // regression this whole file exists to catch.
  const source = read("app/page.tsx");
  assert.ok(!source.includes("CourseMap"));
  assert.ok(!source.includes("ContinuePath"));
});

test("the learning path stays reachable at its own URL", () => {
  // `/learn` is the canonical, directly linkable home of the path. It must
  // keep existing as a route whatever the landing page renders.
  assert.ok(read("app/learn/page.tsx").includes("export default"));
});

test("CourseMap derives each module's next lesson from completion, not nextLessonId", () => {
  // ModuleWithProgress.nextLessonId falls back to the module's FIRST lesson
  // once the module is complete, so rendering it would print
  // "Next: <lesson 1>" underneath a module marked complete.
  const source = read("components/learn/CourseMap.tsx");
  assert.ok(!source.includes("module.nextLessonId"));
  assert.ok(source.includes("completedLessonIds.has"));
});
