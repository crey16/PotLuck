/**
 * Shared explanatory text used by more than one drill kind. Extracted after a
 * final-review finding: outs.ts and decision.ts each carried a byte-identical
 * "dead outs" note, which is exactly the kind of duplication that goes silently
 * out of sync when one copy is edited and the other is not.
 */
import { deadOuts, cardStr, type Card } from "../poker/engine";
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
 * "You have a gutshot." — except when `describeDraw` fell back to its
 * no-draw or backdoor-only cases, which are not "a gutshot"-shaped strings.
 * `describeDraw`'s fallback (lib/poker/engine.ts) is the literal string
 * "no obvious draw", which reads as broken English ("You have a no obvious
 * draw") when passed through `withArticle`. And "backdoor flush" alone or in
 * a combo tag is not a draw you count outs for on this street, so a sentence
 * built on it must not imply that it is (finding L-2). Do not modify
 * lib/poker/ to "fix" the label — the fallback and the tag are both correct
 * there; only the sentence built from them here is wrong.
 */
export function drawLine(draw: string): string {
  if (draw === "no obvious draw") {
    return "You have no made hand — you are drawing to outrun them.";
  }

  const parts = draw.split(" + ");
  const hasBackdoor = parts.includes("backdoor flush");
  const countable = parts.filter((p) => p !== "backdoor flush");

  if (countable.length === 0) {
    // draw was "backdoor flush" alone.
    return "You have a backdoor flush draw — not live enough to count outs for on this street.";
  }

  const base = `You have ${withArticle(countable.join(" + "))}.`;
  return hasBackdoor
    ? `${base} (You also have backdoor flush potential, but that is not live enough to count outs for on this street.)`
    : base;
}
