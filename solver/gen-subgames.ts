/**
 * Generate the postflop subgame configurations for the full 6-max preflop tree.
 *
 *   npx tsx solver/gen-subgames.ts <out-dir>
 *
 * The pruned tree (no overcalls — see docs/14-m87a-solver-scope.md) reaches a
 * flop heads-up in 1,257 terminal states, but a postflop subgame depends only
 * on WHICH TWO POSITIONS are in and AT WHICH RAISE LEVEL — not on the order the
 * other four folded. That collapses to 35 distinct solves.
 *
 * Only levels 1 and 2 produce subgames. Level 3 is the 4-bet, which is all-in
 * by the settled tree, so a called 4-bet never sees a postflop decision — it is
 * an all-in equity terminal instead.
 *
 * SIZINGS (one per level, per the settled tree):
 *   open  2.5bb
 *   3-bet 3x the open in position, 4x out of position — standard, and the
 *         asymmetry is real poker rather than a complication: 3-betting out of
 *         position needs a bigger size to deny equity and realise less of it.
 *   4-bet all-in (no postflop, so not generated here)
 *
 * POT = the two players' contributions + the blinds of everyone who folded.
 * STACK = 100bb minus what that player put in preflop.
 * Chips are tenths of a big blind, matching the existing srp-btn-bb pack.
 *
 * Ranges are 100% for iteration 1. That is deliberate and temporary: it is the
 * only way every hand gets an EV, which is what the preflop solve needs in
 * order to decide a hand belongs in a range at all. The EVs are consequently
 * conditional on a 100% opponent and over-state marginal hands, so the ranges
 * converge FROM ABOVE and iteration is mandatory. See §"BLOCKER" in the scope.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const POS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;
type Pos = (typeof POS)[number];

const POSTED: Record<Pos, number> = { UTG: 0, HJ: 0, CO: 0, BTN: 0, SB: 0.5, BB: 1 };
const START_STACK = 100;
const OPEN = 2.5;

const RANKS = "AKQJT98765432";
const FULL_RANGE = ["22+", ...RANKS.slice(0, -1).split("").map((r) => `${r}2+`)].join(",");

/** In a heads-up pot the later position acts last postflop — except vs blinds. */
function isInPosition(a: Pos, b: Pos): boolean {
  return POS.indexOf(a) > POS.indexOf(b);
}

function threeBetSize(aggressor: Pos, opener: Pos): number {
  return isInPosition(aggressor, opener) ? OPEN * 3 : OPEN * 4;
}

interface Subgame {
  spot: string;
  level: number;
  oopPos: Pos;
  ipPos: Pos;
  oop: string;
  ip: string;
  pot: number;
  stack: number;
}

const out: Subgame[] = [];

for (let i = 0; i < POS.length; i++) {
  for (let j = 0; j < POS.length; j++) {
    if (i === j) continue;
    const aggressor = POS[i];
    const caller = POS[j];

    for (const level of [1, 2] as const) {
      // Level 1: aggressor opens, caller calls the open.
      // Level 2: caller opened, aggressor 3-bet, caller called the 3-bet.
      const bet = level === 1 ? OPEN : threeBetSize(aggressor, caller);

      // The aggressor must act before the caller at level 1 (you cannot call a
      // bet that has not happened), and after them at level 2 (you cannot
      // 3-bet before someone opens).
      if (level === 1 && !(i < j)) continue;
      if (level === 2 && !(i > j)) continue;

      const inPot = new Set<Pos>([aggressor, caller]);
      const dead = POS.filter((p) => !inPot.has(p)).reduce((s, p) => s + POSTED[p], 0);

      const potBb = bet * 2 + dead;
      const stackBb = START_STACK - bet;

      const ipPos = isInPosition(aggressor, caller) ? aggressor : caller;
      const oopPos = ipPos === aggressor ? caller : aggressor;

      out.push({
        spot: `L${level}-${aggressor}-${caller}`.toLowerCase(),
        level,
        oopPos,
        ipPos,
        oop: FULL_RANGE,
        ip: FULL_RANGE,
        pot: Math.round(potBb * 10),
        stack: Math.round(stackBb * 10),
      });
    }
  }
}

const dir = process.argv[2] ?? "subgames";
mkdirSync(dir, { recursive: true });
for (const sg of out) {
  writeFileSync(join(dir, `${sg.spot}.json`), JSON.stringify(sg, null, 2) + "\n");
}

console.log(`${out.length} subgames -> ${dir}/`);
const byLevel = out.reduce<Record<number, number>>((a, s) => {
  a[s.level] = (a[s.level] ?? 0) + 1;
  return a;
}, {});
for (const [lvl, n] of Object.entries(byLevel)) console.log(`  level ${lvl}: ${n}`);
console.log("\nsample:");
for (const sg of out.slice(0, 4)) {
  console.log(
    `  ${sg.spot.padEnd(16)} ${sg.oopPos} (OOP) vs ${sg.ipPos} (IP)  ` +
      `pot ${sg.pot} (${sg.pot / 10}bb)  stack ${sg.stack} (${sg.stack / 10}bb)`,
  );
}
