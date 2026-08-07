/**
 * Extract the plain board list from a weighted flop set.
 *
 *   npx tsx solver/flops/list.ts solver/flops/set-100.json > solver/flops/set-100.txt
 *
 * The shell runners take a newline-delimited list because solving one board
 * has nothing to do with how much that board counts — the weights are an
 * ANALYSIS input, applied by `loadEvTable` when the EVs are averaged. Keeping
 * them out of the runner is what lets a set be re-weighted without re-solving
 * anything.
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx solver/flops/list.ts <set.json>");
  process.exit(2);
}
const set = JSON.parse(readFileSync(path, "utf8")) as { flops: { flop: string }[] };
console.log(set.flops.map((f) => f.flop).join("\n"));
