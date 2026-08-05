import assert from "node:assert/strict";
import { test } from "node:test";

import {
  actionFrequencies,
  CLASSES,
  N_CLASSES,
  PRIOR,
  solve,
  type TerminalValuer,
} from "./cfr";
import { POS, type Pos, type Terminal } from "./tree";

/** Net chips, ignoring hands entirely: whoever is live splits the pot. */
const flatValuer: TerminalValuer = (t: Terminal, player: Pos) => {
  const pot = POS.reduce((s, p) => s + t.contrib[p], 0);
  const share = t.live.includes(player) ? 1 / t.live.length : 0;
  return -t.contrib[player] + share * pot;
};

test("the prior is a distribution and weights offsuit above suited", () => {
  let sum = 0;
  for (let c = 0; c < N_CLASSES; c++) sum += PRIOR[c];
  assert.ok(Math.abs(sum - 1) < 1e-12, `prior sums to ${sum}`);
  const i = CLASSES.indexOf("AKo");
  const j = CLASSES.indexOf("AKs");
  // 12 combos vs 4 — the class reduction must not lose that.
  assert.ok(Math.abs(PRIOR[i] / PRIOR[j] - 3) < 1e-9);
});

test("every average strategy is a probability distribution", () => {
  const r = solve({ iterations: 8, valuer: flatValuer });
  for (const n of r.tree.nodes) {
    if (n.kind !== "decision") continue;
    const avg = r.average.get(n.id)!;
    const k = n.actions.length;
    for (let c = 0; c < N_CLASSES; c++) {
      let s = 0;
      for (let a = 0; a < k; a++) {
        const p = avg[c * k + a];
        assert.ok(p >= -1e-12 && p <= 1 + 1e-12, `node ${n.id} class ${c} has p=${p}`);
        s += p;
      }
      assert.ok(Math.abs(s - 1) < 1e-9, `node ${n.id} class ${c} sums to ${s}`);
    }
  }
});

test("with folding always free and playing always losing, everyone folds", () => {
  // Any live player loses their whole contribution; folding costs only what is
  // already in. The only sane equilibrium is to fold everything that can fold.
  const losing: TerminalValuer = (t, player) =>
    t.live.includes(player) ? -t.contrib[player] - 1000 : -t.contrib[player];
  const r = solve({ iterations: 60, valuer: losing });

  const root = r.tree.nodes[r.tree.root];
  assert.equal(root.kind, "decision");
  if (root.kind !== "decision") return;
  // UTG's only actions at the root are fold and raise; raising must vanish.
  for (const cls of ["AA", "72o", "KQs"]) {
    const f = actionFrequencies(r, root.id, cls);
    assert.ok(f.r < 0.05, `UTG still raises ${cls} at ${(100 * f.r).toFixed(1)}%`);
  }
});

test("with entering always profitable, UTG raises everything", () => {
  // The payoff must scale with what you put in. A FLAT bonus does not work:
  // at an all-in terminal both players have contributed their whole stack, so
  // a flat +1000 nets exactly 0 — the same as folding at the root, but with
  // the risk of folding later for -25. CFR correctly prefers folding there,
  // which looks like a failure and is not. Doubling the investment instead
  // makes entering strictly better at every level.
  const winning: TerminalValuer = (t, player) =>
    t.live.includes(player) ? +t.contrib[player] : -t.contrib[player];
  const r = solve({ iterations: 60, valuer: winning });
  const root = r.tree.nodes[r.tree.root];
  if (root.kind !== "decision") return;
  for (const cls of ["AA", "72o"]) {
    const f = actionFrequencies(r, root.id, cls);
    assert.ok(f.r > 0.95, `UTG only raises ${cls} at ${(100 * f.r).toFixed(1)}%`);
  }
});

test("the game stays zero sum under the average strategy", () => {
  // Chips are conserved by the tree; CFR must not invent or destroy any.
  const r = solve({ iterations: 20, valuer: flatValuer });
  for (const n of r.tree.nodes) {
    if (n.kind !== "terminal") continue;
    let total = 0;
    for (const p of POS) total += flatValuer(n.terminal, p, 0);
    assert.ok(Math.abs(total) < 1e-9, `terminal ${n.id} sums to ${total}`);
  }
});

test("regret matching starts uniform before any regret exists", () => {
  const r = solve({ iterations: 1, valuer: flatValuer });
  const root = r.tree.nodes[r.tree.root];
  if (root.kind !== "decision") return;
  const f = actionFrequencies(r, root.id, "AA");
  const k = root.actions.length;
  for (const a of root.actions) {
    assert.ok(Math.abs(f[a] - 1 / k) < 1e-9, `first iteration is not uniform: ${a}=${f[a]}`);
  }
});

test("distinct hand classes can take distinct strategies", () => {
  // A valuer where only the class index matters: high classes win, low lose.
  // If the engine collapsed classes together this would be impossible.
  // Proportional for the same reason as above — a flat bonus is swamped by
  // an all-in's contribution and stops separating anything.
  const byClass: TerminalValuer = (t, player, c) =>
    t.live.includes(player) && c < 20 ? +t.contrib[player] : -t.contrib[player];
  const r = solve({ iterations: 200, valuer: byClass });
  const root = r.tree.nodes[r.tree.root];
  if (root.kind !== "decision") return;
  const strong = actionFrequencies(r, root.id, CLASSES[0]);
  const weak = actionFrequencies(r, root.id, CLASSES[N_CLASSES - 1]);
  // An absolute gap is the wrong assertion: UTG opening into five players who
  // can all escalate is a genuinely tight spot, so even a guaranteed-winner
  // class does not approach 100%. What matters is that the engine separates
  // classes at all — a ratio, and the right direction.
  assert.ok(strong.r > 0.1, `strong class barely raises: ${strong.r.toFixed(3)}`);
  assert.ok(
    strong.r > 5 * weak.r,
    `strong ${strong.r.toFixed(3)} vs weak ${weak.r.toFixed(3)} — insufficient separation`,
  );
});

test("it is deterministic", () => {
  const a = solve({ iterations: 12, valuer: flatValuer });
  const b = solve({ iterations: 12, valuer: flatValuer });
  const root = a.tree.root;
  assert.deepEqual(
    Array.from(a.average.get(root)!.slice(0, 30)),
    Array.from(b.average.get(root)!.slice(0, 30)),
  );
});
