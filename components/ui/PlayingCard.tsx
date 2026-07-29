import type { Card } from "@/lib/poker/engine";
import { cardDisplayParts } from "./cardDisplay";

export interface PlayingCardProps {
  card: Card;
  /** Render diamonds/clubs in the 4-color-deck palette (blu/grn). */
  fourColor?: boolean;
  /** Outline the card, e.g. to call out a winning out. */
  highlight?: boolean;
  /** Render the card back instead of its face. */
  faceDown?: boolean;
}

/** A single reference `.card` — see reference/poker-math-trainer.html cardHTML(). */
export function PlayingCard({
  card,
  fourColor = false,
  highlight = false,
  faceDown = false,
}: PlayingCardProps) {
  if (faceDown) {
    const classes = ["card", "back", highlight ? "hl" : ""].filter(Boolean).join(" ");
    return <div className={classes} />;
  }

  const { rankText, suitGlyph, colorClass } = cardDisplayParts(card, fourColor);
  const classes = ["card", colorClass, highlight ? "hl" : ""].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <div className="r">{rankText}</div>
      <div className="s">{suitGlyph}</div>
    </div>
  );
}
