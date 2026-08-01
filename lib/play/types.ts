/**
 * The M6 play-mode data contract — the TypeScript mirror of what
 * solver/src/main.rs exports. One SolveFile per flop, each holding N
 * self-contained "scripted hand" instances: hero hand + bot hand sampled
 * from the solved ranges, hero's full decision tree, bot responses and
 * runout cards pre-sampled per branch.
 *
 * Chips are tenths of a big blind (pot 55 = 5.5bb). Frequencies are u8
 * (0..=255 → 0..=1). EV losses are u8 in 0.05bb steps, clamped at 12.75bb.
 */

/** One scripted step between hero decisions: a bot action or a dealt card. */
export interface PlayStep {
  /** "a" = bot action (action code), "c" = dealt card (e.g. "Qd"). */
  t: "a" | "c";
  v: string;
}

/**
 * Action codes, as the solver labels them: "X" check, "F" fold, "C" call,
 * "B<n>" bet to n, "R<n>" raise to n, "A<n>" all-in for n — n is the wager
 * for the current street, in chips.
 */
export type ActionCode = string;

export interface PlayNode {
  /** Script since the previous hero decision (bot actions, dealt cards). */
  pre: PlayStep[];
  a: ActionCode[];
  /** Solver frequency per action for the hero hand, u8. */
  f: number[];
  /** EV loss vs the best action per action, u8, 0.05bb steps. */
  l: number[];
  /** Chips wagered so far by [OOP, IP], excluding the starting pot. */
  tb: [number, number];
  /** 0 flop, 1 turn, 2 river. */
  st: 0 | 1 | 2;
  /** Hero equity vs the bot's range here, u8. */
  eq: number;
}

export interface PlayEnd {
  pre: PlayStep[];
  tb: [number, number];
  /** "f" hero folded, "bf" bot folded, "sd" showdown. */
  k: "f" | "bf" | "sd";
}

export interface PlayInstance {
  /** 0 = hero is OOP (BB), 1 = hero is IP (BTN). */
  hero: 0 | 1;
  /** Hero hand, e.g. "7h7d". */
  hand: string;
  /** Bot hand — revealed only at showdown. */
  bot: string;
  /** Hero decision nodes keyed by hero action path: "" / "1" / "1.0" ... */
  nodes: Record<string, PlayNode>;
  /** Terminal scripts keyed by the hero action path that ends the hand. */
  ends: Record<string, PlayEnd>;
}

export interface SolveFile {
  spot: string;
  flop: string;
  pot: number;
  stack: number;
  instances: PlayInstance[];
}

/** public/solves/<spot>/index.json */
export interface SolveManifest {
  spot: string;
  pot: number;
  stack: number;
  flops: { flop: string; instances: number }[];
}
