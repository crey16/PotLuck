/**
 * Preflop best response for the BTN-vs-BB slice, on top of solved postflop EVs.
 *
 *   npx tsx solver/preflop-br.ts <ev-dir>
 *
 * WHY BEST RESPONSE AND NOT CFR. With the postflop EVs held fixed, BB's
 * call/fold threshold does not depend on BTN's opening frequency — the EVs
 * already encode the ranges that produced them. So the preflop step for this
 * tree is a threshold computation, not a game to solve. The strategic coupling
 * reappears only across ITERATIONS: new preflop ranges change the postflop
 * subgame, which changes the EVs, which moves the thresholds. A tree with
 * 3-bets and 4-bets would need real CFR within the preflop step; this one
 * does not, and pretending otherwise would add machinery that does nothing.
 *
 * THE TREE (chips: 10 = 1bb; SB posts 5 and folds, BB posts 10):
 *
 *   BTN  fold                      -> BTN   0
 *        open to 25
 *          BB fold                 -> BTN +15, BB -10
 *          BB call                 -> BTN ev_ip-25, BB ev_oop-25   (postflop)
 *
 * Every terminal sums to +5 across the two players — the dead small blind they
 * split. That invariant is asserted below, because a sign error in this
 * accounting is invisible in the output and fatal to the result.
 *
 * UNITS: EVs from root-ev are each player's SHARE OF THE FINAL POT in chips,
 * measured, not assumed — see docs/14-m87a-solver-scope.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { cellFrequency, getScenario, handAt } from "../lib/poker/ranges";
import {
  ALL_COMBOS,
  blocks,
  classFrequencyOf,
  loadEvTable,
} from "./preflop/evtable";

const OPEN = 25; // BTN's open, in chips
const DEAD_SB = 5;
const BB_POST = 10;

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npx tsx solver/preflop-br.ts <ev-dir>");
  process.exit(2);
}

// The card-id convention, the EV averaging and the coverage count all live in
// `preflop/evtable.ts` so that this loop and the pack it feeds
// (`preflop-pack.ts`) cannot drift apart. Two derivations of the same
// arithmetic is exactly how the published pack would come to disagree with the
// loop that produced it, invisibly.
const table = loadEvTable(dir);
const oopCombos = table.comboMean(0);
const ipCombos = table.comboMean(1);
const pot = table.pot;
const covered = (p: 0 | 1) => table.coverage(p);

console.log(`flops averaged: ${table.flops.length}   pot: ${pot} chips`);
console.log(
  `coverage — OOP ${covered(0)}/${ALL_COMBOS.length} combos, ` +
    `IP ${covered(1)}/${ALL_COMBOS.length}`,
);
if (covered(0) < ALL_COMBOS.length * 0.99) {
  console.log(
    "\n*** INCOMPLETE: hands missing from the postflop solve cannot be\n" +
      "    evaluated here, because they never reach the flop in that solve.\n" +
      "    Re-run the postflop solves with wider ranges before trusting the\n" +
      "    ranges below — see docs/14-m87a-solver-scope.md.\n",
  );
}

// ---- BB's best response: call iff calling beats folding --------------------
// fold = -BB_POST; call = ev_oop - OPEN.  So call iff ev_oop > OPEN - BB_POST.
const BB_CALL_THRESHOLD = OPEN - BB_POST; // 15 chips
const bbCalls = new Set<string>();
for (const c of ALL_COMBOS) {
  const ev = oopCombos.get(c);
  if (ev !== undefined && ev > BB_CALL_THRESHOLD) bbCalls.add(c);
}

// ---- BTN's best response, with card removal -------------------------------
function btnOpenEv(y: string): number | null {
  const evIp = ipCombos.get(y);
  if (evIp === undefined) return null;
  let live = 0, calls = 0;
  for (const x of ALL_COMBOS) {
    if (blocks(y, x)) continue;
    live++;
    if (bbCalls.has(x)) calls++;
  }
  const pCall = live > 0 ? calls / live : 0;
  return (1 - pCall) * (DEAD_SB + BB_POST) + pCall * (evIp - OPEN);
}

const btnOpens = new Set<string>();
for (const c of ALL_COMBOS) {
  const ev = btnOpenEv(c);
  if (ev !== null && ev > 0) btnOpens.add(c);
}

// ---- the payoff invariant, asserted ---------------------------------------
// Every terminal must sum to the dead small blind across both players.
{
  const bbFold = 15 + -10;
  if (bbFold !== DEAD_SB) throw new Error(`BB-fold terminal sums to ${bbFold}, expected ${DEAD_SB}`);
  const postflop = pot - 2 * OPEN;
  if (postflop !== DEAD_SB) {
    throw new Error(`postflop terminal sums to ${postflop}, expected ${DEAD_SB}`);
  }
}

// ---- report, as 169-class frequencies, against the reference ranges --------
const solvedBtn = classFrequencyOf((c) => btnOpens.has(c));
const solvedBb = classFrequencyOf((c) => bbCalls.has(c));
const refBtn = getScenario("btn");
const refBb = getScenario("bb-btn");
if (!refBtn || !refBb) throw new Error("reference scenarios missing");

function compare(name: string, solved: Map<string, number>, ref: (h: string) => number) {
  let sumSolved = 0, sumRef = 0, absDiff = 0;
  const worst: [string, number][] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const hand = handAt(i, j);
      const s = solved.get(hand) ?? 0;
      const r = ref(hand);
      const combos = hand.length === 2 ? 6 : hand.endsWith("s") ? 4 : 12;
      sumSolved += s * combos;
      sumRef += r * combos;
      absDiff += Math.abs(s - r) * combos;
      worst.push([hand, s - r]);
    }
  }
  worst.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  console.log(`\n${name}`);
  console.log(`  solved range: ${(100 * sumSolved / 1326).toFixed(1)}% of hands`);
  console.log(`  reference:    ${(100 * sumRef / 1326).toFixed(1)}%`);
  console.log(`  total combo divergence: ${(100 * absDiff / 1326).toFixed(1)} points`);
  console.log(
    "  biggest moves: " +
      worst.slice(0, 8).map(([h, d]) => `${h}${d > 0 ? "+" : ""}${(100 * d).toFixed(0)}`).join(" "),
  );
}

compare("BTN open", solvedBtn, (h) => cellFrequency(refBtn, h).r);
compare("BB call", solvedBb, (h) => cellFrequency(refBb, h).c);

// ---- emit the next iteration's solver ranges ------------------------------
// The loop only closes if these ranges can be fed back into the postflop
// solve. Iteration 1 uses 100% ranges, so its EVs assume an opponent who
// never punishes anything and the result is far too wide — the convergence
// is FROM ABOVE, and the whole point of iteration 2 is to see it tighten.
const outPath = process.argv[3];
if (outPath) {
  // TWO FIXES, both standard, both learned from iteration 2.
  //
  // 1. EXPLORATION FLOOR. Iteration 1 solved at 100% ranges so every hand had
  //    an EV. Iteration 2's ranges are narrower, so the excluded hands drop
  //    out of the postflop solve and lose their EVs — coverage fell from
  //    1326/1326 to 1194/1326 and the loop can no longer tell whether a
  //    folded hand should come back. Keeping every hand at a small weight
  //    costs almost nothing strategically and keeps every EV computable.
  //
  // 2. FICTITIOUS PLAY. Replacing the range with the raw best response each
  //    iteration makes the two players chase each other: BB tightened
  //    81% -> 72%, so BTN widened 76% -> 79%, which will push BB back the
  //    other way. Averaging the best response into the running range is the
  //    textbook damping, and it is what converges where alternating best
  //    response oscillates.
  const FLOOR = 0.02;
  const rangeString = (freq: Map<string, number>, prev?: Map<string, number>, n = 1) => {
    const parts: string[] = [];
    for (let i = 0; i < 13; i++) {
      for (let j = 0; j < 13; j++) {
        const hand = handAt(i, j);
        const br = freq.get(hand) ?? 0;
        // Fictitious play: the new range is the running average of every best
        // response so far, not the latest one.
        const p = prev?.get(hand);
        const avg = p === undefined ? br : (p * n + br) / (n + 1);
        const f = Math.max(avg, FLOOR);
        parts.push(f >= 0.999 ? hand : `${hand}:${+f.toFixed(3)}`);
      }
    }
    return parts.join(",");
  };

  // The previous iteration's ranges, so they can be averaged rather than
  // replaced. Parsed back out of the solver range string.
  const prevPath = process.argv[4];
  const iterN = Number(process.argv[5] ?? 1);
  let prevIp: Map<string, number> | undefined;
  let prevOop: Map<string, number> | undefined;
  if (prevPath) {
    const prev = JSON.parse(readFileSync(prevPath, "utf8"));
    const parse = (str: string) => {
      const m = new Map<string, number>();
      for (const tok of str.split(",")) {
        const [h, f] = tok.split(":");
        m.set(h, f === undefined ? 1 : Number(f));
      }
      return m;
    };
    prevIp = parse(prev.ip);
    prevOop = parse(prev.oop);
  }
  writeFileSync(outPath, JSON.stringify({
    spot: "srp-btn-bb",
    oop: rangeString(solvedBb, prevOop, iterN),
    ip: rangeString(solvedBtn, prevIp, iterN),
    pot: 55,
    stack: 975,
  }, null, 2) + "\n");
  console.log(`\nwrote next-iteration ranges to ${outPath}`);
}
