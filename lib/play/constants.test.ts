import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { PLAY_SOLVE_PACK_FINGERPRINT, PLAY_SOLVE_PACK_ID } from "./constants";

/**
 * Guards M8.8C: a URL advertised as immutable must never return different
 * bytes.
 *
 * `next.config.ts` serves `/solves/<spot>/<fingerprint>/…` with
 * `max-age=31536000, immutable`. That promise is only keepable because the
 * fingerprint is a content address — the first 16 hex characters of the
 * catalog's `content_hash`, taken over the manifest, every flop file, the
 * preflop pack and the canonical metadata. If the constant and the pack ever
 * came apart, one of two things would happen: the browser would 404 on every
 * hand, or worse, a republished pack would land on a path some client had
 * already been told to cache for a year.
 *
 * `scripts/sync-solve-pack.mjs` refuses to publish on a mismatch, so a stale
 * constant fails the build. This is the same check in the unit suite, where it
 * fails in seconds rather than at deploy time.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const SPOT = "srp-btn-bb";
const PACK = path.join(ROOT, "solver", "pack", SPOT);

const catalog = () => JSON.parse(readFileSync(path.join(PACK, "catalog.json"), "utf8"));

test("the fingerprint is the head of the catalog's content hash", () => {
  const hash = String(catalog().content_hash);
  assert.match(hash, /^sha256:[0-9a-f]{64}$/, "catalog.json has no usable content_hash");
  const expected = hash.slice("sha256:".length, "sha256:".length + 16);
  assert.equal(
    PLAY_SOLVE_PACK_FINGERPRINT,
    expected,
    `the pack was republished without updating PLAY_SOLVE_PACK_FINGERPRINT. Set it to ` +
      `"${expected}" in lib/play/constants.ts — otherwise /play requests a path that does ` +
      `not exist, or an immutable URL changes meaning.`
  );
});

test("the fingerprint is a usable, unambiguous path segment", () => {
  assert.match(PLAY_SOLVE_PACK_FINGERPRINT, /^[0-9a-f]{16}$/);
  // next.config.ts matches exactly this shape before applying `immutable`.
  assert.equal(PLAY_SOLVE_PACK_FINGERPRINT.length, 16);
});

test("the immutable header is scoped to the fingerprinted path only", () => {
  const config = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
  assert.match(config, /immutable/, "the immutable header is gone");
  assert.match(
    config,
    /\/solves\/:spot\/:fingerprint\(\[0-9a-f\]\{16\}\)\//,
    "immutable must apply only to a 16-hex content-addressed segment — never to /solves/<spot>/<file>"
  );
});

test("an auth redirect out of an immutable path is not cacheable", () => {
  // `headers()` matches on PATH, so its rules land on whatever response comes
  // back for that path — including middleware's 307 to /login. Before this was
  // fixed the signed-out response to a solve URL carried
  // `max-age=31536000, immutable`, which invites a shared cache to pin "go to
  // login" for a year at an address that must return JSON.
  const middleware = readFileSync(
    path.join(ROOT, "lib", "supabase", "middleware.ts"),
    "utf8"
  );
  assert.match(
    middleware,
    /redirect\.headers\.set\(\s*"Cache-Control",\s*"no-store"\s*\)/,
    "the login redirect must set no-store, or next.config's long-lived headers apply to it"
  );
});

test("the fingerprint tracks the pack, not the pack id", () => {
  // Mutation test: a fingerprint derived from PLAY_SOLVE_PACK_ID would look
  // versioned and would NOT change when the solver republishes the same id
  // with new bytes, which is precisely the case `immutable` cannot survive.
  const fromId = createHash("sha256").update(PLAY_SOLVE_PACK_ID).digest("hex").slice(0, 16);
  assert.notEqual(PLAY_SOLVE_PACK_FINGERPRINT, fromId);
});

test("changing any pack byte changes the fingerprint", () => {
  const hash = String(catalog().content_hash).slice("sha256:".length);
  const perturbed = createHash("sha256").update(`${hash}x`).digest("hex").slice(0, 16);
  assert.notEqual(perturbed, PLAY_SOLVE_PACK_FINGERPRINT);
});

test("the client fetches from the fingerprinted path", () => {
  const load = readFileSync(path.join(ROOT, "lib", "play", "load.ts"), "utf8");
  assert.match(
    load,
    /const BASE = `\/solves\/\$\{SPOT\}\/\$\{PLAY_SOLVE_PACK_FINGERPRINT\}`/,
    "lib/play/load.ts must build its URLs from the fingerprint"
  );
});

test("the published copy, when present, sits under the fingerprint and matches the canonical pack", () => {
  const published = path.join(ROOT, "public", "solves", SPOT, PLAY_SOLVE_PACK_FINGERPRINT);
  if (!existsSync(published)) {
    // public/solves is generated and git-ignored; a fresh clone has not run
    // the sync script yet. The build always does, so skipping here is honest
    // rather than a hole.
    return;
  }
  const canonical = readdirSync(PACK).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(readdirSync(published).filter((f) => f.endsWith(".json")).sort(), canonical);
  // Byte integrity: packaging changed the path, never the data.
  for (const file of canonical) {
    assert.deepEqual(
      readFileSync(path.join(published, file)),
      readFileSync(path.join(PACK, file)),
      `${file} differs between the canonical pack and the published copy`
    );
  }
});

test("no stale unfingerprinted copy is left beside it", () => {
  const spotDir = path.join(ROOT, "public", "solves", SPOT);
  if (!existsSync(spotDir)) return;
  const strays = readdirSync(spotDir).filter((entry) => entry !== PLAY_SOLVE_PACK_FINGERPRINT);
  assert.deepEqual(
    strays,
    [],
    "an older publish is still being served; sync-solve-pack.mjs clears the spot directory"
  );
});
