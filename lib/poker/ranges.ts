/**
 * Preflop range charts — 6-max, 100bb, 2.5bb opens.
 *
 * IMPORTANT, and say this in the UI: these are standard reference ranges in the
 * shape solvers produce. They are NOT live solver output. Real solutions shift
 * with rake, stack depth, open size and table dynamics. They are accurate enough
 * to build correct instincts and to drill against, and the computed percentages
 * (see rangePercent) land where published 6-max ranges land.
 *
 * Frequencies between 0 and 1 mean the hand is played as a mix.
 */

export const GRID_RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
export const RANK_VALUE: Record<string, number> = {
  A: 14, K: 13, Q: 12, J: 11, T: 10, "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2,
};

export type Action = "r" | "c" | "f"; // raise/3-bet, call, fold

/** Grid cell -> hand string. Suited above the diagonal, offsuit below, pairs on it. */
export function handAt(row: number, col: number): string {
  if (row === col) return GRID_RANKS[row] + GRID_RANKS[row];
  return row < col
    ? GRID_RANKS[row] + GRID_RANKS[col] + "s"
    : GRID_RANKS[col] + GRID_RANKS[row] + "o";
}

export const combosOf = (hand: string): number =>
  hand.length === 2 ? 6 : hand[2] === "s" ? 4 : 12;

/**
 * A range is expressed as thresholds plus explicit mixes, which is far more
 * maintainable than listing 169 cells:
 *   pairsFrom  - lowest pair rank played purely (7 => 77+)
 *   suited     - high card -> minimum kicker rank  ({ A: 2 } => A2s+)
 *   offsuit    - same, for offsuit hands
 *   mix        - explicit frequency for named hands, overrides everything
 */
export interface RangeSpec {
  pairsFrom?: number;
  suited?: Record<string, number>;
  offsuit?: Record<string, number>;
  mix?: Record<string, number>;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** Action keys present, in display order. */
  actions: Array<[Action, string]>;
  r: RangeSpec;
  c?: RangeSpec;
}

function specFrequency(spec: RangeSpec | undefined, hand: string): number {
  if (!spec) return 0;
  if (spec.mix && spec.mix[hand] != null) return spec.mix[hand];
  const hi = RANK_VALUE[hand[0]], lo = RANK_VALUE[hand[1]];
  const kind = hand.length === 2 ? "p" : hand[2];
  if (kind === "p") return spec.pairsFrom != null && hi >= spec.pairsFrom ? 1 : 0;
  const table = kind === "s" ? spec.suited : spec.offsuit;
  if (!table) return 0;
  const min = table[GRID_RANKS[14 - hi]];
  return min != null && lo >= min ? 1 : 0;
}

export interface CellFrequency { r: number; c: number; f: number }

/** Frequencies for one hand in one scenario. Always sums to 1. */
export function cellFrequency(scenario: Scenario, hand: string): CellFrequency {
  const r = specFrequency(scenario.r, hand);
  let c = scenario.c ? specFrequency(scenario.c, hand) : 0;
  if (r + c > 1) c = Math.max(0, 1 - r);
  return { r, c, f: Math.max(0, 1 - r - c) };
}

