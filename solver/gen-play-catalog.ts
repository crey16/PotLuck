/**
 * Publish the small, versioned metadata catalog consumed by the M8 play API.
 *
 * The content hash covers the manifest, every solve file, the preflop EV pack
 * and the version metadata, so changing any grading input requires a new
 * immutable pack id. `api/play.py` refuses to open a session whose catalog row
 * disagrees with the server artifact, which is what makes that a real
 * constraint rather than a convention.
 *
 *   npx tsx solver/gen-play-catalog.ts
 *
 * ## What changed at M8.7A
 *
 * This used to inline every reference-range frequency from
 * `lib/poker/ranges.ts` under a `preflop` key, because preflop was graded
 * against those ranges. It is now graded from solved EVs in `preflop.json`,
 * so the catalog carries a DESCRIPTOR of that file rather than a copy of its
 * contents, and the file's bytes are hashed directly.
 *
 * Hashing bytes rather than re-serialising numbers is deliberate. The metadata
 * digest is computed in JavaScript here and again in Python by
 * `api/play_solver.py`; thousands of floats round-tripped through two
 * languages' JSON writers is an invitation to a hash mismatch that looks like
 * a corrupt pack. The preflop EVs are integers for the same reason.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PACK_ID = "potluck:m87a:srp-btn-bb:v2";
const SOLUTION_PROFILE_ID = "cash-6max-chip-ev";
const SOLUTION_VERSION = "m87a-v1";
const GRADING_VERSION = "play-grade:v2";
const spotDir = resolve("solver/pack/srp-btn-bb");

const manifestPath = resolve(spotDir, "index.json");
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
  spot: string;
  flops: Array<{ flop: string; instances: number }>;
};

const preflopBytes = readFileSync(resolve(spotDir, "preflop.json"));
const preflop = JSON.parse(preflopBytes.toString("utf8")) as {
  kind: string;
  hand_index: string;
  ev_unit: string;
  provenance: { iteration: number; flops_averaged: number };
  precision: { median_se_mbb: number; p90_se_mbb: number; max_se_mbb: number };
  model: { excludes: string[] };
  roles: Record<string, { actions: { code: string }[]; hands: Record<string, unknown> }>;
};

if (preflop.kind !== "preflop-ev" || preflop.hand_index !== "class169") {
  throw new Error("preflop.json is not a class-indexed preflop EV pack");
}
for (const position of ["BTN", "BB"]) {
  const role = preflop.roles[position];
  if (!role) throw new Error(`preflop.json has no role ${position}`);
  if (Object.keys(role.hands).length !== 169) {
    throw new Error(`preflop.json role ${position} does not cover all 169 classes`);
  }
}

const canonicalMetadata = {
  id: PACK_ID,
  spot: manifest.spot,
  solution_profile_id: SOLUTION_PROFILE_ID,
  solution_version: SOLUTION_VERSION,
  format_version: 1,
  grading_version: GRADING_VERSION,
  preflop: {
    // A descriptor, not the data. The data lives in preflop.json and is
    // hashed below as bytes.
    source: "solver",
    file: "preflop.json",
    ev_unit: preflop.ev_unit,
    hand_index: preflop.hand_index,
    iteration: preflop.provenance.iteration,
    flops_averaged: preflop.provenance.flops_averaged,
    median_se_mbb: preflop.precision.median_se_mbb,
    positions: Object.fromEntries(
      Object.entries(preflop.roles).map(([position, role]) => [
        position,
        role.actions.map((a) => a.code),
      ])
    ),
    excludes: preflop.model.excludes,
  },
};

const contentHash = createHash("sha256");
contentHash.update(manifestBytes);
for (const entry of manifest.flops) {
  contentHash.update(readFileSync(resolve(spotDir, `${entry.flop}.json`)));
}
// Appended AFTER the solve files, matching the order `compute_pack_content_hash`
// feeds them in Python. Hash order is part of the format.
contentHash.update(preflopBytes);
contentHash.update(JSON.stringify(canonicalMetadata));

const catalog = {
  ...canonicalMetadata,
  content_hash: `sha256:${contentHash.digest("hex")}`,
};

writeFileSync(
  resolve(spotDir, "catalog.json"),
  `${JSON.stringify(catalog, null, 2)}\n`,
  "utf8"
);

console.log(`catalog -> ${PACK_ID}`);
console.log(`  ${catalog.content_hash}`);
