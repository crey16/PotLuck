/**
 * Publish the solve pack to public/ for the browser.
 *
 * The pack is the input to server-authoritative grading, so its canonical copy
 * must be readable by the Python function.  Vercel promotes public/ to static
 * assets and strips it from the function bundle, and `includeFiles` does not
 * apply to Next.js projects — so the committed copy lives under solver/pack/
 * and this script mirrors it into public/ at build time.  public/solves is
 * generated output and is git-ignored.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const SPOT = "srp-btn-bb";
const source = join(process.cwd(), "solver", "pack", SPOT);

if (!existsSync(source)) {
  console.error(`sync-solve-pack: missing canonical pack at ${source}`);
  process.exit(1);
}

/**
 * The published directory is content-addressed — M8.8C.
 *
 * The pack is copied to `public/solves/<spot>/<fingerprint>/`, where the
 * fingerprint is the first 16 hex characters of the catalog's `content_hash`
 * (computed over the manifest, every flop file, the preflop pack and the
 * canonical metadata). Different bytes therefore cannot reach the same URL,
 * which is what lets `next.config.ts` serve these files `immutable` — the
 * headers are safe because of the naming, not because of a longer max-age.
 *
 * The browser has to know that segment before it can fetch anything, so it
 * lives in `lib/play/constants.ts`. That makes the two able to drift, so this
 * script refuses to publish when they disagree: a stale constant fails the
 * build here rather than shipping a /play that 404s on every hand.
 */
const catalogPath = join(source, "catalog.json");
if (!existsSync(catalogPath)) {
  console.error(`sync-solve-pack: missing ${catalogPath}`);
  process.exit(1);
}
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const contentHash = String(catalog.content_hash ?? "");
const match = /^sha256:([0-9a-f]{64})$/.exec(contentHash);
if (!match) {
  console.error(`sync-solve-pack: catalog.json has no usable content_hash (${contentHash})`);
  process.exit(1);
}
const fingerprint = match[1].slice(0, 16);

const constants = readFileSync(
  join(process.cwd(), "lib", "play", "constants.ts"),
  "utf8"
);
const declared = /PLAY_SOLVE_PACK_FINGERPRINT\s*=\s*"([0-9a-f]+)"/.exec(constants)?.[1];
if (declared !== fingerprint) {
  console.error(
    `sync-solve-pack: PLAY_SOLVE_PACK_FINGERPRINT is "${declared}" but the pack hashes to ` +
      `"${fingerprint}".\n` +
      `  The pack changed without the constant. Set it in lib/play/constants.ts to "${fingerprint}".`
  );
  process.exit(1);
}

const spotDir = join(process.cwd(), "public", "solves", SPOT);
const target = join(spotDir, fingerprint);

mkdirSync(dirname(target), { recursive: true });
// The whole spot directory is cleared, not just this fingerprint: leaving an
// older pack's directory behind would keep serving bytes nothing references,
// and `public/solves` is generated output with no history worth keeping.
rmSync(spotDir, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`sync-solve-pack: published ${SPOT} to public/solves/${SPOT}/${fingerprint}/`);
