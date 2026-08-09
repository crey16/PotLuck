/**
 * Measure what the browser actually downloads — M8.8C.
 *
 * Next 16's Turbopack build prints no size table, so "is this route heavy?"
 * had no answer in this repo. This reconstructs one from the build's own
 * manifests rather than from hard-coded chunk names, which are content-hashed
 * and change on every build.
 *
 * ## Where the numbers come from
 *
 * - `.next/build-manifest.json` gives the files every route loads:
 *   `rootMainFiles` (framework + app runtime) and `polyfillFiles`.
 * - `.next/server/app/<route>/page_client-reference-manifest.js` gives the
 *   client modules that route's RSC payload references, each with the chunks
 *   that satisfy it and an `async` flag. `async: false` means the chunk is
 *   part of initial hydration; `async: true` means it arrives later, which is
 *   exactly what a `next/dynamic` or `await import()` boundary produces.
 *
 * So: initial JS for a route = rootMainFiles ∪ its non-async chunks.
 *
 * ## What it deliberately does not claim
 *
 * **Polyfills are excluded from the headline.** Next emits them with
 * `noModule`, so every browser this app supports skips the request. They are
 * reported on their own line rather than folded into a total that no real
 * visitor transfers.
 *
 * **Attribution is per route, not per module.** A chunk shared by two routes
 * is counted in both, because both routes download it. Summing the route
 * column therefore double-counts shared code on purpose — `--chunks` shows the
 * de-duplicated view.
 *
 * **The manifest's `async` flag is not the whole story, and the gap matters
 * here.** It marks client references that Next itself defers — a `next/dynamic`
 * component that still server-renders. It does NOT mark a chunk produced by a
 * plain `await import()` inside a client module, or by `dynamic(..., {ssr:
 * false})`: neither is a client reference at all, so the RSC manifest never
 * mentions it and Turbopack resolves it at runtime. Those chunks are emitted
 * to `.next/static/chunks` and referenced by nobody's initial set, which is
 * exactly what `lazyChunks` below detects. Reporting only the `async` flag
 * would have shown this milestone's 64 kB Supabase deferral as bytes that
 * simply evaporated.
 *
 * **gzip, not Brotli, is the comparison basis.** Vercel serves Brotli where
 * the client offers it, so these are an upper bound on real transfer. gzip is
 * used because it is available everywhere this runs, and because a before/after
 * comparison only needs one consistent basis. `zlib` level 9 is deterministic,
 * so the same build measures identically every time.
 *
 * ## Usage
 *
 *   node scripts/measure-bundle.mjs                 # table
 *   node scripts/measure-bundle.mjs --chunks        # + largest shared chunks
 *   node scripts/measure-bundle.mjs --json          # machine-readable
 *   node scripts/measure-bundle.mjs --save baseline.json
 *   node scripts/measure-bundle.mjs --against baseline.json   # before/after
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const NEXT_DIR = join(ROOT, ".next");
const SOLVE_DIR = join(ROOT, "public", "solves");

/** Routes the roadmap names, plus everything else the build emitted. */
const HEADLINE_ROUTES = [
  "/page",
  "/daily/page",
  "/learn/page",
  "/learn/practice/page",
  "/learn/table/page",
  "/drill/page",
  "/play/page",
  "/play/history/page",
  "/leaderboard/page",
  "/ranges/page",
  "/placement/page",
];

function die(message) {
  console.error(`measure-bundle: ${message}`);
  process.exit(1);
}

function requireBuild() {
  if (!existsSync(NEXT_DIR)) die("no .next/ — run `npm run build` first");
  if (!existsSync(join(NEXT_DIR, "build-manifest.json"))) {
    die("no .next/build-manifest.json — the build did not finish");
  }
  if (!existsSync(join(NEXT_DIR, "server", "app"))) {
    die("no .next/server/app — this is not an App Router build");
  }
}

const sizeCache = new Map();

