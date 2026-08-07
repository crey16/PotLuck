/**
 * How often each postflop subgame is actually reached — C5 of the accuracy
 * programme.
 *
 *   npx tsx solver/reach.ts [--iterations 400] [--flops 100]
 *
 * ## Why this decides where the compute goes
 *
 * The pruned 6-max tree has 60 postflop subgames and 45 of them are 3-bet
 * pots. They are not equally important: a subgame reached one hand in a
 * thousand contributes a thousandth as much to any preflop EV as one reached
 * one hand in twenty, but under a flat allocation it costs exactly as much to
 * solve. Solving every subgame at the same flop resolution spends most of the
 * budget on branches that barely move the answer.
 *
 * Allocating flops proportional to reach — Neyman allocation, the standard
 * result for stratified sampling under a cost constraint — concentrates the
 * compute where it changes the preflop solution.
 *
 * ## What this is NOT
 *
 * The valuer below prices a postflop pot as if it were an all-in, because the
 * real postflop EVs are the very thing the batch is meant to produce. That is
 * a genuinely poor model of a 100bb postflop pot — `docs/14-m87a-solver-scope.md`
 * rejects all-in equity as a substitute for solving, and rightly.
 *
 * It is fine HERE, and only here, because the output is not a strategy anyone
 * plays or a number anyone is graded against. It is an estimate of which
 * branches see traffic, used to decide how much compute each one gets. An
 * allocation that is 20% off costs a little efficiency; it cannot make a
 * published range wrong. Nothing from this file may ever reach the pack.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CLASS_INDEX,
  CLASSES,
  N_CLASSES,
  PRIOR,
  solve,
  type CfrResult,
  type TerminalValuer,
} from "./preflop/cfr";
import { POS, type Pos, type Terminal } from "./preflop/tree";

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

// ---- equity, for the bootstrap valuer --------------------------------------
const equityRaw = JSON.parse(
  readFileSync(resolve("solver/preflop/equity-169.json"), "utf8")
) as { classes: string[]; table: Record<string, Record<string, number>> };
const EQUITY = new Float64Array(N_CLASSES * N_CLASSES);
for (let h = 0; h < N_CLASSES; h++) {
  const row = equityRaw.table[CLASSES[h]];
  for (let v = 0; v < N_CLASSES; v++) EQUITY[h * N_CLASSES + v] = row[CLASSES[v]];
}

const potOf = (t: Terminal): number => POS.reduce((sum, p) => sum + t.contrib[p], 0);

/**
 * Each class's all-in equity against a uniformly random hand.
 *
 * The CFR supplies an opponent range only for ALL-IN terminals, because a
 * postflop terminal is meant to be valued from that subgame's exported
 * per-class EVs — which is exactly what the batch has not produced yet. So
 * postflop pots are priced here at equity against the whole field.
 *
 * That is a worse approximation than the all-in case in two ways: the pot is
 * not actually all-in, and the opponent's range is not random. Both push the
 * same direction (marginal hands look better than they are), so the resulting
 * strategy is somewhat too loose. For deciding which branches see traffic
 * that is tolerable; for anything published it would not be.
 */
const EQUITY_VS_FIELD = (() => {
  const out = new Float64Array(N_CLASSES);
  for (let h = 0; h < N_CLASSES; h++) {
    let sum = 0;
    for (let v = 0; v < N_CLASSES; v++) sum += PRIOR[v] * EQUITY[h * N_CLASSES + v];
    out[h] = sum;
  }
  return out;
})();

/**
 * Bootstrap terminal values.
 *
 * Uncontested pots are exact — the last player standing takes what is in the
 * middle. Contested pots are priced at all-in equity, which is exact for a
 * called 4-bet and a stand-in for everything else. See the header for why a
 * stand-in is acceptable for this one purpose.
 */
