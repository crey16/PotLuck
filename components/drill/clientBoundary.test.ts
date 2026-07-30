import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Guards the server/client boundary.
 *
 * A `"use client"` module may export perfectly pure helpers, and importing one
 * of those from a server component compiles, type-checks, lints and BUILDS
 * clean — then throws at request time with "Attempted to call X() from the
 * server but X is on the client". That is how `/drill` shipped to this branch
 * completely dead while 187 tests stayed green: the page is dynamic (it reads
 * cookies), so `next build` never renders it.
 *
 * The fix is always the same — move the pure helper into a neutral module that
 * carries no "use client" directive, and let both sides import it.
 *
 * Type-only imports are exempt: they are erased before bundling and never
 * reach the runtime boundary.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCAN_DIRS = ["app", "components", "lib"];
const EXTS = [".ts", ".tsx"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXTS.includes(path.extname(entry)) && !full.endsWith(".test.ts"))
      out.push(full);
  }
  return out;
}

/** True when the file's first non-comment, non-blank line is the directive. */
function isClientModule(file: string): boolean {
  const src = readFileSync(file, "utf8");
  const firstCode = src
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"));
  return firstCode === '"use client";' || firstCode === "'use client';";
}

/** Resolve an import specifier to a file on disk, or null if it is a package. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // bare package import

  for (const candidate of [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => path.join(base, "index" + e)),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface ValueImport {
  spec: string;
  line: number;
  /** Local binding names that survive to runtime (type specifiers dropped). */
  bindings: string[];
}

/** Value (non-type) imports. Skips `import type ...` and drops `type` specifiers. */
function valueImports(file: string): ValueImport[] {
  const src = readFileSync(file, "utf8");
  const out: ValueImport[] = [];
  const re = /import\s+([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const clause = m[1].trim();
    const spec = m[2];
    if (clause.startsWith("type ")) continue; // wholly type-only

    const bindings: string[] = [];
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) {
      for (const raw of braces[1].split(",")) {
        const name = raw.trim();
        if (!name || name.startsWith("type ")) continue; // erased before bundling
        // `a as b` binds b; a bare `a` binds a.
        bindings.push(name.split(/\s+as\s+/).pop()!.trim());
      }
    }
    // Default and namespace imports, e.g. `Foo` or `* as Foo` before any brace.
    const head = clause.split("{")[0].replace(/,\s*$/, "").trim();
    if (head) bindings.push(head.replace(/^\*\s+as\s+/, "").trim());

    if (bindings.length > 0) {
      out.push({ spec, line: src.slice(0, m.index).split("\n").length, bindings });
    }
  }
  return out;
}

/**
 * A server component MAY import a client component and render it — that is the
 * standard composition pattern, and the boundary is respected because React
 * only serialises props across it. What it may not do is *call* a client
 * export. So a binding is only a violation when it is referenced somewhere
 * other than as a JSX tag.
 */
function usedOutsideJsx(body: string, binding: string): boolean {
  const esc = binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const refs = body.match(new RegExp(`(?<![\\w$.])${esc}(?![\\w$])`, "g")) ?? [];
  const asJsx = body.match(new RegExp(`<${esc}(?![\\w$])`, "g")) ?? [];
  return refs.length > asJsx.length;
}

/** Source with every import statement removed, so specifier strings — which
 *  often contain the binding's own name — cannot count as references. */
function bodyOf(src: string): string {
  return src.replace(/import\s+[\s\S]*?\s*from\s*["'][^"']+["']\s*;?/g, "");
}

test("no server module value-imports from a \"use client\" module", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const clientCache = new Map<string, boolean>();
  const isClient = (f: string) => {
    if (!clientCache.has(f)) clientCache.set(f, isClientModule(f));
    return clientCache.get(f)!;
  };

  const violations: string[] = [];
  for (const file of files) {
    if (isClient(file)) continue; // client → client is fine
    const body = bodyOf(readFileSync(file, "utf8"));
    for (const { spec, line, bindings } of valueImports(file)) {
      const target = resolveSpecifier(file, spec);
      if (!target || !isClient(target)) continue;
      for (const binding of bindings) {
        if (!usedOutsideJsx(body, binding)) continue; // rendered, not called
        violations.push(
          `${path.relative(ROOT, file)}:${line} uses \`${binding}\` from "${spec}" ` +
            `outside JSX (${path.relative(ROOT, target)} is a "use client" module)`,
        );
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Server modules importing client-only values:\n  ${violations.join("\n  ")}\n\n` +
      `Move the shared value into a module with no "use client" directive.`,
  );
});
