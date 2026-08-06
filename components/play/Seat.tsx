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
  /** Chips this seat currently has in front of them on this street. */
  betChips?: number;
  /**
   * Setup mode (M10A): the seat becomes a control for picking the hero
   * position. `onSelect` is what turns the seat into a button — without it
   * the seat stays the plain read-only plate the live table uses.
   */
  onSelect?: () => void;
  isSelected?: boolean;
  /** Offered, but no solve covers it. Disabled with `title` as the reason. */
  unavailableReason?: string;
  /** Placement on the oval, as a percentage of the table box. */
  left: number;
  top: number;
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
  betChips = 0,
  onSelect,
  isSelected = false,
  unavailableReason,
  left,
  top,
}: TableSeatProps) {
  const classes = [
    "pt-seat",
    isHero ? "hero" : "",
    isActive ? "active" : "",
    isFolded ? "folded" : "",
    onSelect ? "selectable" : "",
    isSelected ? "selected" : "",
    unavailableReason ? "unavailable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Placement travels as custom properties, not as `left`/`top` directly, so
  // the narrow-container rule can pull the side columns inward — an inline
  // left/top would beat any stylesheet and the seats would spill off the felt.
  const placement = { "--seat-left": `${left}%`, "--seat-top": `${top}%` } as CSSProperties;

  const body = (
    <>
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
      {betChips > 0 && (
        <span className="pt-seat-bet">{bb(betChips)}</span>
      )}
    </>
  );

  // A seat is a button ONLY in setup mode. Making the live table's seats
  // focusable would put six tab stops between the player and the action bar
  // in a loop that is deliberately keyboard-first.
  if (onSelect) {
    return (
      <button
        type="button"
        className={classes}
        style={placement}
        onClick={onSelect}
        disabled={Boolean(unavailableReason)}
        aria-pressed={isSelected}
        title={unavailableReason}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={classes} style={placement}>
      {body}
    </div>
  );
}
