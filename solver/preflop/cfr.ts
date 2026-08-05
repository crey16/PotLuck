/**
 * CFR over the pruned 6-max preflop tree.
 *
 * Vanilla counterfactual regret minimisation with regret matching, working on
 * 169-class range vectors rather than 1,326 combos. Classes carry their combo
 * counts as a prior, so AKo (12 combos) weighs three times AKs (4) exactly as
 * it should — the reduction is in the strategy resolution, not the arithmetic.
 *
 * WHY BEST RESPONSE IS NOT ENOUGH HERE. `preflop-br.ts` thresholds a two-action
 * tree, which is right when a player's decision cannot change what anyone else
 * does. Once 3-bets and 4-bets exist, BB's 3-betting frequency and BTN's
 * 4-betting frequency are each best responses to the other, so the fixed point
 * has to be found rather than computed in one pass. That is what this is for.
 *
 * THE APPROXIMATION, STATED. Counterfactual reach for a player treats the other
 * players' ranges as independent — cross-player card removal is ignored, so
 * holding an ace does not shrink the chance an opponent holds one. Every
 * practical multiplayer preflop solver does this; tracking the joint
 * distribution over six players' hole cards is not tractable. The place it
 * bites hardest is blocker-sensitive 4-bet bluffing, so treat those frequencies
 * as the least trustworthy output.
 *
 * AND THE LARGER ONE. Six-player CFR is not two-player zero-sum, so there is no
 * guarantee of converging to a Nash equilibrium and no exploitability bound —
 * only that regrets stop growing. This is the same caveat that applies to every
 * multiway preflop solution on the market, including the one this product uses
 * as its reference. It is a caveat, not a defect, but it must not be described
 * as "the" equilibrium.
 */
import {
  buildTree,
  POS,
  type DecisionNode,
  type Pos,
  type Terminal,
  type Tree,
} from "./tree";
import { classes, combosOf } from "./equity";

export const CLASSES = classes();
export const N_CLASSES = CLASSES.length;
export const CLASS_INDEX = new Map(CLASSES.map((c, i) => [c, i]));

/** Combos per class, normalised — the prior probability of being dealt it. */
export const PRIOR = (() => {
  const counts = CLASSES.map((c) => combosOf(c).length);
  const total = counts.reduce((a, b) => a + b, 0);
  return Float64Array.from(counts, (n) => n / total);
})();

/**
 * Supplies the value of a terminal to a player holding a given class.
 *
 * Returned in chips, net of what that player put in. Kept pluggable so the
 * engine can be tested against payoffs whose answer is known by hand, before
 * the 60-subgame batch has produced any real EVs.
 */
export interface TerminalValuer {
  /**
   * @param oppRange normalised range of the other live player, when the
   *        terminal's value depends on both hands (an all-in). Undefined
   *        otherwise.
   */
  (t: Terminal, player: Pos, classIdx: number, oppRange?: Float64Array): number;
}

export interface CfrOptions {
  iterations: number;
  valuer: TerminalValuer;
  /** Discount early iterations (CFR+ style). Off by default for determinism. */
  averageFrom?: number;
}

export interface CfrResult {
  tree: Tree;
  /** Average strategy per decision node: [classIdx * nActions + actionIdx]. */
  average: Map<number, Float64Array>;
  /** Expected value per player per class, under the average strategy. */
  iterations: number;
}

function regretMatch(regret: Float64Array, nActions: number, out: Float64Array): void {
  for (let c = 0; c < N_CLASSES; c++) {
    const base = c * nActions;
    let sum = 0;
    for (let a = 0; a < nActions; a++) {
      const r = regret[base + a];
      sum += r > 0 ? r : 0;
    }
    if (sum > 0) {
      for (let a = 0; a < nActions; a++) {
        const r = regret[base + a];
        out[base + a] = (r > 0 ? r : 0) / sum;
      }
    } else {
      for (let a = 0; a < nActions; a++) out[base + a] = 1 / nActions;
    }
  }
}

