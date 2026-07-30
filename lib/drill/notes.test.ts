import test from "node:test";
import assert from "node:assert/strict";

import { drawLine } from "./notes";
import { generateOuts } from "./kinds/outs";
import { mulberry32 } from "./rng";
import type { DrillContext, DrillLevel, OppMode } from "./contract";
import type { Spot } from "../poker/engine";

/**
 * `drawLine` turns an engine draw LABEL into a user-facing SENTENCE. Every bug
 * this file guards has the same shape: a label that is not an "a gutshot"-style
 * singular noun phrase gets an article stapled to it and renders as broken
 * English. It has now happened twice —
 *
 *   "no obvious draw" → "You have a no obvious draw."   (finding L-2, fixed)
 *   "two overcards"   → "You have a two overcards."     (found in the visual pass)
 *
 * — and both times only in FACE-UP mode, because unknown mode filters the label
 * through `coreDraw` down to flush/straight/gutshot tags while face-up passes
 * `describeDraw`'s raw output straight through. So the sweep below runs in
 * `shown` mode: that is where the whole label vocabulary actually surfaces.
 */

/** Every tag `describeDraw` (lib/poker/engine.ts) can emit, plus its fallback. */
const TAGS = [
  "flush draw",
  "open-ended straight draw",
  "double gutshot",
  "gutshot",
  "backdoor flush",
  "two overcards",
  "one overcard",
] as const;

/** Combinations the tag-building order in `describeDraw` can actually produce. */
const COMBOS = [
  "flush draw + gutshot",
  "flush draw + open-ended straight draw",
  "backdoor flush + two overcards",
  "backdoor flush + one overcard",
  "gutshot + backdoor flush",
];

/**
 * Article-vs-noun agreement. An English sentence never says "a two overcards"
 * or "a no obvious draw"; nor "a" before a vowel, nor "a" before a plural noun.
 */
function assertReadsAsEnglish(sentence: string, context: string) {
  assert.doesNotMatch(sentence, /\ban? (?:no|two|three|four)\b/i, `${context}: ${sentence}`);
  assert.doesNotMatch(sentence, /\ba (?=[aeiou])/i, `${context}: ${sentence}`);
  // "a ... overcards" / "a ... draws" — article followed by a plural head noun.
  assert.doesNotMatch(sentence, /\ba\b[^.]*\b(?:overcards|draws|gutshots)\b/i, `${context}: ${sentence}`);
}

test("drawLine: every engine draw label renders as English", () => {
  for (const label of [...TAGS, ...COMBOS, "no obvious draw"]) {
    const sentence = drawLine(label);
    assertReadsAsEnglish(sentence, `label "${label}"`);
    // A full stop, or ".)" when the backdoor parenthetical is appended.
    assert.match(sentence, /\.\)?$/, `label "${label}" should end in a full stop: ${sentence}`);
  }
});

test("drawLine: overcard labels take no article", () => {
  assert.equal(drawLine("two overcards"), "You have two overcards.");
  assert.equal(drawLine("one overcard"), "You have one overcard.");
});

/**
 * A backdoor flush needs BOTH remaining cards. On the turn only one card is to
 * come, so there is no such thing as backdoor potential — telling the user they
 * have it is not merely imprecise, it is false.
 */
test("drawLine: no backdoor-flush claim on the turn", () => {
  assert.doesNotMatch(drawLine("gutshot + backdoor flush", "turn"), /backdoor/i);
  assert.match(drawLine("gutshot + backdoor flush", "flop"), /backdoor/i);
});

test("drawLine: a turn spot whose only tag is backdoor flush is a no-draw hand", () => {
  const sentence = drawLine("backdoor flush", "turn");
  assert.doesNotMatch(sentence, /backdoor/i);
  assertReadsAsEnglish(sentence, "backdoor-only on the turn");
});

const ctx = (seed: number, level: DrillLevel, oppMode: OppMode): DrillContext => ({
  level,
  oppMode,
  rng: mulberry32(seed),
});

test("generateOuts: the dealt sentence reads as English in face-up mode", () => {
  for (let seed = 1; seed <= 400; seed++) {
    for (const level of [1, 2, 3] as DrillLevel[]) {
      const q = generateOuts(ctx(seed, level, "shown"));
      const spot = q.payload.spot as Spot;
      const text = (q.body.find((b) => b.type === "text") as { text: string }).text;
      assertReadsAsEnglish(text, `seed ${seed} level ${level} (${spot.draw})`);
      if (spot.street === "turn") {
        assert.doesNotMatch(
          text,
          /backdoor/i,
          `seed ${seed} level ${level}: backdoor claimed on the turn — ${text}`,
        );
      }
    }
  }
});

/**
 * "no obvious draw" is a statement about DRAWS, not about made hands: the hero
 * can hold a pair and still have no draw. An earlier wording asserted "You have
 * no made hand" and was caught in the visual pass printed under a hero holding
 * a pair of fives on 2♠K♦5♦.
 */
test("drawLine: the no-draw line makes no claim about made hands", () => {
  const sentence = drawLine("no obvious draw");
  assert.doesNotMatch(sentence, /made hand/i, sentence);
  assert.match(sentence, /draw/i, sentence);
});
