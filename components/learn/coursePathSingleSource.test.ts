import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guards the "exactly one implementation of the module/lesson list" rule
 * (M8.5A).
 *
 * `/` and `/learn` both lead with the learning path now. The obvious way to
 * build that is to paste the course-map JSX into the home page, and it works
 * perfectly — until one of them gains a completion rule, a lock state or a
 * different "next lesson" derivation, at which point two pages quietly
 * disagree about where the player is in the course. Nothing throws, nothing
 * fails to build, and the player just sees different answers depending on
 * which route they arrived through.
 *
 * So: the course-map markup and the continue action live in
 * `components/learn/`, and no route file may re-declare their class names.
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

const ROUTES_THAT_RENDER_THE_PATH = ["app/page.tsx", "app/learn/page.tsx"];

for (const route of ROUTES_THAT_RENDER_THE_PATH) {
  test(`${route}: renders the path through the shared components, not a copy`, () => {
    const source = read(route);
    for (const cls of OWNED_CLASSES) {
      assert.ok(
        !source.includes(cls),
        `${route} declares "${cls}" itself — the module list must come from ` +
          `components/learn/CourseMap.tsx, not a second copy in the route`,
      );
    }
    assert.ok(
      source.includes("CourseMap"),
      `${route} leads with the learning path, so it must render <CourseMap>`,
    );
    assert.ok(
      source.includes("ContinuePath"),
      `${route} must offer the path's single continue action via <ContinuePath>`,
    );
  });
}

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
