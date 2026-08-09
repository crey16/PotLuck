import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Guards M8.8C: the Supabase SDK must not be in any route's first paint.
 *
 * `@supabase/supabase-js` is 244 kB raw / 64 kB gzipped. Measured against the
 * production build on 2026-08-08 it was in the initial JavaScript of **21 of
 * the 22 routes** — not because 21 routes talk to Supabase from the browser,
 * but because one static import in `components/ui/SiteHeader.tsx`, which the
 * root layout renders on every page, pulled it in to call `auth.signOut()`
 * inside a click handler. Nine more routes kept it through the five
 * `authRequest` helpers. Routing every browser caller through
 * `lib/supabase/lazyClient.ts` took 63.5 kB gzipped off every route.
 *
 * ## Why a source scan and not a bundle assertion
 *
 * The obvious test — "assert the emitted chunk is not in the route's initial
 * set" — needs a production build and would key on content-hashed filenames
 * that change every time anything changes. This scan runs in the unit suite,
 * needs no build, and fails on the *cause* rather than the symptom: a single
 * `import { createClient } from "@/lib/supabase/client"` added to any client
 * module silently undoes the whole milestone, and nothing else would notice.
 * `components/learn/noSelfApiFetch.test.ts` guards its rule the same way.
 *
 * The rule is narrow: a **static** import of the browser client is banned
 * everywhere except the lazy wrapper itself. Nothing about how the client is
 * used is constrained, and the server client (`./server.ts`) is untouched —
 * deferring an import there would buy nothing, because there is no bundle to
 * shrink on the server.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCANNED = ["app", "lib", "components"];

/** The one module allowed to reach the browser client directly. */
const WRAPPER = path.join("lib", "supabase", "lazyClient.ts");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

/**
 * A static import of the browser Supabase client, in any spelling.
 *
 * `import x from "..."` and `export … from "..."` both bind at module load and
 * so both put the SDK in the importing chunk. A dynamic `import("...")` does
 * not, which is exactly what the wrapper does and why the pattern requires
 * `from` — matching on the path alone would flag the wrapper and every comment
 * that names the module.
 */
const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)\b[^;\n]*?\sfrom\s+["'](?:@\/lib|\.{1,2}[\w./-]*)\/supabase\/client["']/;

/** Direct imports of the SDK packages, which would defeat the wrapper too. */
const DIRECT_SDK =
  /(?:^|\n)\s*(?:import|export)\b[^;\n]*?\sfrom\s+["']@supabase\/(?:ssr|supabase-js)["']/;

/** `import type` is erased at compile time and ships no bytes. */
const isTypeOnly = (statement: string): boolean => /\b(?:import|export)\s+type\b/.test(statement);

function offenders(pattern: RegExp, allow: string[]): string[] {
  const found: string[] = [];
  for (const dir of SCANNED) {
    for (const file of sourceFiles(dir)) {
      const relative = path.relative(ROOT, file);
      if (allow.includes(relative)) continue;
      const source = readFileSync(file, "utf8");
      const match = source.match(pattern);
      if (match && !isTypeOnly(match[0])) found.push(relative);
    }
  }
  return found.sort();
}

test("only the lazy wrapper statically imports the browser Supabase client", () => {
  assert.deepEqual(
    offenders(STATIC_IMPORT, [WRAPPER]),
    [],
    "import { loadSupabaseClient } from \"@/lib/supabase/lazyClient\" instead — a static " +
      "import of supabase/client puts 64 kB gzipped into this route's first paint"
  );
});

test("nothing outside lib/supabase reaches for the SDK packages directly", () => {
  assert.deepEqual(
    offenders(DIRECT_SDK, [
      path.join("lib", "supabase", "client.ts"),
      path.join("lib", "supabase", "server.ts"),
      path.join("lib", "supabase", "middleware.ts"),
      // M8.8C's userless client for shipped content. It belongs on this list
      // for the same reason as the three above: it is one of the wrappers, not
      // a caller reaching past them. It is server-only and imported solely by
      // lib/content/publicContent.ts, so it adds nothing to a client bundle —
      // the route table in `npm run measure:bundle` is what actually proves
      // that, and it did not move when this landed.
      path.join("lib", "supabase", "contentClient.ts"),
    ]),
    [],
    "route the browser through lib/supabase/lazyClient.ts and the server through lib/supabase/server.ts"
  );
});

test("the rule catches the import it was written to prevent", () => {
  // The exact line that was in SiteHeader.tsx before M8.8C. Without this, a
  // pattern that silently stopped matching would leave both tests passing
  // vacuously and the regression invisible.
  const before = '"use client";\n\nimport { createClient } from "@/lib/supabase/client";\n';
  assert.ok(STATIC_IMPORT.test(before));
  assert.ok(!isTypeOnly(before.match(STATIC_IMPORT)![0]));

  // ...and does not flag the dynamic import that replaced it.
  const after = 'const mod = await import("./client");\n';
  assert.ok(!STATIC_IMPORT.test(after));

  // ...nor a type-only import, which is erased and costs nothing.
  const typeOnly = 'import type { SupabaseClient } from "@supabase/supabase-js";\n';
  assert.ok(isTypeOnly(typeOnly.match(DIRECT_SDK)![0]));
});

test("the wrapper itself never imports the SDK statically", () => {
  const source = readFileSync(path.join(ROOT, WRAPPER), "utf8");
  assert.ok(
    !STATIC_IMPORT.test(source),
    "lazyClient.ts must reach ./client through import(), or it defeats its own purpose"
  );
  assert.match(source, /import\(["']\.\/client["']\)/);
});
