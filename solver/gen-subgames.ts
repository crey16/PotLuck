/**
 * Generate the postflop subgame configurations, DRIVEN BY THE TREE.
 *
 *   npx tsx solver/gen-subgames.ts <out-dir>
 *
 * This used to re-derive the subgame list with its own loop over position
 * pairs, and it was wrong: it assumed the caller at level 2 is always the
 * original opener, so it missed every line where a third player cold-calls a
 * 3-bet and the opener folds — a perfectly ordinary heads-up pot. Ten of forty
 * subgames were absent, and the batch would have solved a set the solver never
 * actually reaches.
 *
 * Now the tree is the single source of truth. Every configuration comes from a
 * terminal the tree really produces, and pot and effective stack are read from
 * that terminal's own contribution table rather than recomputed here. Two
 * independent derivations of the same arithmetic is exactly the pattern
 * CLAUDE.md warns about.
 *
 * Ranges are 100% for iteration 1. That is deliberate and temporary: it is the
 * only way every hand gets an EV, and a hand with no EV cannot be evaluated for
 * inclusion in a range at all. The EVs are consequently conditional on a 100%
 * opponent and over-state marginal hands, so ranges converge FROM ABOVE and
 * iteration is mandatory. See docs/14-m87a-solver-scope.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildTree, POS, START_STACK, type Pos } from "./preflop/tree";

const RANKS = "AKQJT98765432";
const FULL_RANGE = ["22+", ...RANKS.slice(0, -1).split("").map((r) => `${r}2+`)].join(",");

const tree = buildTree();

interface Config {
  spot: string;
  level: number;
  oopPos: Pos;
  ipPos: Pos;
  oop: string;
  ip: string;
  pot: number;
  stack: number;
}

const configs = new Map<string, Config>();

for (const node of tree.nodes) {
  if (node.kind !== "terminal") continue;
  const t = node.terminal;
  if (t.kind !== "postflop" || !t.subgame) continue;

  const pot = POS.reduce((s, p) => s + t.contrib[p], 0);
  const [a, b] = t.live;
  // Both live players have matched the same amount — that is what "called"
  // means. If this ever fails the contribution bookkeeping is broken, and the
  // effective stack below would be meaningless.
  if (t.contrib[a] !== t.contrib[b]) {
    throw new Error(
      `${t.subgame}: live players contributed ${t.contrib[a]} and ${t.contrib[b]}`,
    );
  }
  const stack = START_STACK - t.contrib[a];

  const existing = configs.get(t.subgame);
  if (existing && (existing.pot !== pot || existing.stack !== stack)) {
    // The same named subgame reached with different money in it would mean the
    // name is not specific enough to identify the solve.
    throw new Error(
      `${t.subgame} reached with pot ${pot}/${stack} and ${existing.pot}/${existing.stack}`,
    );
  }

  configs.set(t.subgame, {
    spot: t.subgame,
    level: Number(t.subgame[1]),
    oopPos: t.oop!,
    ipPos: t.ip!,
    oop: FULL_RANGE,
    ip: FULL_RANGE,
    pot,
    stack,
  });
}

const dir = process.argv[2] ?? "subgames";
mkdirSync(dir, { recursive: true });
for (const cfg of configs.values()) {
  writeFileSync(join(dir, `${cfg.spot}.json`), JSON.stringify(cfg, null, 2) + "\n");
}

console.log(`${configs.size} subgames -> ${dir}/`);
const byLevel: Record<number, number> = {};
for (const c of configs.values()) byLevel[c.level] = (byLevel[c.level] ?? 0) + 1;
for (const [lvl, n] of Object.entries(byLevel)) console.log(`  level ${lvl}: ${n}`);
console.log("\nsample:");
for (const c of [...configs.values()].slice(0, 5)) {
  console.log(
    `  ${c.spot.padEnd(14)} ${c.oopPos} (OOP) vs ${c.ipPos} (IP)  ` +
      `pot ${c.pot} (${c.pot / 10}bb)  stack ${c.stack} (${c.stack / 10}bb)`,
  );
}