/** Raw and gzip size of one emitted asset, addressed the way a manifest names it. */
function sizeOf(assetPath) {
  if (sizeCache.has(assetPath)) return sizeCache.get(assetPath);
  const rel = assetPath.replace(/^\/_next\//, "").replace(/^\//, "");
  const file = join(NEXT_DIR, rel);
  let result;
  if (!existsSync(file) || !statSync(file).isFile()) {
    result = { raw: 0, gzip: 0, missing: true };
  } else {
    const bytes = readFileSync(file);
    result = { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
  }
  sizeCache.set(assetPath, result);
  return result;
}

/**
 * Parse one route's client-reference manifest.
 *
 * The file is executable JS that assigns a single object literal, so the value
 * is read by slicing from the first `= {` rather than by evaluating it — this
 * script must never run build output.
 */
function readRouteManifest(file) {
  const src = readFileSync(file, "utf8");
  const keyMatch = src.match(/globalThis\.__RSC_MANIFEST\[("(?:[^"\\]|\\.)*")\]/);
  if (!keyMatch) die(`cannot find the route key in ${relative(ROOT, file)}`);
  const route = JSON.parse(keyMatch[1]);
  const start = src.indexOf("= {", keyMatch.index);
  if (start < 0) die(`cannot find the manifest body in ${relative(ROOT, file)}`);
  const body = src.slice(start + 2).trim().replace(/;\s*$/, "");
  let manifest;
  try {
    manifest = JSON.parse(body);
  } catch (error) {
    die(`cannot parse ${relative(ROOT, file)}: ${error.message}`);
  }
  if (!manifest.clientModules) die(`${relative(ROOT, file)} has no clientModules`);
  return { route, manifest };
}

function findRouteManifests(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) findRouteManifests(path, found);
    else if (entry.name === "page_client-reference-manifest.js") found.push(path);
  }
  return found;
}

function total(chunks) {
  let raw = 0;
  let gzip = 0;
  const missing = [];
  for (const chunk of chunks) {
    const size = sizeOf(chunk);
    if (size.missing) missing.push(chunk);
    raw += size.raw;
    gzip += size.gzip;
  }
  return { raw, gzip, count: chunks.size ?? chunks.length, missing };
}

export function measureJs() {
  requireBuild();
  const build = JSON.parse(readFileSync(join(NEXT_DIR, "build-manifest.json"), "utf8"));
  const shared = (build.rootMainFiles ?? []).map((f) => `/_next/${f}`);
  const polyfills = (build.polyfillFiles ?? []).map((f) => `/_next/${f}`);

  const routes = {};
  for (const file of findRouteManifests(join(NEXT_DIR, "server", "app"))) {
    const { route, manifest } = readRouteManifest(file);
    const initial = new Set(shared);
    const deferred = new Set();
    for (const entry of Object.values(manifest.clientModules)) {
      for (const chunk of entry.chunks ?? []) {
        (entry.async ? deferred : initial).add(chunk);
      }
    }
    // A chunk that is async for one module and sync for another is loaded
    // eagerly — the eager reference wins, or the total would understate.
    for (const chunk of initial) deferred.delete(chunk);
    routes[route] = {
      initial: total(initial),
      deferred: total(deferred),
      deferredChunks: [...deferred],
    };
  }
  return {
    shared: total(new Set(shared)),
    polyfills: total(new Set(polyfills)),
    routes,
  };
}

/**
 * Every emitted client chunk, largest first — the de-duplicated view.
 *
 * `routes` tells you what a visitor downloads; this tells you what is big.
 * A chunk on this list that appears in every route's initial set is the one
 * worth attacking, because the saving multiplies across the whole product.
 */
export function measureChunks(js, limit = 12) {
  const usedBy = new Map();
  for (const [route, data] of Object.entries(js.routes)) {
    for (const chunk of data.deferredChunks) {
      if (!usedBy.has(chunk)) usedBy.set(chunk, { routes: [], deferred: true });
      usedBy.get(chunk).routes.push(route);
    }
  }
  // Re-derive the initial sets: `total()` discarded the names.
  const build = JSON.parse(readFileSync(join(NEXT_DIR, "build-manifest.json"), "utf8"));
  const shared = (build.rootMainFiles ?? []).map((f) => `/_next/${f}`);
  for (const file of findRouteManifests(join(NEXT_DIR, "server", "app"))) {
    const { route, manifest } = readRouteManifest(file);
    const initial = new Set(shared);
    for (const entry of Object.values(manifest.clientModules)) {
      if (entry.async) continue;
      for (const chunk of entry.chunks ?? []) initial.add(chunk);
    }
    for (const chunk of initial) {
      if (!usedBy.has(chunk)) usedBy.set(chunk, { routes: [], deferred: false });
      const record = usedBy.get(chunk);
      record.deferred = false;
      if (!record.routes.includes(route)) record.routes.push(route);
    }
  }
  return [...usedBy.entries()]
    .map(([chunk, record]) => ({
      chunk,
      ...sizeOf(chunk),
      routes: record.routes.length,
      deferred: record.deferred,
    }))
    .sort((a, b) => b.gzip - a.gzip)
    .slice(0, limit);
}

/**
 * Emitted client chunks that no route loads initially — what was deferred.
 *
 * The complement of the route table: every `.js` under `.next/static/chunks`
 * that is not in any route's initial set and is not a build-manifest file.
 * A chunk only gets here by being reachable exclusively through a runtime
 * `import()`, so the list is the honest answer to "which bytes moved to a
 * later request?" — as opposed to "which bytes stopped existing?", which for a
 * code-splitting change is almost always none of them.
 */
export function measureLazyChunks() {
  requireBuild();
  const build = JSON.parse(readFileSync(join(NEXT_DIR, "build-manifest.json"), "utf8"));
  const eager = new Set([
    ...(build.rootMainFiles ?? []).map((f) => `/_next/${f}`),
    ...(build.polyfillFiles ?? []).map((f) => `/_next/${f}`),
  ]);
  for (const file of findRouteManifests(join(NEXT_DIR, "server", "app"))) {
    const { manifest } = readRouteManifest(file);
    for (const entry of Object.values(manifest.clientModules)) {
      if (entry.async) continue;
      for (const chunk of entry.chunks ?? []) eager.add(chunk);
    }
  }
  const dir = join(NEXT_DIR, "static", "chunks");
  if (!existsSync(dir)) return [];
  const lazy = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".js")) {
        const asset = `/_next/${relative(NEXT_DIR, path).split(/[\\/]/).join("/")}`;
        // The Turbopack runtime is loaded by the HTML, not by any manifest.
        if (eager.has(asset) || entry.name.startsWith("turbopack-")) continue;
        lazy.push({ chunk: asset, ...sizeOf(asset) });
      }
    }
  };
  walk(dir);
  return lazy.sort((a, b) => b.gzip - a.gzip);
}

