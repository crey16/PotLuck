import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * HTML entities in JSX text eat the adjacent leading space.
 *
 * `<b>Never bluffing</b> — if you&rsquo;re never called…` renders as
 * "Never bluffing— if you're never called": the space between `</b>` and the
 * em dash is dropped when the same text node contains an entity. Five of the
 * seven "leaks" bullets rendered correctly and two did not, and the two that
 * did not were exactly the two containing `&rsquo;` — which is what makes this
 * so easy to miss in review, where the source of all seven looks identical.
 *
 * The file already writes ×, —, ↔ and → as literal characters. Apostrophes
 * must be literal too. Found in the M2 visual pass.
 */
const FILE = path.resolve(import.meta.dirname, "ReferenceTab.tsx");

test("ReferenceTab: typographic characters are literal, not HTML entities", () => {
  const src = readFileSync(FILE, "utf8");
  const entities = [...src.matchAll(/&[a-z]+;/g)].map((m) => m[0]);
  const offenders = entities.filter((e) => e !== "&quot;");
  assert.deepEqual(
    offenders,
    [],
    `Use the literal character instead — an entity here silently swallows the ` +
      `preceding space in the rendered text: ${offenders.join(", ")}`,
  );
});

test("ReferenceTab: every em dash keeps its surrounding spaces", () => {
  const src = readFileSync(FILE, "utf8");
  // In JSX source an em dash separating clauses is always " — ".
  const tight = src
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => /\S—|—\S/.test(line) && !line.startsWith("*"));
  assert.deepEqual(
    tight.map(({ n, line }) => `${n}: ${line}`),
    [],
    "em dash must be spaced on both sides",
  );
});