const valuer: TerminalValuer = (t, player, classIdx, oppRange) => {
  const pot = potOf(t);
  const mine = -t.contrib[player];
  if (t.live.length === 1) {
    return mine + (t.live[0] === player ? pot : 0);
  }
  if (!oppRange) {
    // A postflop terminal. The CFR supplies no opponent range for these
    // because they are meant to carry the batch's exported EVs; until those
    // exist, equity against the field is the stand-in. See EQUITY_VS_FIELD.
    return mine + EQUITY_VS_FIELD[classIdx] * pot;
  }
  let equity = 0;
  let total = 0;
  for (let v = 0; v < N_CLASSES; v++) {
    const w = oppRange[v] * PRIOR[v];
    if (w <= 0) continue;
    total += w;
    equity += w * EQUITY[classIdx * N_CLASSES + v];
  }
  return mine + (total > 0 ? equity / total : 0.5) * pot;
};

export interface SubgameReach {
  subgame: string;
  /** Probability a random hand ends in this subgame. */
  probability: number;
  level: number;
  oop: Pos;
  ip: Pos;
}

/**
 * Probability of reaching each postflop subgame under the solved strategy.
 *
 * Reach factorises across players because the CFR already treats their ranges
 * as independent (its stated approximation — cross-player card removal is
 * ignored). So each player carries a per-class reach vector down the tree, and
 * a terminal's probability is the product of each player's total.
 */
export function subgameReach(result: CfrResult): SubgameReach[] {
  const { tree } = result;
  const playerIdx = new Map(POS.map((p, i) => [p, i]));
  const totals = new Map<string, number>();
  const meta = new Map<string, { level: number; oop: Pos; ip: Pos }>();

  const walk = (nodeId: number, reach: Float64Array[]): void => {
    const node = tree.nodes[nodeId];
    if (node.kind === "terminal") {
      const t = node.terminal;
      if (t.kind !== "postflop" || !t.subgame) return;
      // Each player's marginal probability of having played this far.
      let probability = 1;
      for (let q = 0; q < reach.length; q++) {
        let sum = 0;
        for (let c = 0; c < N_CLASSES; c++) sum += reach[q][c] * PRIOR[c];
        probability *= sum;
      }
      totals.set(t.subgame, (totals.get(t.subgame) ?? 0) + probability);
      if (!meta.has(t.subgame)) {
        meta.set(t.subgame, { level: Number(t.subgame[1]), oop: t.oop!, ip: t.ip! });
      }
      return;
    }
    const actor = playerIdx.get(node.actor)!;
    const sigma = result.average.get(nodeId)!;
    const n = node.actions.length;
    node.actions.forEach((action, a) => {
      const next = reach.slice();
      const mine = new Float64Array(N_CLASSES);
      for (let c = 0; c < N_CLASSES; c++) mine[c] = reach[actor][c] * sigma[c * n + a];
      next[actor] = mine;
      walk(node.children[action], next);
    });
  };

  walk(
    tree.root,
    POS.map(() => Float64Array.from({ length: N_CLASSES }, () => 1))
  );

  return [...totals]
    .map(([subgame, probability]) => ({ subgame, probability, ...meta.get(subgame)! }))
    .sort((a, b) => b.probability - a.probability);
}

/**
 * Flops per subgame — DAMPED, proportional to reach^exponent.
 *
 * Minimising the variance of a weighted total would put flops in proportion
 * to reach exactly (exponent 1). That is the right answer when the weights
 * are known. Here they are not: they come from the bootstrap valuer above,
 * and it is measurably too loose.
 *
 * Measured 2026-08-07. The bootstrap puts **50% of all postflop traffic in
 * one subgame** (SB versus BB, single-raised) and would hand it 1,572 of a
 * 3,000-solve budget against a flat 50. A structural check says that cannot
 * be right: SB-BB is reached when four players fold, the SB opens and the BB
 * calls, which under realistic 6-max frequencies makes it about 1.2x
 * BTN-versus-BB — and even under deliberately loose assumptions only 2x. The
 * bootstrap over-rewards calling, so blind battles balloon.
 *
 * A square-root exponent turns a 30x reach ratio into a 5.5x allocation
 * ratio: it still sends materially more compute to the branches that carry
 * traffic, and it cannot starve 59 subgames on the strength of an estimate
 * we know is wrong. **Re-run this with real EVs once the batch has produced
 * them and the damping can be relaxed** — at that point the weights are
 * measured rather than guessed and exponent 1 is defensible.
 *
 * Every subgame also keeps a floor, for the same reason every flop stratum
 * does: a subgame solved on too few boards has an error nobody can estimate,
 * and one solved on none has no EV at all — which the preflop step cannot
 * price around, it simply fails.
 */
