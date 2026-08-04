/**
 * The pure event-to-motion mapping for the play table.
 *
 * `lib/play/timeline.ts` already produces an ordered `HandEvent[]`, and its
 * docstring has always said "the UI replays newly appended events with delays"
 * — this is the module that finally makes that true. It is pure and total on
 * valid input, so the pacing is unit-testable the same way the drill
 * generators are: no React, no timers, no randomness.
 *
 * The verdict is deliberately NOT a beat. It renders concurrently with the
 * following beat rather than queueing ahead of it — see
 * components/play/useHandDirector.ts. Queueing it would add 600ms of staring
 * at a tick to every single decision, which is precisely the wall this work
 * removes.
 */
import { parseAction } from "./actions";
import type { HandEvent } from "./timeline";

export type SeatId = "hero" | "villain";

/** Durations in one place, so pacing can be retuned in a single edit. */
export const BEAT_MS = {
  board: 350,
  think: 400,
  chips: 300,
  showdown: 400,
  potPush: 500,
} as const;

export type Beat =
  | { kind: "board"; card: string; ms: number }
  | { kind: "think"; seat: SeatId; ms: number }
  | { kind: "chips"; seat: SeatId; chips: number; ms: number }
  | { kind: "showdown"; ms: number }
  | { kind: "pot-push"; ms: number };

/**
 * How many chips this action actually moves.
 *
 * Action codes carry the wager TARGET for the street, not the increment, so a
 * call of a 27 bet is "C" and a raise over it is "R90" — both have to be
 * turned into "how much slides into the pot right now" against what this seat
 * already has in. Getting this wrong double-counts the pot on every raise.
 */
function wager(code: string, mine: number, theirs: number): number {
  const info = parseAction(code);
  switch (info.kind) {
    case "check":
    case "fold":
      return 0;
    case "call":
      return Math.max(0, theirs - mine);
    case "bet":
    case "raise":
    case "allin":
      return Math.max(0, info.to! - mine);
  }
}

export function beatsFor(events: readonly HandEvent[], hero: 0 | 1): Beat[] {
  const beats: Beat[] = [];
  // Street wagers, indexed [OOP, IP] to match PlayNode.tb.
  let wagered: [number, number] = [0, 0];
  const villainIndex = hero === 0 ? 1 : 0;

  const push = (seatIndex: 0 | 1, seat: SeatId, code: string) => {
    const other = seatIndex === 0 ? 1 : 0;
    const amount = wager(code, wagered[seatIndex], wagered[other]);
    if (amount <= 0) return;
    wagered[seatIndex] += amount;
    beats.push({ kind: "chips", seat, chips: amount, ms: BEAT_MS.chips });
  };

  for (const event of events) {
    switch (event.type) {
      case "card":
        beats.push({ kind: "board", card: event.card, ms: BEAT_MS.board });
        wagered = [0, 0]; // a new street resets both wagers
        break;
      case "bot":
        beats.push({ kind: "think", seat: "villain", ms: BEAT_MS.think });
        push(villainIndex, "villain", event.code);
        break;
      case "decision":
        // An unanswered decision is where playback stops — emit nothing.
        if (event.chosen === undefined) break;
        push(hero, "hero", event.node.a[event.chosen]);
        break;
      case "end":
        if (event.end.k === "sd") {
          beats.push({ kind: "showdown", ms: BEAT_MS.showdown });
        }
        beats.push({ kind: "pot-push", ms: BEAT_MS.potPush });
        break;
    }
  }
  return beats;
}