/**
 * The solve pack as the browser sees it.
 *
 * These are static assets under public/, so they are not in any JS chunk and
 * never touch first paint — but they are the largest thing the product
 * transfers, so "how big is a hand?" needs an answer next to the JS numbers
 * rather than in someone's memory. `perHand` is what one dealt hand costs:
 * the manifest and the preflop pack once per session, then the median flop
 * file, which is the only part that repeats.
 */
export function measureSolvePack() {
  if (!existsSync(SOLVE_DIR)) {
    return { published: false, spots: [] };
  }
  const spots = [];
  for (const spot of readdirSync(SOLVE_DIR)) {
    const spotDir = join(SOLVE_DIR, spot);
    if (!statSync(spotDir).isDirectory()) continue;
    // M8.8C put the pack behind a content-addressed segment
    // (`<spot>/<fingerprint>/…`) so the assets can be served immutable. Find
    // it rather than hard-coding the hash, and still handle the flat layout so
    // this keeps working against an older build.
    const fingerprint = readdirSync(spotDir).find(
      (entry) => /^[0-9a-f]{16}$/.test(entry) && statSync(join(spotDir, entry)).isDirectory()
    );
    const dir = fingerprint ? join(spotDir, fingerprint) : spotDir;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (files.length === 0) continue;
    const sized = files.map((name) => {
      const bytes = readFileSync(join(dir, name));
      return { name, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
    });
    const named = (name) => sized.find((f) => f.name === name) ?? { raw: 0, gzip: 0 };
    const boards = sized
      .filter((f) => !["index.json", "preflop.json", "catalog.json"].includes(f.name))
      .sort((a, b) => a.gzip - b.gzip);
    const median = boards.length ? boards[Math.floor(boards.length / 2)] : { raw: 0, gzip: 0 };
    spots.push({
      spot,
      fingerprint: fingerprint ?? null,
      files: sized.length,
      totalRaw: sized.reduce((a, f) => a + f.raw, 0),
      totalGzip: sized.reduce((a, f) => a + f.gzip, 0),
      manifest: named("index.json"),
      preflop: named("preflop.json"),
      boardCount: boards.length,
      medianBoard: { raw: median.raw, gzip: median.gzip },
      largestBoard: boards.length ? boards[boards.length - 1] : { raw: 0, gzip: 0 },
    });
  }
  return { published: true, spots };
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const pad = (s, n) => String(s).padStart(n);

function report({ chunks: withChunks }) {
  const js = measureJs();
  const pack = measureSolvePack();

  console.log("Initial client JS per route — gzip, excluding nomodule polyfills");
  console.log("");
  console.log(`${pad("gzip", 10)}${pad("raw", 12)}  route`);
  const ordered = [
    ...HEADLINE_ROUTES.filter((r) => js.routes[r]),
    ...Object.keys(js.routes).filter((r) => !HEADLINE_ROUTES.includes(r)).sort(),
  ];
  for (const route of ordered) {
    const { initial, deferred } = js.routes[route];
    const tail = deferred.gzip > 0 ? `   (+${kb(deferred.gzip)} deferred)` : "";
    console.log(`${pad(kb(initial.gzip), 10)}${pad(kb(initial.raw), 12)}  ${route}${tail}`);
  }
  console.log("");
  console.log(`shared floor (framework + app runtime): ${kb(js.shared.gzip)} gzip / ${kb(js.shared.raw)} raw`);
  console.log(`nomodule polyfills (not transferred by supported browsers): ${kb(js.polyfills.gzip)} gzip`);

  if (withChunks) {
    console.log("");
    console.log("Largest emitted client chunks — de-duplicated");
    console.log(`${pad("gzip", 10)}${pad("raw", 12)}${pad("routes", 9)}  chunk`);
    for (const c of measureChunks(js)) {
      const flag = c.deferred ? " [deferred]" : "";
      console.log(`${pad(kb(c.gzip), 10)}${pad(kb(c.raw), 12)}${pad(c.routes, 9)}  ${c.chunk}${flag}`);
    }
  }

  const lazy = measureLazyChunks();
  console.log("");
  if (lazy.length === 0) {
    console.log("No lazily-loaded client chunks — every emitted chunk is in some route's initial JS.");
  } else {
    const sum = lazy.reduce((a, c) => a + c.gzip, 0);
    console.log(`Lazily-loaded client chunks — ${kb(sum)} gzip across ${lazy.length}, fetched on use, never at first paint`);
    for (const c of lazy.slice(0, 8)) {
      console.log(`${pad(kb(c.gzip), 10)}${pad(kb(c.raw), 12)}  ${c.chunk}`);
    }
  }

  console.log("");
  if (!pack.published) {
    console.log("Solve pack: public/solves is absent — run `npm run sync:solves`");
  }
  for (const spot of pack.spots) {
    console.log(
      `Solve pack ${spot.spot} — static assets, fetched on /play, never bundled` +
        (spot.fingerprint
          ? `\n  url               /solves/${spot.spot}/${spot.fingerprint}/ (content-addressed, immutable)`
          : "\n  url               /solves/" + spot.spot + "/ (NOT content-addressed — not cacheable as immutable)")
    );
    console.log(`  whole pack        ${kb(spot.totalRaw)} raw / ${kb(spot.totalGzip)} gzip across ${spot.files} files`);
    console.log(`  session preamble  ${kb(spot.manifest.raw + spot.preflop.raw)} raw / ${kb(spot.manifest.gzip + spot.preflop.gzip)} gzip (index.json + preflop.json)`);
    console.log(`  per hand (median) ${kb(spot.medianBoard.raw)} raw / ${kb(spot.medianBoard.gzip)} gzip of ${spot.boardCount} boards`);
    console.log(`  per hand (worst)  ${kb(spot.largestBoard.raw)} raw / ${kb(spot.largestBoard.gzip)} gzip`);
  }
  return { js, pack };
}

function compare(baselinePath) {
  if (!existsSync(baselinePath)) die(`no baseline at ${baselinePath}`);
  const before = JSON.parse(readFileSync(baselinePath, "utf8"));
  const js = measureJs();
  const pack = measureSolvePack();
  console.log("Initial client JS — gzip, before vs after");
  console.log("");
  console.log(`${pad("before", 10)}${pad("after", 10)}${pad("saved", 10)}${pad("%", 8)}  route`);
  const routes = [
    ...HEADLINE_ROUTES.filter((r) => js.routes[r] || before.js.routes[r]),
    ...Object.keys(js.routes).filter((r) => !HEADLINE_ROUTES.includes(r)).sort(),
  ];
  for (const route of routes) {
    const b = before.js.routes[route]?.initial.gzip;
    const a = js.routes[route]?.initial.gzip;
    if (b === undefined || a === undefined) {
      console.log(`${pad("—", 10)}${pad("—", 10)}${pad("—", 10)}${pad("—", 8)}  ${route} (only in one build)`);
      continue;
    }
    const saved = b - a;
    console.log(
      `${pad(kb(b), 10)}${pad(kb(a), 10)}${pad(kb(saved), 10)}${pad(`${((100 * saved) / b).toFixed(1)}%`, 8)}  ${route}`
    );
  }
  const beforePack = before.pack.spots?.[0];
  const afterPack = pack.spots?.[0];
  console.log("");
  if (beforePack && afterPack) {
    const same = beforePack.totalRaw === afterPack.totalRaw && beforePack.totalGzip === afterPack.totalGzip;
    console.log(
      `Solve pack ${afterPack.spot}: ${kb(afterPack.totalRaw)} raw / ${kb(afterPack.totalGzip)} gzip — ` +
        (same ? "unchanged" : `CHANGED from ${kb(beforePack.totalRaw)} raw / ${kb(beforePack.totalGzip)} gzip`)
    );
  }
  return { js, pack };
}

function main(argv) {
  const args = new Set(argv);
  const valueOf = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const against = valueOf("--against");
  const result = against ? compare(against) : report({ chunks: args.has("--chunks") });
  result.lazyChunks = measureLazyChunks();
  const save = valueOf("--save");
  if (save) {
    writeFileSync(save, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`\nsaved to ${save}`);
  }
  if (args.has("--json")) console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
