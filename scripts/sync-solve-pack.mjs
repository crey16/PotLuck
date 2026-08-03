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
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const SPOT = "srp-btn-bb";
const source = join(process.cwd(), "solver", "pack", SPOT);
const target = join(process.cwd(), "public", "solves", SPOT);

if (!existsSync(source)) {
  console.error(`sync-solve-pack: missing canonical pack at ${source}`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`sync-solve-pack: published ${SPOT} to public/solves/`);
