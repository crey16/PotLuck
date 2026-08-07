/**
 * Compact the push/fold pack into a form the drill can BUNDLE — M8.7E.
 *
 *   npx tsx solver/pushfold/compact.ts [--pack DIR] [--out FILE]
 *
 * ## Why a second form of the same data exists
 *
 * The drill contract (`lib/drill/contract.ts`) is synchronous: a generator is
 * `(ctx) => DrillQuestion`, and `DrillShell` computes the first question in a
 * `useState` initialiser so the server and the client produce an identical
 * one. There is no point in that flow where a fetch can happen without
 * breaking hydration, and no generator takes injected data.
 *
 * So the push/fold drill's data has to be in the bundle. The published pack is
 * 1.2 MB across 32 files — fine to fetch one table for a chart, impossible to
 * bundle. This strips it to exactly what a drill question needs.
 *
 * ## What survives, and what does not
 *
 * A drill question needs two things: which action is right, and what the wrong
 * one costs. Both come from ONE number per hand — the EV of acting minus the
 * EV of folding. Everything else in the pack (absolute EVs, fold EVs, the
 * frequency array, per-table provenance) is for the chart and the review, and
 * is dropped here.
 *
 * That number is quantized to signed bytes in 0.05bb steps, the same unit the
 * postflop pack's EV losses use, clamped to ±6.35bb. The clamp loses nothing:
 * a hand 6bb from indifference is a blunder at any resolution, and near the
 * threshold — where the resolution matters — the values are tiny.
 *
 * 20 strategies x 169 classes = 3,380 bytes per table, base64 to survive JSON.
 *
 * ## This file is generated. Do not edit its output.
 *
 * `lib/pushfold/table.test.ts` re-derives it from the committed pack and
 * fails if the two disagree, so the bundled copy cannot drift away from the
 * pack the chart reads. Two copies of the same numbers is a real risk and
 * that test is what makes it safe.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const packDir = resolve(flag("pack", "solver/pack/pushfold"));
const outPath = resolve(flag("out", "lib/pushfold/table.json"));

/** 0.05bb per step, matching lib/play/verdict.ts's EV_STEP_BB. */
export const EV_STEP_BB = 0.05;
const CLAMP = 127;

export function encodeEvs(evMbb: readonly number[]): string {
  const bytes = Buffer.alloc(evMbb.length);
  for (let i = 0; i < evMbb.length; i++) {
    const steps = Math.round(evMbb[i] / 1000 / EV_STEP_BB);
    bytes[i] = Math.max(-CLAMP, Math.min(CLAMP, steps)) & 0xff;
  }
  return bytes.toString("base64");
}

export function decodeEvs(encoded: string): Int8Array {
  return new Int8Array(Buffer.from(encoded, "base64"));
}

interface PackTable {
  stack_bb: number;
  ante_bb: number;
  shove: Record<string, { ev_mbb: number[] }>;
  call: Record<string, { ev_mbb: number[] }>;
}

function main(): void {
  const index = JSON.parse(readFileSync(join(packDir, "index.json"), "utf8")) as {
    classes: string[];
    model: Record<string, unknown>;
    provenance: Record<string, unknown>;
    tables: { stack_bb: number; ante_bb: number; file: string }[];
  };

  const files = new Set(readdirSync(packDir));
  const tables: Record<string, { shove: Record<string, string>; call: Record<string, string> }> = {};
  for (const entry of index.tables) {
    if (!files.has(entry.file)) throw new Error(`pack index names a missing file ${entry.file}`);
    const table = JSON.parse(readFileSync(join(packDir, entry.file), "utf8")) as PackTable;
    if (table.stack_bb !== entry.stack_bb || table.ante_bb !== entry.ante_bb) {
      throw new Error(`${entry.file} does not hold the table the index claims`);
    }
    tables[`${entry.stack_bb}:${entry.ante_bb}`] = {
      shove: Object.fromEntries(
        Object.entries(table.shove).map(([position, data]) => [position, encodeEvs(data.ev_mbb)])
      ),
      call: Object.fromEntries(
        Object.entries(table.call).map(([pair, data]) => [pair, encodeEvs(data.ev_mbb)])
      ),
    };
  }

  const compact = {
    kind: "pushfold-compact",
    format_version: 1,
    generated_from: "solver/pack/pushfold",
    hand_index: "class169",
    classes: index.classes,
    /** Signed bytes, 0.05bb per step, clamped at ±6.35bb. */
    ev_unit: "steps",
    ev_step_bb: EV_STEP_BB,
    ev_basis: "difference_vs_fold",
    provenance: index.provenance,
    model: index.model,
    tables,
  };

  const body = JSON.stringify(compact) + "\n";
  writeFileSync(outPath, body, "utf8");
  console.log(`pushfold compact -> ${outPath}`);
  console.log(
    `  ${Object.keys(tables).length} tables, ${(Buffer.byteLength(body) / 1024).toFixed(0)} KB bundled`,
  );
}

if (process.argv[1]?.endsWith("compact.ts")) main();
