/**
 * The pruned 6-max preflop tree.
 *
 * One definition of the game, used by the CFR solver, the payoff code and the
 * pack exporter. See docs/14-m87a-solver-scope.md for why it is pruned.
 *
 * PRUNING RULE: no overcalls. Once a player calls, the betting is closed and
 * the hand goes heads-up (or ends). This is what makes every postflop
 * continuation a two-player game the existing engine can solve — and it is
 * also what removes cold-calls, squeezes and limped pots from the product.
 *
 * SIZINGS (one per level, matching gen-subgames.ts):
 *   open  2.5bb
 *   3-bet 3x the open in position, 4x out of position
 *   4-bet ALL-IN — so a called 4-bet never sees a flop
 *
 * UNITS: chips, 10 = 1bb. Stacks start at 1000 (100bb); SB posts 5, BB 10.
 */

export const POS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"] as const;
export type Pos = (typeof POS)[number];

export const START_STACK = 1000;
export const POSTED: Record<Pos, number> = {
  UTG: 0, HJ: 0, CO: 0, BTN: 0, SB: 5, BB: 10,
};
export const OPEN = 25;

export type Action = "f" | "c" | "r";

/**
 * Postflop acting order — NOT the preflop one.
 *
 * Preflop the blinds act last; postflop they act FIRST. So SB and BB are out
 * of position against everyone despite acting late preflop. Using the preflop
 * seat order here silently labels every blind-vs-late-position subgame the
 * wrong way round, which swaps the two ranges in the solve.
 */
export const POSTFLOP_ORDER = ["SB", "BB", "UTG", "HJ", "CO", "BTN"] as const;

export const isInPosition = (a: Pos, b: Pos): boolean =>
  POSTFLOP_ORDER.indexOf(a) > POSTFLOP_ORDER.indexOf(b);

/** The raise size at a given level, given who is raising over whom. */
export function raiseTo(level: number, raiser: Pos, over: Pos): number {
  if (level === 0) return OPEN;
  if (level === 1) return isInPosition(raiser, over) ? OPEN * 3 : OPEN * 4;
  return START_STACK; // the 4-bet is all-in
}

export type TerminalKind =
  | "walk"      // everyone folded to the BB
  | "uncontested" // someone bet and everyone folded
  | "postflop"  // called at level 1 or 2 — a solvable two-player subgame
  | "allin";    // a called 4-bet — decided by equity, never sees a decision

export interface Terminal {
  kind: TerminalKind;
  /** Chips each player has put in when the hand ends. */
  contrib: Record<Pos, number>;
  /** Players still contesting the pot (1 for uncontested/walk, 2 otherwise). */
  live: Pos[];
  /** For `postflop`: which subgame config solves it. */
  subgame?: string;
  /** For `postflop`/`allin`: who is out of position. */
  oop?: Pos;
  ip?: Pos;
}

export interface DecisionNode {
  kind: "decision";
  id: number;
  actor: Pos;
  level: number;
  /** The action history that identifies this information set. */
  history: string;
  actions: Action[];
  children: Record<string, number>;
}

export interface TerminalNode {
  kind: "terminal";
  id: number;
  history: string;
  terminal: Terminal;
}

export type Node = DecisionNode | TerminalNode;

export interface Tree {
  nodes: Node[];
  root: number;
  /** Every distinct postflop subgame the tree can reach. */
  subgames: Set<string>;
}

interface State {
  history: string;
  /** Players who have not folded, in seat order. */
  alive: Pos[];
  level: number;
  contrib: Record<Pos, number>;
  /** Index into `alive` of whoever acts next. */
  turn: number;
  /** Who made the last raise (null before any raise). */
  aggressor: Pos | null;
  /** How many players still owe a response to the current level. */
  toAct: number;
  /**
   * Who has already called the current raise, if anyone.
   *
   * THE PRUNING RULE, stated exactly: at most ONE caller per raise level.
   * A call does not close the action — players behind still act — but they
   * may only fold or raise, never overcall. So a pot reaches the flop with
   * exactly the raiser and one caller, while still allowing the ordinary
   * "CO opens, BTN calls, blinds fold" line that a stricter rule would
   * wrongly forbid.
   */
  called: Pos | null;
}

