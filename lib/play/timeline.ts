/**
 * The play-mode hand state machine, as a pure function: given an instance
 * and the hero's chosen action indices so far, produce the ordered list of
 * everything that has happened. The UI replays newly appended events with
 * delays and stops at the trailing decision (or end).
 *
 * Pure and total on valid input: no React, no time, no randomness — this is
 * what makes the play mode unit-testable the same way the drill generators
 * are.
 */
import { parseCard, type Card } from "../poker/engine";
import type { PlayEnd, PlayInstance, PlayNode, PlayStep } from "./types";

export type HandEvent =
  | { type: "card"; card: string }
  | { type: "bot"; code: string }
  /** Hero already answered this decision (chosen is set) or is facing it. */
  | { type: "decision"; key: string; node: PlayNode; chosen?: number }
  | { type: "end"; key: string; end: PlayEnd };

export const pathKey = (path: readonly number[]): string => path.join(".");

/** Hero's hole cards, e.g. "7h7d" → engine cards. */
export function holeCards(hand: string): [Card, Card] {
  if (hand.length !== 4) throw new Error(`bad hand: ${hand}`);
  return [parseCard(hand.slice(0, 2)), parseCard(hand.slice(2))];
}

function stepEvents(steps: PlayStep[]): HandEvent[] {
  return steps.map((s) =>
    s.t === "c" ? { type: "card", card: s.v } : { type: "bot", code: s.v }
  );
}

/**
 * Build the full event list for a hero action sequence. Throws on a path
 * that does not exist in the instance — that is a caller bug, not a data
 * state.
 */
export function timeline(inst: PlayInstance, chosen: readonly number[]): HandEvent[] {
  const events: HandEvent[] = [];
  const path: number[] = [];

  for (let i = 0; i <= chosen.length; i++) {
    const key = pathKey(path);
    const node = inst.nodes[key];
    if (node) {
      events.push(...stepEvents(node.pre));
      events.push({ type: "decision", key, node, chosen: chosen[i] });
      if (i < chosen.length) {
        if (chosen[i] < 0 || chosen[i] >= node.a.length) {
          throw new Error(`timeline: bad action ${chosen[i]} at "${key}"`);
        }
        path.push(chosen[i]);
        continue;
      }
      return events; // trailing decision, awaiting the hero
    }
    const end = inst.ends[key];
    if (end) {
      if (i < chosen.length) throw new Error(`timeline: actions past end "${key}"`);
      events.push(...stepEvents(end.pre));
      events.push({ type: "end", key, end });
      return events;
    }
    throw new Error(`timeline: no node or end at "${key}"`);
  }
  /* unreachable */
  return events;
}

/** The board cards visible after the given events (flop + dealt cards). */
export function boardFrom(flop: string, events: readonly HandEvent[]): Card[] {
  const board: Card[] = [];
  for (let i = 0; i < flop.length; i += 2) board.push(parseCard(flop.slice(i, i + 2)));
  for (const e of events) if (e.type === "card") board.push(parseCard(e.card));
  return board;
}

/** Total pot (starting pot plus both players' wagers). */
export const potAfter = (startPot: number, tb: readonly [number, number]): number =>
  startPot + tb[0] + tb[1];

/** What hero must add to continue at this node. Zero when checked to. */
export const toCallAt = (node: PlayNode, hero: 0 | 1): number =>
  Math.max(0, node.tb[hero === 0 ? 1 : 0] - node.tb[hero]);

/** True when the last event is a decision still waiting on the hero. */
export function awaitingHero(events: readonly HandEvent[]): boolean {
  const last = events[events.length - 1];
  return last?.type === "decision" && last.chosen === undefined;
}

/** The hand is over when the last event is an end. */
export function handOver(events: readonly HandEvent[]): boolean {
  return events[events.length - 1]?.type === "end";
}
