/**
 * Shared explanatory text used by more than one drill kind. Extracted after a
 * final-review finding: outs.ts and decision.ts each carried a byte-identical
 * "dead outs" note, which is exactly the kind of duplication that goes silently
 * out of sync when one copy is edited and the other is not.
 */
import { deadOuts, cardStr, type Card, type Street } from "../poker/engine";
import { withArticle } from "./opts";
import type { ExplainNote } from "./contract";

/**
 * Face-up mode's dead-outs callout: cards that complete the hero's draw but
 * hand villain a bigger one, and so never counted. Returns null when there
 * are none, so callers can `if (note) notes.push(note)`.
 */
export function deadOutsNote(hero: Card[], villain: Card[], board: Card[]): ExplainNote | null {
  const dead = deadOuts(hero, villain, board);
  if (!dead.length) return null;
  return {
    tone: "warn",
    title: `Dead outs (${dead.length}).`,
    text:
      dead.map((d) => `${cardStr(d.card)} gives you ${d.you} but hands them ${d.them}`).join("; ") +
      ". These complete your draw and still lose, so they never counted. This is the most " +
      "expensive miscount in poker — always check what the card does for them before you " +
      "add it to your total.",
  };
}

/**
 * Deliberately says nothing about whether the hero has a MADE hand. The label
 * behind it, `describeDraw`'s "no obvious draw", only means there is no draw —
 * the hero may well hold a pair. The previous wording ("You have no made hand")
 * was printed under a hero holding a pair of fives during the M2 visual pass.
 */
const NO_DRAW = "You have no obvious draw — your outs are the cards that improve you past them.";

/**
 * Tags that are already complete noun phrases and must NOT take an article.
 * `withArticle` is for singular count nouns ("a gutshot"); applied to these it
 * produces "a two overcards".
 */
const ARTICLELESS = new Set(["two overcards", "one overcard"]);

const phrase = (tag: string): string => (ARTICLELESS.has(tag) ? tag : withArticle(tag));

/**
 * "You have a gutshot." — built from `describeDraw`'s label (lib/poker/engine.ts).
 *
 * Three of that function's outputs are not "a gutshot"-shaped and each has
 * broken this sentence in turn:
 *
 *   - the fallback "no obvious draw" → "You have a no obvious draw" (finding L-2)
 *   - the plural "two overcards" / "one overcard" → "You have a two overcards"
 *     (found in the M2 visual pass, face-up mode)
 *   - "backdoor flush", which is not a draw you count outs for at all
 *
 * `street` matters because a backdoor flush needs BOTH remaining cards: on the
 * turn there is only one to come, so backdoor potential does not exist and
 * mentioning it is false, not merely imprecise.
 *
 * Do not modify lib/poker/ to "fix" any of these labels — the fallback and the
 * tags are all correct there. Only the sentence built from them belongs here.
 */
export function drawLine(draw: string, street: Street = "flop"): string {
  if (draw === "no obvious draw") return NO_DRAW;

  const parts = draw.split(" + ");
  const backdoorIsLive = street === "flop";
  const hasBackdoor = parts.includes("backdoor flush");
  const countable = parts.filter((p) => p !== "backdoor flush");

  if (countable.length === 0) {
    // draw was "backdoor flush" alone — on the turn that is simply no draw.
    return backdoorIsLive
      ? "You have a backdoor flush draw — not live enough to count outs for on this street."
      : NO_DRAW;
  }

  const base = `You have ${countable.map(phrase).join(" and ")}.`;
  return hasBackdoor && backdoorIsLive
    ? `${base} (You also have backdoor flush potential, but that is not live enough to count outs for on this street.)`
    : base;
}
