import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SOURCE_EXTENSIONS = new Set([".css", ".ts", ".tsx"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [target] : [];
  });
}

test("every numbered spacing token used by the UI is defined", () => {
  const globals = readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
  const defined = new Set(
    [...globals.matchAll(/(--space-\d+)\s*:/g)].map((match) => match[1])
  );
  const used = new Set(
    sourceFiles(path.join(ROOT, "app"))
      .concat(sourceFiles(path.join(ROOT, "components")))
      .flatMap((file) => [...readFileSync(file, "utf8").matchAll(/var\((--space-\d+)\)/g)])
      .map((match) => match[1])
  );

  assert.deepEqual(
    [...used].filter((token) => !defined.has(token)).sort(),
    []
  );
});
