/**
 * Generate the solver input ranges for the srp-btn-bb spot FROM
 * lib/poker/ranges.ts, so the play mode, the range pages and the preflop
 * drill can never disagree about who arrives at the flop with what.
 *
 *   npx tsx solver/gen-ranges.ts > solver/ranges-srp-btn-bb.json
 *
 * IP  = BTN's opening range (scenario "btn", raise frequency).
 * OOP = BB's flat-call range vs that open (scenario "bb-btn", call
 *       frequency — 3-bet hands leave the flat-calling range).
 *
 * Chips are tenths of a big blind: BTN opens 2.5bb, BB calls; with the SB's
 * dead 0.5bb the pot is 5.5bb = 55 chips and stacks are 97.5bb = 975.
 */
import { cellFrequency, getScenario, handAt } from "../lib/poker/ranges";

function rangeString(freqOf: (hand: string) => number): string {
  const parts: string[] = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const hand = handAt(i, j);
      const f = freqOf(hand);
      if (f <= 0) continue;
      parts.push(f >= 0.999 ? hand : `${hand}:${+f.toFixed(3)}`);
    }
  }
  return parts.join(",");
}

const btn = getScenario("btn");
const bbBtn = getScenario("bb-btn");
if (!btn || !bbBtn) throw new Error("scenarios btn / bb-btn missing");

const out = {
  spot: "srp-btn-bb",
  oop: rangeString((h) => cellFrequency(bbBtn, h).c),
  ip: rangeString((h) => cellFrequency(btn, h).r),
  pot: 55,
  stack: 975,
};

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
