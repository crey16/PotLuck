import type { CSSProperties } from "react";
import { PlayingCard } from "@/components/ui/PlayingCard";
import { bb } from "@/lib/play/units";
import type { Card } from "@/lib/poker/engine";

export interface TableSeatProps {
  /** "BTN", "BB", "UTG"… */
  position: string;
  /** Remaining stack in chips (tenths of a bb). Null for a folded seat. */
  stackChips: number | null;
  cards?: Card[];
  faceDown?: boolean;
  isHero?: boolean;
  isDealer?: boolean;
  /** Outline while this seat is to act. */
  isActive?: boolean;
  /** Dimmed: folded preflop and not part of this spot. */
  isFolded?: boolean;
  /** Absolute placement on the oval, as a percentage. */
  style?: CSSProperties;
}

/**
 * One seat on the play table.
 *
 * A folded seat is rendered, not hidden. In a BTN-vs-BB single-raised pot the
 * other four players genuinely folded preflop, so showing them dimmed is the
 * truth about the hand — and it is what makes the position labels mean
 * anything at all.
 *
 * Named `TableSeat`, not `Seat`: components/ui/Felt.tsx already exports a
 * `Seat`, and two components with one name in the same import graph is a
 * readability trap.
 */
export function TableSeat({
  position,
  stackChips,
  cards = [],
  faceDown = false,
  isHero = false,
  isDealer = false,
  isActive = false,
  isFolded = false,
  style,
}: TableSeatProps) {
  const classes = [
    "pt-seat",
    isHero ? "hero" : "",
    isActive ? "active" : "",
    isFolded ? "folded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={style}>
      {cards.length > 0 && (
        <div className="pt-seat-cards">
          {cards.map((c) => (
            <PlayingCard key={c} card={c} faceDown={faceDown} />
          ))}
        </div>
      )}
      <div className="pt-seat-plate">
        <span className="pt-seat-pos">{position}</span>
        <span className="pt-seat-stack">
          {isFolded ? "folded" : stackChips === null ? "—" : bb(stackChips)}
        </span>
      </div>
      {isDealer && (
        <span className="pt-dealer" aria-label="Dealer button">
          D
        </span>
      )}
    </div>
  );
}