export function buildTree(): Tree {
  const nodes: Node[] = [];

  const terminal = (s: State, t: Terminal): number => {
    const id = nodes.length;
    nodes.push({ kind: "terminal", id, history: s.history, terminal: t });
    return id;
  };

  /**
   * A subgame's identity is what the postflop solver actually needs: who is
   * out of position, who is in, and how much money is in front of them.
   *
   * Naming it `l{level}-{aggressor}-{caller}` was not specific enough. BB
   * 3-betting SB's open (pot 150, stack 925) and BB 3-betting UTG's open which
   * SB then calls (pot 225, stack 900 — UTG's 25 is dead) are both "l2-bb-sb"
   * under that scheme, and they are different games. Collapsing them would
   * have solved one and graded both against it.
   */
  function subgameName(
    level: number, oop: Pos, ip: Pos, pot: number, stack: number,
  ): string {
    return `l${level}-${oop}-${ip}-p${pot}-s${stack}`.toLowerCase();
  }

  function close(s: State): number {
    // Betting is closed. Who is left, and how did it end?
    if (s.alive.length === 1) {
      return terminal(s, {
        kind: s.level === 0 ? "walk" : "uncontested",
        contrib: s.contrib,
        live: [...s.alive],
      });
    }
    const [a, b] = s.alive;
    const ip = isInPosition(a, b) ? a : b;
    const oop = ip === a ? b : a;
    if (s.level >= 3) {
      return terminal(s, { kind: "allin", contrib: s.contrib, live: [a, b], oop, ip });
    }
    const pot = POS.reduce((sum, p) => sum + s.contrib[p], 0);
    const stack = START_STACK - s.contrib[a];
    return terminal(s, {
      kind: "postflop",
      contrib: s.contrib,
      live: [a, b],
      subgame: subgameName(s.level, oop, ip, pot, stack),
      oop,
      ip,
    });
  }

  function walk(s: State): number {
    if (s.alive.length === 1 || s.toAct <= 0) return close(s);

    const actor = s.alive[s.turn % s.alive.length];
    const owed = Math.max(...POS.map((p) => s.contrib[p])) - s.contrib[actor];

    const actions: Action[] = [];
    // Fold is only meaningful when facing a bet.
    if (owed > 0) actions.push("f");
    // NO LIMPING. At level 0 the only "c" available is the BB checking its
    // option (owed === 0); everyone else must fold or raise. Allowing a limp
    // reopens exactly what the pruning exists to prevent — limped pots are
    // almost always multiway, and they also create level-0 "subgames" with no
    // aggressor, which nothing downstream can name or solve.
    //
    // NO COLD-CALLS EITHER. Facing a raise, calling is only legal when it
    // leaves exactly the caller and the aggressor — i.e. everyone else has
    // already folded. Without this, a player can flat a 3-bet while the
    // original opener is still live and yet to act, and the hand is
    // three-handed with money in from all three. The earlier version closed
    // such a pot as heads-up and silently DROPPED the opener along with their
    // chips, which is both a multiway pot in disguise and a hole in the
    // accounting. This is the pruning rule stated precisely.
    if (s.level === 0 ? owed === 0 : s.called === null) actions.push("c");
    if (s.level < 3) actions.push("r");

    const id = nodes.length;
    const node: DecisionNode = {
      kind: "decision",
      id,
      actor,
      level: s.level,
      history: s.history,
      actions,
      children: {},
    };
    nodes.push(node);

    for (const a of actions) {
      const contrib = { ...s.contrib };
      const hist = `${s.history}${s.history ? "," : ""}${actor}:${a}`;

      if (a === "f") {
        const alive = s.alive.filter((p) => p !== actor);
        // PRUNING: with one player left the hand is over.
        const idx = s.turn % s.alive.length;
        node.children[a] = walk({
          ...s,
          history: hist,
          alive,
          contrib,
          turn: idx % Math.max(alive.length, 1),
          toAct: s.toAct - 1,
        });
      } else if (a === "c") {
        contrib[actor] = contrib[actor] + owed;
        if (s.level === 0) {
          // The BB checking its option ends the preflop round.
          node.children[a] = walk({
            ...s, history: hist, contrib, turn: s.turn + 1, toAct: 0,
          });
        } else {
          // The call is recorded; players behind still act, but may now only
          // fold or raise. That keeps the pot heads-up without forbidding the
          // ordinary "open, call, blinds fold" line.
          node.children[a] = walk({
            ...s,
            history: hist,
            contrib,
            called: actor,
            turn: s.turn + 1,
            toAct: s.toAct - 1,
          });
        }
      } else {
        const over = s.aggressor ?? actor;
        const to = Math.min(raiseTo(s.level, actor, over), START_STACK);
        contrib[actor] = to;
        node.children[a] = walk({
          ...s,
          history: hist,
          contrib,
          level: s.level + 1,
          aggressor: actor,
          called: null,
          turn: s.turn + 1,
          toAct: s.alive.length - 1,
        });
      }
    }
    return id;
  }

  const root = walk({
    history: "",
    alive: [...POS],
    level: 0,
    contrib: { ...POSTED },
    turn: 0,
    aggressor: null,
    toAct: POS.length,
    called: null,
  });

  const subgames = new Set<string>();
  for (const n of nodes) {
    if (n.kind === "terminal" && n.terminal.subgame) subgames.add(n.terminal.subgame);
  }
  return { nodes, root, subgames };
}

/**
 * Net chips for every player at a terminal, given who wins.
 *
 * `share` is the winning player's share of the pot (1 for an uncontested pot;
 * for a contested one it comes from the postflop EV or the all-in equity).
 * Everything is expressed as net change from the START of the hand, so blinds
 * are already inside `contrib`.
 *
 * The whole table must sum to zero — chips are conserved. `payoffsSumToZero`
 * asserts it, because a sign error here is invisible in the output.
 */
export function payoffs(t: Terminal, winnerShare: Map<Pos, number>): Record<Pos, number> {
  const pot = POS.reduce((s, p) => s + t.contrib[p], 0);
  const out = {} as Record<Pos, number>;
  for (const p of POS) out[p] = -t.contrib[p] + (winnerShare.get(p) ?? 0) * pot;
  return out;
}

export function payoffsSumToZero(v: Record<Pos, number>, eps = 1e-6): boolean {
  return Math.abs(POS.reduce((s, p) => s + v[p], 0)) < eps;
}
