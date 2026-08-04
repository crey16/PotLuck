import { PlayingCard } from "@/components/ui/PlayingCard";
import { TableSeat } from "./Seat";
import { bb } from "@/lib/play/units";
import type { SeatId } from "@/lib/play/beats";
import type { Card } from "@/lib/poker/engine";

/**
 * 6-max seat order and where each sits on the oval. The order is the real
 * one — UTG, HJ, CO, BTN, SB, BB act in that sequence — so rotating the list
 * keeps the positions truthful relative to each other.
 */
const SPOTS = [
  { pos: "BB", left: 50, top: 8 },
  { pos: "UTG", left: 88, top: 30 },
  { pos: "HJ", left: 88, top: 72 },
  { pos: "CO", left: 50, top: 92 },
  { pos: "BTN", left: 12, top: 72 },
  { pos: "SB", left: 12, top: 30 },
] as const;

/** The slot the hero always appears in — bottom-centre, as in every client. */
const HERO_SLOT = 3;

export interface PokerTableProps {
  heroPosition: string;
  villainPosition: string;
  heroCards: Card[];
  villainCards: Card[];
  showdown: boolean;
  board: Card[];
  potChips: number;
  heroStackChips: number;
  villainStackChips: number;
  activeSeat: SeatId | null;
  /** The chips currently sliding into the pot, if any. */
  chipFlight: { seat: SeatId; chips: number } | null;
  spotLabel: string;
}

export function PokerTable({
  heroPosition,
  villainPosition,
  heroCards,
  villainCards,
  showdown,
  board,
  potChips,
  heroStackChips,
  villainStackChips,
  activeSeat,
  chipFlight,
  spotLabel,
}: PokerTableProps) {
  // Rotate the identities, not the coordinates, so the hero's real position
  // lands in the bottom-centre slot while everyone keeps their true seat order.
  const heroIndex = SPOTS.findIndex((s) => s.pos === heroPosition);
  const offset = (heroIndex - HERO_SLOT + SPOTS.length) % SPOTS.length;

  return (
    <div className="pt-wrap">
      <div className="pt-oval">
        <div className="pt-center">
          <div className="pt-spot mono-label">{spotLabel}</div>
          <div className="pt-pot">
            <span className="mono-label">Pot</span>
            <strong>{bb(potChips)}</strong>
          </div>
          <div className="pt-board">
            {board.map((c) => (
              <PlayingCard key={c} card={c} />
            ))}
          </div>
        </div>

        {SPOTS.map((slot, i) => {
          const spot = SPOTS[(i + offset) % SPOTS.length];
          const isHero = spot.pos === heroPosition;
          const isVillain = spot.pos === villainPosition;
          const involved = isHero || isVillain;
          return (
            <TableSeat
              key={spot.pos}
              position={spot.pos}
              stackChips={isHero ? heroStackChips : isVillain ? villainStackChips : null}
              cards={isHero ? heroCards : isVillain ? villainCards : []}
              faceDown={isVillain && !showdown}
              isHero={isHero}
              isDealer={spot.pos === "BTN"}
              isActive={
                (isHero && activeSeat === "hero") ||
                (isVillain && activeSeat === "villain")
              }
              isFolded={!involved}
              left={slot.left}
              top={slot.top}
            />
          );
        })}

        {chipFlight && (
          <div className={`pt-chips from-${chipFlight.seat}`} aria-hidden="true">
            {bb(chipFlight.chips)}
          </div>
        )}
      </div>
    </div>
  );
}
