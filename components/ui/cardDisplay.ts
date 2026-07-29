/**
 * Pure presentation-logic helper for PlayingCard. Extracted so it can be
 * unit-tested with the node test runner without a DOM.
 */
import { cardStr, SUIT_GLYPH, type Card } from "../../lib/poker/engine";

export type CardColorClass = "" | "red" | "blu" | "grn";

export interface CardDisplayParts {
  rankText: string;
  suitGlyph: string;
  colorClass: CardColorClass;
}

/**
 * Derives the display parts for a card.
 *
 * - Rank "T" renders as "10"; every other rank renders as-is.
 * - Hearts are always red.
 * - Diamonds are red normally, but render as `.blu` in four-color mode.
 * - Clubs are default ink normally, but render as `.grn` in four-color mode.
 * - Spades are always default ink.
 */
export function cardDisplayParts(card: Card, fourColor = false): CardDisplayParts {
  const [rankChar, suitChar] = cardStr(card);
  const rankText = rankChar === "T" ? "10" : rankChar;
  const suitGlyph = SUIT_GLYPH[suitChar];

  let colorClass: CardColorClass = "";
  if (suitChar === "h") colorClass = "red";
  else if (suitChar === "d") colorClass = fourColor ? "blu" : "red";
  else if (suitChar === "c") colorClass = fourColor ? "grn" : "";

  return { rankText, suitGlyph, colorClass };
}
