/**
 * Publish the small, versioned metadata catalog consumed by the M8 play API.
 *
 * Preflop action frequencies are generated from lib/poker/ranges.ts rather
 * than copied into Python. The content hash covers the manifest, every solve
 * file, version metadata, and generated preflop frequencies, so changing any
 * grading input requires a new immutable pack id.
 *
 *   npx tsx solver/gen-play-catalog.ts
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  cellFrequency,
  getScenario,
  handAt,
  type Action,
} from "../lib/poker/ranges";

const PACK_ID = "potluck:m6:srp-btn-bb:v1";
const SOLUTION_PROFILE_ID = "cash-6max-chip-ev";
const SOLUTION_VERSION = "m6-v1";
const GRADING_VERSION = "play-grade:v1";
const spotDir = resolve("public/solves/srp-btn-bb");
const manifestPath = resolve(spotDir, "index.json");
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
  spot: string;
  flops: Array<{ flop: string; instances: number }>;
};

function preflopScenario(scenarioId: "btn" | "bb-btn") {
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`missing range scenario ${scenarioId}`);

  const hands: Record<string, Record<Action, number>> = {};
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const hand = handAt(row, col);
      const frequencies = cellFrequency(scenario, hand);
      hands[hand] = Object.fromEntries(
        scenario.actions.map(([code]) => [code, frequencies[code]])
      ) as Record<Action, number>;
    }
  }

  return {
    scenario_id: scenario.id,
    actions: scenario.actions.map(([code, label]) => ({ code, label })),
    hands,
  };
}

const canonicalMetadata = {
  id: PACK_ID,
  spot: manifest.spot,
  solution_profile_id: SOLUTION_PROFILE_ID,
  solution_version: SOLUTION_VERSION,
  format_version: 1,
  grading_version: GRADING_VERSION,
  preflop: {
    BTN: preflopScenario("btn"),
    BB: preflopScenario("bb-btn"),
  },
};

const contentHash = createHash("sha256");
contentHash.update(manifestBytes);
for (const entry of manifest.flops) {
  contentHash.update(readFileSync(resolve(spotDir, `${entry.flop}.json`)));
}
// This metadata contains every reference-range frequency used for preflop
// grades as well as the grading/profile versions that interpret all rows.
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
