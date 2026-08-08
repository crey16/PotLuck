import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Guards M8.8C: a server render must never call this deployment's own public
 * `/api` URL.
 *
 * Until 2026-08-08, `/daily`, `/learn/practice` and `/learn/table` awaited
 * their content during the server render through
 * `fetch(\`${origin}/api/...\`)`, where `origin` was rebuilt per request from
 * `x-forwarded-host`. That is a second network hop from the Next function to
 * the Python function on the critical path of first paint, in front of a
 * 300-800ms Python cold start, with the access token forwarded by hand — and
 * it failed soft into `null`, so a 401, an unseeded database and a cold
 * function all rendered the same "the API may still be starting" panel.
 *
 * The rule this test enforces is narrow and mechanical: no SERVER-side module
 * may fetch an absolute URL built from a request host, an origin variable, or
 * a Vercel URL. Client modules are exempt — a browser calling `/api/...` is
 * the normal path, and it uses a RELATIVE URL, which is why the check keys on
 * absoluteness rather than on the word "api".
 *
 * A source scan rather than a runtime assertion because the failure is
 * invisible at runtime: the page renders correctly either way, just slower and
 * with an extra function invocation. `components/learn/coursePathSingleSource.test.ts`
 * and `components/drill/clientBoundary.test.ts` guard their rules the same way.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SCANNED = ["app", "lib", "components"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

/**
 * Is this module browser-side?
 *
 * The `"use client"` directive is the explicit signal, but several modules
 * that only ever run in the browser do not carry it — they are plain helpers
 * imported by client components (`lib/drill/recordAttempt.ts`,
 * `lib/drill/drillState.ts`). What they DO carry is an import of the browser
 * Supabase client, which is meaningless on the server: it reads the session
 * from browser storage. So that import is taken as the second signal.
 *
 * This keeps the rule sharp rather than weakening it. The helper that was
 * removed imported `lib/supabase/server` — the SERVER client — so it would
 * still be caught by every check below.
 *
 * **`lazyClient` is the same signal, and omitting it broke this test.** M8.8C
 * moved every browser call site from `supabase/client` to
 * `supabase/lazyClient`, which reaches the identical client through a runtime
 * `import()` so the 64 kB SDK stays out of first paint.
 * `lib/drill/recordAttempt.ts` did not become a server module when its import
 * changed — but this heuristic said it had, and the rule below then failed on
 * a relative `/api/progress/attempts` fetch that has always been correct.
 */
const isClientModule = (source: string): boolean =>
  /^\s*(["'])use client\1/.test(source) ||
  /from\s+["'](?:@\/lib|\.{1,2}[\w./-]*)\/supabase\/(?:lazyC|c)lient["']/.test(source);

/**
 * Every `fetch` URL in a module, as written.
 *
 * The rule is that a server module's fetch target must be STATICALLY KNOWN to
 * be relative. A template is fine when it starts with `/` — `lib/play/load.ts`
 * fetches `` `${BASE}/index.json` `` where `BASE` is a local `/solves/...`
 * constant, which is a same-origin static asset and exactly the pattern this
 * rule should permit. So one level of local `const` is resolved; anything
 * that still cannot be shown to start with `/` is reported, because
 * "unresolvable" is where the old `${await apiOrigin()}` lived and an
 * origin-carrying variable is indistinguishable from a relative one without
 * following it.
 */
function fetchTargets(source: string): string[] {
  return [...source.matchAll(/fetch\(\s*([`'"][^`'"]*|[A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
}

function resolvesToRelative(target: string, source: string): boolean {
  if (/^['"`]\//.test(target)) return true;
  // A template or identifier: resolve one level of local constant.
  const identifier = target.startsWith("`")
    ? /^`\$\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(target)?.[1]
    : target;
  if (!identifier) return false;
  const declaration = new RegExp(
    `(?:const|let|var)\\s+${identifier}\\s*(?::[^=]+)?=\\s*([\`'"])([^\`'"]*)`,
  ).exec(source);
  return declaration ? declaration[2].startsWith("/") : false;
}

/** Building an origin out of proxy headers, the tell of the old helper. */
const REQUEST_ORIGIN = /x-forwarded-host|VERCEL_PROJECT_PRODUCTION_URL|VERCEL_URL/;

test("no server module fetches a URL that is not statically relative", () => {
  const offenders: string[] = [];
  for (const dir of SCANNED) {
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(file, "utf8");
      if (isClientModule(source)) continue;
      for (const target of fetchTargets(source)) {
        if (!resolvesToRelative(target, source)) {
          offenders.push(`${path.relative(ROOT, file)} (${target})`);
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `server modules must not fetch an absolute URL — call a shared service ` +
      `directly, or load it in the browser: ${offenders.join(", ")}`,
  );
});

test("the rule itself catches the pattern that was removed", () => {
  // The deleted `lib/learn/serverApi.ts`, in miniature. Without this, a later
  // tightening of the resolver could quietly make the guard above vacuous.
  const removed = `
    async function apiOrigin() { return "https://example.com"; }
    export async function get(path: string) {
      const response = await fetch(\`\${await apiOrigin()}\${path}\`);
      return response.json();
    }
  `;
  const targets = fetchTargets(removed);
  assert.equal(targets.length, 1);
  assert.equal(resolvesToRelative(targets[0], removed), false);

  // And it does NOT catch the same-origin static asset pattern.
  const allowed = 'const BASE = `/solves/x`;\nawait fetch(`${BASE}/index.json`);';
  assert.equal(resolvesToRelative(fetchTargets(allowed)[0], allowed), true);
  const literal = 'await fetch("/api/progress/attempts", { method: "POST" });';
  assert.equal(resolvesToRelative(fetchTargets(literal)[0], literal), true);
});

test("nothing rebuilds this deployment's own origin from request headers", () => {
  const offenders: string[] = [];
  for (const dir of SCANNED) {
    for (const file of sourceFiles(dir)) {
      const source = readFileSync(file, "utf8");
      // `app/auth/callback/route.ts` legitimately uses the request's own
      // origin to build a REDIRECT target, which is not a self-call, so the
      // check is for the proxy-header origin machinery specifically.
      if (REQUEST_ORIGIN.test(source)) offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `self-origin machinery is back: ${offenders.join(", ")}`);
});

test("the three personalized learn routes load their content in the browser", () => {
  // Each page keeps its server-rendered shell (metadata, query parsing) and
  // delegates the personalized read to a client loader. If one of these
  // regresses to awaiting the data in the page, the first test above would
  // only catch it if the fetch were absolute — this catches the shape.
  const routes: [string, string][] = [
    ["app/daily/page.tsx", "DailyLoader"],
    ["app/learn/practice/page.tsx", "PracticeLoader"],
    ["app/learn/table/page.tsx", "TableLoader"],
  ];
  for (const [file, loader] of routes) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(source.includes(`<${loader}`), `${file} must render <${loader} />`);
    assert.ok(
      !/await\s+fetch/.test(source),
      `${file} must not await a fetch during the server render`,
    );
  }
});