/** Percentage of all 1326 starting combos taking a given action. */
export function rangePercent(scenario: Scenario, action: Action): number {
  let combos = 0;
  for (let i = 0; i < 13; i++)
    for (let j = 0; j < 13; j++) {
      const hand = handAt(i, j);
      combos += cellFrequency(scenario, hand)[action] * combosOf(hand);
    }
  return (combos / 1326) * 100;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "utg", name: "UTG open",
    description: "First in from under the gun, 6-max, 100bb.",
    actions: [["r", "Raise"], ["f", "Fold"]],
    r: {
      pairsFrom: 5,
      suited: { A: 2, K: 9, Q: 9, J: 9, T: 8, "9": 7, "8": 7 },
      offsuit: { A: 11, K: 12 },
      mix: { "44": 0.5, "33": 0.5, "22": 0.5, ATo: 0.5, "76s": 0.4, A2s: 0.6, A3s: 0.6 },
    },
  },
  {
    id: "hj", name: "HJ open",
    description: "First in from the hijack.",
    actions: [["r", "Raise"], ["f", "Fold"]],
    r: {
      pairsFrom: 3,
      suited: { A: 2, K: 8, Q: 8, J: 8, T: 7, "9": 6, "8": 6, "7": 5, "6": 5 },
      offsuit: { A: 10, K: 11, Q: 11 },
      mix: { "22": 0.5, "65s": 0.6, A9o: 0.4 },
    },
  },
  {
    id: "co", name: "CO open",
    description: "First in from the cutoff.",
    actions: [["r", "Raise"], ["f", "Fold"]],
    r: {
      pairsFrom: 2,
      suited: { A: 2, K: 5, Q: 7, J: 7, T: 6, "9": 5, "8": 5, "7": 5, "6": 4, "5": 4 },
      offsuit: { A: 9, K: 10, Q: 10, J: 10 },
      mix: { "54s": 0.6, A8o: 0.5, J9o: 0.4 },
    },
  },
  {
    id: "btn", name: "BTN open",
    description: "First in on the button — the widest opening range in the game.",
    actions: [["r", "Raise"], ["f", "Fold"]],
    r: {
      pairsFrom: 2,
      suited: { A: 2, K: 2, Q: 2, J: 4, T: 5, "9": 4, "8": 4, "7": 4, "6": 3, "5": 3, "4": 3 },
      offsuit: { A: 2, K: 7, Q: 9, J: 9, T: 9 },
      mix: { A2o: 0.6, A3o: 0.6, A4o: 0.6, "98o": 0.5, K7o: 0.5, Q9o: 0.6, "43s": 0.5 },
    },
  },
  {
    id: "sb", name: "SB open",
    description: "Small blind, raise-or-fold (no limping).",
    actions: [["r", "Raise"], ["f", "Fold"]],
    r: {
      pairsFrom: 2,
      suited: { A: 2, K: 2, Q: 4, J: 5, T: 6, "9": 5, "8": 5, "7": 5, "6": 4, "5": 4 },
      offsuit: { A: 2, K: 9, Q: 9, J: 9, T: 9 },
      mix: { A2o: 0.5, A3o: 0.5, A4o: 0.5, A5o: 0.5, T9o: 0.5 },
    },
  },
  {
    id: "bb-btn", name: "BB vs BTN open",
    description: "Defending the big blind against a button steal. You are getting a great price, so you defend very wide.",
    actions: [["r", "3-bet"], ["c", "Call"], ["f", "Fold"]],
    r: {
      pairsFrom: 9,
      suited: { A: 10, K: 11, Q: 11 },
      offsuit: { A: 11, K: 12 },
      mix: {
        "88": 0.5, "77": 0.4, A5s: 0.8, A4s: 0.7, A3s: 0.6, A2s: 0.5, K9s: 0.4, K8s: 0.3,
        Q9s: 0.3, J9s: 0.35, JTs: 0.3, QTs: 0.3, T9s: 0.4, "98s": 0.35, "87s": 0.35,
        "76s": 0.35, "65s": 0.35, "54s": 0.3, KJo: 0.3, QJo: 0.2, ATo: 0.3, KQo: 0.45, AJo: 0.6,
      },
    },
    c: {
      pairsFrom: 2,
      suited: { A: 2, K: 2, Q: 2, J: 2, T: 4, "9": 4, "8": 4, "7": 3, "6": 3, "5": 3, "4": 2, "3": 2 },
      offsuit: { A: 2, K: 5, Q: 7, J: 8, T: 7, "9": 6, "8": 6, "7": 6, "6": 5 },
    },
  },
  {
    id: "bb-utg", name: "BB vs UTG open",
    description: "Defending against the tightest opening range — fold far more than you do against the button.",
    actions: [["r", "3-bet"], ["c", "Call"], ["f", "Fold"]],
    r: {
      pairsFrom: 10,
      suited: { A: 12, K: 12 },
      offsuit: { A: 13 },
      mix: { "99": 0.5, "88": 0.25, A5s: 0.6, A4s: 0.4, KJs: 0.3, AQo: 0.4 },
    },
    c: {
      pairsFrom: 2,
      suited: { A: 5, K: 8, Q: 8, J: 8, T: 7, "9": 7, "8": 6, "7": 6, "6": 5 },
      offsuit: { A: 10, K: 10, Q: 11, J: 11 },
    },
  },
  {
    id: "btn-co", name: "BTN vs CO open",
    description: "In position against a cutoff open. You can call wide because you have position all hand.",
    actions: [["r", "3-bet"], ["c", "Call"], ["f", "Fold"]],
    r: {
      pairsFrom: 12,
      suited: { A: 12, K: 12 },
      offsuit: { A: 13 },
      mix: {
        JJ: 0.6, TT: 0.4, AJs: 0.5, KJs: 0.4, QJs: 0.3, KTs: 0.3, A5s: 0.7, A4s: 0.6,
        A3s: 0.5, A2s: 0.4, K9s: 0.4, KQs: 0.5, QTs: 0.3, JTs: 0.3, T9s: 0.35, "98s": 0.3,
        "87s": 0.35, "76s": 0.35, "65s": 0.3, "54s": 0.25, AQo: 0.4, KQo: 0.2,
      },
    },
    c: {
      pairsFrom: 2,
      suited: { A: 4, K: 7, Q: 7, J: 7, T: 6, "9": 6, "8": 5, "7": 5, "6": 5 },
      offsuit: { A: 9, K: 10, Q: 10, J: 10, T: 9 },
    },
  },
];

export const getScenario = (id: string): Scenario | undefined =>
  SCENARIOS.find((s) => s.id === id);

/**
 * Deal concrete cards for a grid hand, so the UI can render real card faces.
 *
 * The suit shuffle is Fisher-Yates rather than `[0,1,2,3].sort(() => rng() - 0.5)`.
 * A random comparator is not a uniform shuffle, and worse here, the number of
 * rng draws it consumes depends on the values drawn — 3, 5 or 6 for this array.
 * The drill page renders on the server and hydrates on the client, and Node's
 * V8 and Chrome's V8 need not order sort comparisons identically, so the two
 * consumed the seeded stream differently: React reported a hydration mismatch
 * on the preflop tab (server "♣", client "♠") and every later rng() call was
 * shifted as well. Fisher-Yates over 4 elements is always exactly 3 draws.
 * See lib/poker/ranges.test.ts.
 */
export function dealGridHand(hand: string, rng: () => number = Math.random): [number, number] {
  const hi = RANK_VALUE[hand[0]], lo = RANK_VALUE[hand[1]];
  const kind = hand.length === 2 ? "p" : hand[2];
  const suits = [0, 1, 2, 3];
  for (let i = suits.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [suits[i], suits[j]] = [suits[j], suits[i]];
  }
  if (kind === "p") return [(hi - 2) * 4 + suits[0], (hi - 2) * 4 + suits[1]];
  if (kind === "s") return [(hi - 2) * 4 + suits[0], (lo - 2) * 4 + suits[0]];
  return [(hi - 2) * 4 + suits[0], (lo - 2) * 4 + suits[1]];
}