export function solve(opts: CfrOptions): CfrResult {
  const tree = buildTree();
  const nodes = tree.nodes;

  const regretSum = new Map<number, Float64Array>();
  const strategySum = new Map<number, Float64Array>();
  const strategy = new Map<number, Float64Array>();
  for (const n of nodes) {
    if (n.kind !== "decision") continue;
    const size = N_CLASSES * n.actions.length;
    regretSum.set(n.id, new Float64Array(size));
    strategySum.set(n.id, new Float64Array(size));
    strategy.set(n.id, new Float64Array(size));
  }

  const playerIdx = new Map<Pos, number>(POS.map((p, i) => [p, i]));

  /**
   * Reach probabilities. `reach[q]` is q's probability of playing each class
   * to this node; `scalarReach[q]` collapses it against the prior, which is
   * the independence approximation described at the top of the file.
   */
  function traverse(
    nodeId: number,
    reach: Float64Array[],
    weight: number,
  ): Float64Array[] {
    const node = nodes[nodeId];

    if (node.kind === "terminal") {
      const t = node.terminal;
      const out = POS.map(() => new Float64Array(N_CLASSES));

      // An all-in's value depends on both hands, so the opponent's normalised
      // range has to be passed down.
      const normalised = new Map<Pos, Float64Array>();
      if (t.kind === "allin") {
        for (const p of t.live) {
          const r = reach[playerIdx.get(p)!];
          const v = new Float64Array(N_CLASSES);
          let s = 0;
          for (let c = 0; c < N_CLASSES; c++) {
            v[c] = r[c] * PRIOR[c];
            s += v[c];
          }
          if (s > 0) for (let c = 0; c < N_CLASSES; c++) v[c] /= s;
          normalised.set(p, v);
        }
      }

      for (const p of POS) {
        const pi = playerIdx.get(p)!;
        const opp = t.live.find((x) => x !== p);
        const oppRange = t.kind === "allin" && opp ? normalised.get(opp) : undefined;
        for (let c = 0; c < N_CLASSES; c++) {
          out[pi][c] = opts.valuer(t, p, c, oppRange);
        }
      }
      return out;
    }

    const dn = node as DecisionNode;
    const nActions = dn.actions.length;
    const actor = playerIdx.get(dn.actor)!;
    const reg = regretSum.get(dn.id)!;
    const sigma = strategy.get(dn.id)!;
    regretMatch(reg, nActions, sigma);

    // Counterfactual reach: everyone except the actor.
    let cfReach = 1;
    for (let q = 0; q < POS.length; q++) {
      if (q === actor) continue;
      let s = 0;
      for (let c = 0; c < N_CLASSES; c++) s += reach[q][c] * PRIOR[c];
      cfReach *= s;
    }

    const childValues: Float64Array[][] = [];
    for (let a = 0; a < nActions; a++) {
      const next = reach.map((r) => r);
      const mine = new Float64Array(N_CLASSES);
      for (let c = 0; c < N_CLASSES; c++) mine[c] = reach[actor][c] * sigma[c * nActions + a];
      next[actor] = mine;
      childValues.push(traverse(dn.children[dn.actions[a]], next, weight));
    }

    // The actor's action probabilities MARGINALISED over their own range —
    // what everyone else effectively faces, since they cannot see the actor's
    // cards.
    //
    // This distinction is load-bearing. Weighting an opponent's value by
    // `sigma[c]` where `c` indexes the OPPONENT's hand asks "how often does
    // the actor raise, given the opponent holds AA" — which is not a question
    // the actor's strategy answers. The bug is invisible whenever terminal
    // values do not depend on the hand (every class then has the same value,
    // so any weighting agrees) and corrupts everything the moment they do.
    const marginal = new Float64Array(nActions);
    {
      let total = 0;
      for (let c = 0; c < N_CLASSES; c++) {
        const w = reach[actor][c] * PRIOR[c];
        total += w;
        for (let a = 0; a < nActions; a++) marginal[a] += w * sigma[c * nActions + a];
      }
      if (total > 0) for (let a = 0; a < nActions; a++) marginal[a] /= total;
      else for (let a = 0; a < nActions; a++) marginal[a] = 1 / nActions;
    }

    const out = POS.map(() => new Float64Array(N_CLASSES));
    for (let q = 0; q < POS.length; q++) {
      const isActor = q === actor;
      for (let c = 0; c < N_CLASSES; c++) {
        let v = 0;
        for (let a = 0; a < nActions; a++) {
          // The actor knows its own hand, so it weights by its per-class
          // strategy. Everyone else weights by the marginal.
          const w = isActor ? sigma[c * nActions + a] : marginal[a];
          v += w * childValues[a][q][c];
        }
        out[q][c] = v;
      }
    }

    // Regret and average-strategy accumulation, for the actor only.
    const stratSum = strategySum.get(dn.id)!;
    for (let c = 0; c < N_CLASSES; c++) {
      const base = c * nActions;
      const nodeValue = out[actor][c];
      for (let a = 0; a < nActions; a++) {
        reg[base + a] += cfReach * (childValues[a][actor][c] - nodeValue);
        stratSum[base + a] += weight * reach[actor][c] * sigma[base + a];
      }
    }

    return out;
  }

  const ones = () => Float64Array.from({ length: N_CLASSES }, () => 1);
  for (let i = 0; i < opts.iterations; i++) {
    const w = opts.averageFrom !== undefined && i < opts.averageFrom ? 0 : 1;
    traverse(tree.root, POS.map(ones), w);
  }

  const average = new Map<number, Float64Array>();
  for (const n of nodes) {
    if (n.kind !== "decision") continue;
    const nActions = n.actions.length;
    const sum = strategySum.get(n.id)!;
    const avg = new Float64Array(sum.length);
    for (let c = 0; c < N_CLASSES; c++) {
      const base = c * nActions;
      let total = 0;
      for (let a = 0; a < nActions; a++) total += sum[base + a];
      for (let a = 0; a < nActions; a++) {
        avg[base + a] = total > 0 ? sum[base + a] / total : 1 / nActions;
      }
    }
    average.set(n.id, avg);
  }

  return { tree, average, iterations: opts.iterations };
}

/** The frequency of each action for one class at one node, as a 0..1 map. */
export function actionFrequencies(
  result: CfrResult,
  nodeId: number,
  handClass: string,
): Record<string, number> {
  const node = result.tree.nodes[nodeId];
  if (node.kind !== "decision") throw new Error(`node ${nodeId} is terminal`);
  const c = CLASS_INDEX.get(handClass);
  if (c === undefined) throw new Error(`unknown class ${handClass}`);
  const avg = result.average.get(nodeId)!;
  const n = node.actions.length;
  const out: Record<string, number> = {};
  node.actions.forEach((a, i) => {
    out[a] = avg[c * n + i];
  });
  return out;
}