export function allocateFlops(
  reach: readonly SubgameReach[],
  totalBudget: number,
  floor = 12,
  exponent = 0.5
): Map<string, number> {
  const out = new Map<string, number>();
  const damped = reach.map((r) => Math.pow(Math.max(r.probability, 0), exponent));
  const totalDamped = damped.reduce((a, b) => a + b, 0);
  const discretionary = totalBudget - floor * reach.length;
  if (discretionary < 0) {
    throw new Error(
      `budget of ${totalBudget} cannot give ${reach.length} subgames a floor of ${floor}`
    );
  }
  // Largest-remainder, so the allocation sums to the budget EXACTLY. Rounding
  // each share independently drifts by a few solves, which is harmless until
  // a caller uses the total to size a machine rental.
  const exact = reach.map((_, i) =>
    discretionary * (totalDamped > 0 ? damped[i] / totalDamped : 1 / reach.length)
  );
  let assigned = 0;
  reach.forEach((r, i) => {
    const n = Math.floor(exact[i]);
    out.set(r.subgame, floor + n);
    assigned += n;
  });
  const order = reach
    .map((r, i) => ({ subgame: r.subgame, frac: exact[i] - Math.floor(exact[i]) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; assigned < discretionary; i++, assigned++) {
    const key = order[i % order.length].subgame;
    out.set(key, out.get(key)! + 1);
  }
  return out;
}

function main(): void {
  const iterations = Number(flag("iterations", "400"));
  const budget = Number(flag("flops", "0"));

  process.stderr.write(`solving the preflop tree, ${iterations} CFR iterations...\n`);
  const result = solve({ iterations, valuer });
  const reach = subgameReach(result);

  const contested = reach.reduce((sum, r) => sum + r.probability, 0);
  console.log(`\n${reach.length} postflop subgames, ${(100 * contested).toFixed(1)}% of hands reach one\n`);
  console.log("  subgame                        reach     share of postflop");
  let cumulative = 0;
  for (const r of reach) {
    cumulative += r.probability / contested;
    console.log(
      `  ${r.subgame.padEnd(28)} ${(100 * r.probability).toFixed(3).padStart(7)}%  ` +
        `${(100 * r.probability / contested).toFixed(1).padStart(5)}%   (cum ${(100 * cumulative).toFixed(0)}%)`
    );
  }

  // The headline: how concentrated is the traffic?
  const sorted = reach.map((r) => r.probability / contested);
  let half = 0;
  let nHalf = 0;
  for (const p of sorted) {
    half += p;
    nHalf++;
    if (half >= 0.5) break;
  }
  console.log(
    `\n  ${nHalf} of ${reach.length} subgames carry half the postflop traffic.`
  );
  const byLevel = new Map<number, number>();
  for (const r of reach) byLevel.set(r.level, (byLevel.get(r.level) ?? 0) + r.probability);
  for (const [level, p] of [...byLevel].sort()) {
    console.log(
      `  level ${level}: ${(100 * p / contested).toFixed(1)}% of postflop traffic across ` +
        `${reach.filter((r) => r.level === level).length} subgames`
    );
  }

  if (budget > 0) {
    const allocation = allocateFlops(reach, budget);
    const undamped = allocateFlops(reach, budget, 12, 1);
    const flat = Math.floor(budget / reach.length);
    console.log(
      `\n  flop allocation for a ${budget}-solve budget (floor 12, sqrt-damped):`
    );
    console.log(
      "  DAMPED because the bootstrap valuer is too loose to trust with a 30x swing —\n" +
        "  see allocateFlops. Re-run with real EVs to relax it."
    );
    for (const r of reach.slice(0, 8)) {
      console.log(
        `    ${r.subgame.padEnd(28)} ${String(allocation.get(r.subgame)).padStart(4)}` +
          `  (flat ${flat}, undamped ${undamped.get(r.subgame)})`
      );
    }
    console.log(`    ... ${reach.length - 8} more`);
    const total = [...allocation.values()].reduce((a, b) => a + b, 0);
    console.log(`    total ${total} solves`);
  }
}

if (process.argv[1]?.endsWith("reach.ts")) main();
