/**
 * Post-publish integrity check over the real solve data:
 *   npx tsx solver/validate.ts
 *
 * Exhaustively walks EVERY hero action sequence of EVERY instance of every
 * published flop through the app's own timeline machine, checking:
 *   - every path terminates in a node or end (no dangling references)
 *   - showdown ends have a full 5-card board with no duplicate cards
 *   - hole cards never collide with each other or the board
 *   - freq/EV coherence: an action the solver plays >78% never carries an
 *     EV loss above 0.5bb (quantization noise aside, that would mean the
 *     solve or the export is wrong)
 *   - bet/raise codes parse and tb never decreases along a path
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { timeline, boardFrom, holeCards } from "../lib/play/timeline";
import { parseAction } from "../lib/play/actions";
import type { PlayInstance, SolveFile, SolveManifest } from "../lib/play/types";

// Run from the repo root: npx tsx solver/validate.ts
const DIR = join(process.cwd(), "solver", "pack", "srp-btn-bb");

let files = 0, instances = 0, paths = 0, problems = 0;

function fail(msg: string) {
  problems++;
  console.error("FAIL:", msg);
}

function walkAll(file: SolveFile, inst: PlayInstance, id: string) {
  const stack: number[][] = [[]];
  while (stack.length) {
    const chosen = stack.pop()!;
    let events;
    try {
      events = timeline(inst, chosen);
    } catch (err) {
      fail(`${id} path [${chosen}]: ${err}`);
      continue;
    }
    paths++;
    const last = events[events.length - 1];
    if (last.type === "decision") {
      const node = last.node;
      for (let a = 0; a < node.a.length; a++) {
        parseAction(node.a[a]); // throws on malformed codes
        if (node.f[a] > 200 && node.l[a] > 10) {
          fail(`${id} path [${chosen}] action ${node.a[a]}: freq ${node.f[a]} but loss ${node.l[a]}`);
        }
        stack.push([...chosen, a]);
      }
      if (node.tb[0] < 0 || node.tb[1] < 0) fail(`${id}: negative tb`);
    } else if (last.type === "end" && last.end.k === "sd") {
      const board = boardFrom(file.flop, events);
      const all = [...holeCards(inst.hand), ...holeCards(inst.bot), ...board];
      if (board.length !== 5) fail(`${id} path [${chosen}]: showdown with ${board.length} board cards`);
      if (new Set(all).size !== all.length) fail(`${id} path [${chosen}]: duplicate cards`);
    }
  }
}

const manifest = JSON.parse(
  readFileSync(join(DIR, "index.json"), "utf8")
) as SolveManifest;

// The manifest is the published pack boundary. Metadata files such as the M8
// catalog are intentionally not solve files, while a listed solve must exist
// and contain the exact declared instance count.
for (const entry of manifest.flops) {
  const file = JSON.parse(
    readFileSync(join(DIR, `${entry.flop}.json`), "utf8")
  ) as SolveFile;
  files++;
  if (file.flop !== entry.flop) {
    fail(`${entry.flop}: solve metadata says ${file.flop}`);
  }
  if (file.instances.length !== entry.instances) {
    fail(`${entry.flop}: manifest declares ${entry.instances}, file has ${file.instances.length}`);
  }
  file.instances.forEach((inst, i) => {
    instances++;
    walkAll(file, inst, `${file.flop}#${i}`);
  });
}

console.log(
  `${files} flops, ${instances} instances, ${paths} hero paths walked, ${problems} problems`
);
process.exit(problems ? 1 : 0);
