/**
 * The M6 "done when" check, run against the real published data:
 *   npx tsx solver/simulate-session.ts [hands] [seed]
 *
 * Simulates a play-mode session exactly as PlayShell drives it — pick an
 * unused instance, make the preflop decision, then walk the timeline making
 * uniformly random postflop choices — and verifies every hand completes with
 * a graded verdict at every decision and a resolvable outcome.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mulberry32 } from "../lib/drill/rng";
import { whoIsAhead } from "../lib/poker/engine";
import { pickHand, handId } from "../lib/play/load";
import { preflopDecision } from "../lib/play/preflop";
import {
  awaitingHero, boardFrom, handOver, holeCards, timeline,
} from "../lib/play/timeline";
import { verdictAt } from "../lib/play/verdict";
import type { SolveFile, SolveManifest } from "../lib/play/types";

const DIR = join(process.cwd(), "public", "solves", "srp-btn-bb");
const HANDS = Number(process.argv[2] ?? 20);
const rng = mulberry32(Number(process.argv[3] ?? 7));

const manifest = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8")) as SolveManifest;
const cache = new Map<string, SolveFile>();
const used = new Set<string>();

let decisions = 0, right = 0, lossSteps = 0;
const outcomes = { f: 0, bf: 0, sd: 0 };

for (let h = 0; h < HANDS; h++) {
  const pick = pickHand(manifest, used, rng);
  used.add(handId(pick.flop, pick.index));
  if (!cache.has(pick.flop)) {
    cache.set(
      pick.flop,
      JSON.parse(readFileSync(join(DIR, `${pick.flop}.json`), "utf8")) as SolveFile
    );
  }
  const solve = cache.get(pick.flop)!;
  const inst = solve.instances[pick.index];

  // Preflop, graded like the UI does.
  const pf = preflopDecision(inst.hero, inst.hand);
  const pfChoice = pf.options[Math.floor(rng() * pf.options.length)].key;
  decisions++;
  if (pfChoice === pf.answer || pf.acceptable.includes(pfChoice)) right++;

  // Postflop: random walk to the end.
  const chosen: number[] = [];
  for (let guard = 0; guard < 40; guard++) {
    const events = timeline(inst, chosen);
    if (handOver(events)) {
      const last = events[events.length - 1];
      if (last.type !== "end") throw new Error("unreachable");
      outcomes[last.end.k]++;
      if (last.end.k === "sd") {
        const board = boardFrom(solve.flop, events);
        if (board.length !== 5) throw new Error(`${pick.flop}#${pick.index}: bad showdown board`);
        whoIsAhead(holeCards(inst.hand), holeCards(inst.bot), board); // must not throw
      }
      break;
    }
    if (!awaitingHero(events)) throw new Error("stuck: not awaiting hero, not over");
    const last = events[events.length - 1];
    if (last.type !== "decision") throw new Error("unreachable");
    const a = Math.floor(rng() * last.node.a.length);
    verdictAt(last.node, a); // must grade
    decisions++;
    if (["correct", "acceptable"].includes(verdictAt(last.node, a))) right++;
    lossSteps += last.node.l[a];
    chosen.push(a);
  }
}

console.log(
  `${HANDS} hands played · ${decisions} decisions · ` +
  `${Math.round((right / decisions) * 100)}% right (random play) · ` +
  `${(lossSteps * 0.05).toFixed(1)}bb EV lost · ` +
  `outcomes: ${outcomes.f} hero folds, ${outcomes.bf} bot folds, ${outcomes.sd} showdowns`
);
