/**
 * Preflop all-in equity, at the 169-class level.
 *
 *   npx tsx solver/preflop/equity.ts <out.json> [samples]
 *
 * The tree's `allin` terminals — a called 4-bet — never see a decision, so
 * their value IS equity. Nothing else in the pipeline provides it: the postflop
 * solver starts at the flop, so an all-in preflop pot is outside its world.
 *
 * WHY MONTE CARLO. Exact enumeration is C(48,5) = 1,712,304 boards per matchup
 * and there are 169x169 class pairs; at the measured 37k evals/sec of the
 * tested evaluator that is not happening. Sampling with a fixed seed gives a
 * reproducible table with a stated error instead of a perfect one we cannot
 * afford. At 2,000 samples the standard error on an equity is about 1.1 points.
 *
 * WHY NOT A FASTER EVALUATOR. `lib/poker/engine.ts` is the tested one, and
 * postflop-solver does not re-export its internal `Hand`. Writing a second
 * evaluator to make this faster would put two implementations of hand strength
 * in the project, which is the thing CLAUDE.md's rules exist to prevent. Slow
 * and shared beats fast and forked, especially for a table computed once.
 *
 * Each sample re-draws BOTH hole-card suit configurations as well as the board,
 * so the result averages over suit patterns properly rather than fixing one
 * representative combo — AhKh vs AsQs and AhKh vs AhQh are different matchups
 * and both belong in the average.
 */
import { writeFileSync } from "node:fs";

import { bestHand, type Card } from "../../lib/poker/engine";

const RANKS = "23456789TJQKA";

/** The 169 classes in a stable order: "AA", "AKs", "AKo", ... */
export function classes(): string[] {
  const out: string[] = [];
  for (let i = 12; i >= 0; i--) {
    for (let j = 12; j >= 0; j--) {
      if (i === j) out.push(RANKS[i] + RANKS[j]);
      else if (i > j) out.push(RANKS[i] + RANKS[j] + "s");
      else out.push(RANKS[j] + RANKS[i] + "o");
    }
  }
  return [...new Set(out)];
}

/** Every concrete two-card combo belonging to a class, as engine Card ids. */
export function combosOf(cls: string): [Card, Card][] {
  const r1 = RANKS.indexOf(cls[0]);
  const r2 = RANKS.indexOf(cls[1]);
  const out: [Card, Card][] = [];
  if (cls.length === 2) {
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) out.push([(r1 << 2) | a, (r1 << 2) | b]);
    }
  } else if (cls[2] === "s") {
    for (let s = 0; s < 4; s++) out.push([(r1 << 2) | s, (r2 << 2) | s]);
  } else {
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) if (a !== b) out.push([(r1 << 2) | a, (r2 << 2) | b]);
    }
  }
  return out;
}

/** Deterministic RNG — the table must be reproducible from the seed alone. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function equityOfPair(
  heroCls: string,
  villainCls: string,
  samples: number,
  seed: number,
): number | null {
  const heroCombos = combosOf(heroCls);
  const villainCombos = combosOf(villainCls);
  const rand = rng(seed);

  let won = 0;
  let counted = 0;
  const board: Card[] = [0, 0, 0, 0, 0];
  const heroSeven: Card[] = new Array(7);
  const villSeven: Card[] = new Array(7);

  for (let i = 0; i < samples; i++) {
    const h = heroCombos[(rand() * heroCombos.length) | 0];
    const v = villainCombos[(rand() * villainCombos.length) | 0];
    // Reject conflicting hole cards rather than fixing a representative combo;
    // some class pairs (AA vs AA) genuinely have fewer valid configurations.
    if (h[0] === v[0] || h[0] === v[1] || h[1] === v[0] || h[1] === v[1]) continue;

    const used = new Set<number>([h[0], h[1], v[0], v[1]]);
    for (let k = 0; k < 5; k++) {
      let c: number;
      do c = (rand() * 52) | 0;
      while (used.has(c));
      used.add(c);
      board[k] = c;
    }

    for (let k = 0; k < 5; k++) {
      heroSeven[k] = board[k];
      villSeven[k] = board[k];
    }
    heroSeven[5] = h[0]; heroSeven[6] = h[1];
    villSeven[5] = v[0]; villSeven[6] = v[1];

    const a = bestHand(heroSeven);
    const b = bestHand(villSeven);
    if (a > b) won += 1;
    else if (a === b) won += 0.5;
    counted += 1;
  }
  return counted > 0 ? won / counted : null;
}

if (process.argv[1]?.endsWith("equity.ts")) {
  const out = process.argv[2] ?? "solver/preflop/equity-169.json";
  const samples = Number(process.argv[3] ?? 2000);
  const cls = classes();
  const table: Record<string, Record<string, number>> = {};
  const t0 = Date.now();

  for (let i = 0; i < cls.length; i++) {
    table[cls[i]] = {};
    for (let j = 0; j < cls.length; j++) {
      // Seed from the pair so any single entry can be reproduced alone.
      const e = equityOfPair(cls[i], cls[j], samples, i * 1000 + j + 1);
      if (e !== null) table[cls[i]][cls[j]] = Math.round(e * 10000) / 10000;
    }
    if (i % 20 === 0) {
      const done = (i + 1) / cls.length;
      const elapsed = (Date.now() - t0) / 1000;
      process.stderr.write(
        `${cls[i]}  ${(100 * done).toFixed(0)}%  ` +
          `${elapsed.toFixed(0)}s elapsed, ~${(elapsed / done - elapsed).toFixed(0)}s left\n`,
      );
    }
  }
  writeFileSync(out, JSON.stringify({ samples, classes: cls, table }));
  process.stderr.write(`wrote ${out} (${cls.length}x${cls.length}, ${samples} samples)\n`);
}
