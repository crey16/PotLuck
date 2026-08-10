/**
 * The practice configuration and what the shipped solve pack can actually
 * honour — M10A / M8.7B.
 *
 * `/play` used to load `srp-btn-bb` the instant the page opened, with nothing
 * chooseable. This module is the setup state's model: the options a player
 * may pick, which of them the current pack supports, and — for every one it
 * does not — **the reason, in the player's language**.
 *
 * ## The rule this file exists to enforce
 *
 * An unsupported option is never offered and then quietly substituted. That
 * is the failure a trainer must not have: it tells the player they practised
 * something they did not.
 *
 * So `SUPPORT` below is deliberately written as "every option that exists,
 * each with its availability", not as "the options that work". It is the
 * MODEL, and it stays complete: `validateConfig` refuses anything unavailable
 * however the configuration was arrived at, and this table is where an option
 * flips on once its data exists.
 *
 * ## What the model does NOT decide: whether an option is drawn
 *
 * The setup screen used to render every option, striking through the
 * unavailable ones with the reason underneath. That is now a **presentation**
 * decision and the answer is no — an unbuilt feature is not advertised to
 * players. `availableOptions()` and `isChoosable()` below are what the screen
 * asks; `SUPPORT` is what the validator asks. Keeping them separate is the
 * point: hiding an option must never be able to make an invalid configuration
 * startable, and the tests check both halves.
 *
 * **Reasons are still required and still have to be true.** They are what
 * `validateConfig` reports, what a disabled seat carries, and what stops an
 * option being marked available before its data lands. They are written in
 * the player's language and carry no internal milestone codes — a roadmap
 * ticket in a product string is a leak, not an explanation.
 *
 * ## Why so little is available today
 *
 * One pack ships: `potluck:m6:srp-btn-bb:v1`. It is 6-max, 100bb, BTN opens
 * 2.5bb and BB calls, played to the river. Everything else in the vocabulary
 * below is a real product option with no data behind it yet.
 */

export type TableSize = 2 | 6 | 9;

export type Position = "UTG" | "HJ" | "CO" | "BTN" | "SB" | "BB";

/** 6-max seat order — the sequence they act in. */
export const SIX_MAX_POSITIONS: Position[] = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];

export type ActionFamily =
  | "single_raised_pot"
  | "three_bet"
  | "four_bet"
  | "squeeze"
  | "limped"
  | "isolate";

/** How far a hand runs before the next one is dealt (M8.7C). */
export type StoppingPoint = "preflop" | "flop" | "turn" | "river";

/**
 * Effective stack, in big blinds — M8.7E.
 *
 * The shallow end is not a smaller version of the deep end: below about 20bb
 * the tree collapses to jam-or-fold, which is a different game with its own
 * solved equilibrium (`lib/pushfold`). Both live on one axis here because
 * they are one axis to a player, and because the roadmap's point is that a
 * push/fold session should be a CONFIGURATION of practice rather than a
 * separate product.
 */
export type StackDepth = 10 | 15 | 20 | 100;

export const STACK_DEPTHS: StackDepth[] = [10, 15, 20, 100];

export interface PracticeConfig {
  tableSize: TableSize;
  heroPosition: Position;
  actionFamily: ActionFamily;
  stoppingPoint: StoppingPoint;
  stackDepth: StackDepth;
}

/** The configuration `/play` has been hard-coded to since M6. */
export const DEFAULT_CONFIG: PracticeConfig = {
  tableSize: 6,
  heroPosition: "BTN",
  actionFamily: "single_raised_pot",
  stoppingPoint: "river",
  stackDepth: 100,
};

export interface Availability {
  available: boolean;
  /**
   * Why not — shown on the control itself. Required whenever `available` is
   * false: an option disabled without a reason is indistinguishable from a
   * bug, and this is the field the tests below insist on.
   */
  reason?: string;
}

const YES: Availability = { available: true };
const no = (reason: string): Availability => ({ available: false, reason });

/**
 * Which options the currently published pack supports.
 *
 * Every reason names the milestone that unblocks it, so the setup screen is
 * also an honest statement of what the product does not do yet — which is
 * what the roadmap requires wherever PotLuck says "GTO".
 */
export const SUPPORT = {
  tableSize: {
    6: YES,
    2: no("Heads-up is a different game, not 6-max with seats removed — it needs its own solves."),
    9: no("Full ring has the largest preflop tree and has not been solved yet."),
  } as Record<TableSize, Availability>,

  heroPosition: {
    BTN: YES,
    BB: YES,
    UTG: no("Only the BTN-versus-BB matchup is solved so far."),
    HJ: no("Only the BTN-versus-BB matchup is solved so far."),
    CO: no("Only the BTN-versus-BB matchup is solved so far."),
    SB: no("Only the BTN-versus-BB matchup is solved so far."),
  } as Record<Position, Availability>,

  actionFamily: {
    single_raised_pot: YES,
    three_bet: no("No 3-bet pot solves are published yet."),
    four_bet: no("No 4-bet pot solves are published yet."),
    // These three are not "not yet" — the M8.7A scope prunes the tree to
    // heads-up, so they are outside the solved game by design and saying
    // "coming soon" would be untrue.
    squeeze: no("Squeezes end multiway, which the pruned heads-up solve does not model at all."),
    limped: no("Limped pots end multiway, which the pruned heads-up solve does not model at all."),
    isolate: no("Isolation raises end multiway, which the pruned heads-up solve does not model at all."),
  } as Record<ActionFamily, Availability>,

  // All four ship as of M8.7C. Two things had to be true first, and both now
  // are. Preflop had to be graded from real solver EVs (M8.7A), or a
  // preflop-only session would be "a guess with a confident face on it". And
  // the server had to be able to record a stopped hand as COMPLETE rather
  // than abandoned — completion used to mean "the solve branch ended", and an
  // abandoned hand is excluded from every M11 coaching aggregate, which for a
  // deliberate preflop-only rep is exactly backwards.
  stoppingPoint: {
    preflop: YES,
    flop: YES,
    turn: YES,
    river: YES,
  } as Record<StoppingPoint, Availability>,

  /**
   * The shallow depths ARE solved — `solver/pack/pushfold/` covers every
   * position from 5bb to 20bb, and they are trainable today in the Short
   * stack drill and readable on /ranges. What is not built is playing them
   * HERE, which needs a second hand source and its own immutable pack row in
   * the M8 play lifecycle: a jam-or-fold hand has no scripted postflop
   * instance to reference, and `play_hands.source_hand_id` must name one.
   *
   * The reason says where the data actually is, rather than implying it does
   * not exist. An option disabled with a reason that reads "coming soon" when
   * the feature is already shipped elsewhere sends the player away from the
   * thing they were looking for.
   */
  stackDepth: {
    100: YES,
    10: no("Solved and trainable now — in the Short stack drill and on /ranges. Playing full hands at this depth needs its own hand source here."),
    15: no("Solved and trainable now — in the Short stack drill and on /ranges. Playing full hands at this depth needs its own hand source here."),
    20: no("Solved and trainable now — in the Short stack drill and on /ranges. Playing full hands at this depth needs its own hand source here."),
  } as Record<StackDepth, Availability>,
} as const;

/**
 * The options a control should actually draw.
 *
 * Presentation only — `validateConfig` still consults `SUPPORT` and still
 * refuses everything unavailable, so a configuration cannot become startable
 * by virtue of an option being hidden. `setup.test.ts` asserts exactly that.
 */
export function availableOptions<T extends string | number>(
  options: readonly T[],
  support: Record<T, Availability>
): T[] {
  return options.filter((option) => support[option]?.available);
}

/**
 * Whether an axis is worth showing at all.
 *
 * A control offering ONE choice is not a choice — it is a label pretending to
 * be a control, and with today's pack that is what "Table size", "Preflop
 * action" and "Effective stack" would each become once the unbuilt options
 * stop being drawn. The single surviving value is not lost: it is stated as
 * fact in the Solve assumptions panel, which is the honest place for it.
 */
export function isChoosable<T extends string | number>(
  options: readonly T[],
  support: Record<T, Availability>
): boolean {
  return availableOptions(options, support).length > 1;
}

export const TABLE_SIZE_LABEL: Record<TableSize, string> = {
  2: "Heads-up",
  6: "6-max",
  9: "Full ring",
};

export const ACTION_FAMILY_LABEL: Record<ActionFamily, string> = {
  single_raised_pot: "Single-raised pot",
  three_bet: "3-bet pot",
  four_bet: "4-bet pot",
  squeeze: "Squeeze",
  limped: "Limped pot",
  isolate: "Isolation raise",
};

/** In the order a hand passes them. */
export const STOPPING_POINTS: StoppingPoint[] = ["preflop", "flop", "turn", "river"];

/**
 * The stopping point in a solve node's own `st` numbering — 0 flop, 1 turn,
 * 2 river. Preflop is **-1**, because the pack numbers only the postflop
 * streets and preflop sits before all of them.
 *
 * Keep identical to `stopping_street_index` in api/play_solver.py: the server
 * decides whether a hand may be recorded as complete with this arithmetic, so
 * a client that disagreed would offer a hand the server then refuses.
 */
export const stoppingStreetIndex = (point: StoppingPoint): number =>
  STOPPING_POINTS.indexOf(point) - 1;

export const STACK_DEPTH_LABEL: Record<StackDepth, string> = {
  10: "10bb — jam or fold",
  15: "15bb — jam or fold",
  20: "20bb — jam or fold",
  100: "100bb — full tree",
};

export const STOPPING_POINT_LABEL: Record<StoppingPoint, string> = {
  preflop: "Preflop only",
  flop: "Through the flop",
  turn: "Through the turn",
  river: "Full hand",
};

export interface ConfigValidation {
  ok: boolean;
  /** One line per unsupported choice, in the order the controls appear. */
  problems: string[];
}

/**
 * Whether a configuration can start, and if not, why.
 *
 * Every problem names the field AND its reason. "Start training" being
 * greyed out with no explanation is the thing this returns instead of.
 */
export function validateConfig(config: PracticeConfig): ConfigValidation {
  const problems: string[] = [];
  const check = (label: string, availability: Availability) => {
    if (!availability.available) {
      problems.push(`${label}: ${availability.reason ?? "not supported."}`);
    }
  };

  check(TABLE_SIZE_LABEL[config.tableSize], SUPPORT.tableSize[config.tableSize]);
  check(config.heroPosition, SUPPORT.heroPosition[config.heroPosition]);
  check(ACTION_FAMILY_LABEL[config.actionFamily], SUPPORT.actionFamily[config.actionFamily]);
  check(STOPPING_POINT_LABEL[config.stoppingPoint], SUPPORT.stoppingPoint[config.stoppingPoint]);
  check(STACK_DEPTH_LABEL[config.stackDepth], SUPPORT.stackDepth[config.stackDepth]);

  return { ok: problems.length === 0, problems };
}

/**
 * The assumptions behind the numbers, for display beside the setup.
 *
 * The roadmap requires these on screen so "GTO" is never presented as
 * universal: a solve is an equilibrium of one modelled game, and these lines
 * are that model.
 */
export interface SolveAssumptions {
  packId: string;
  lines: { label: string; value: string }[];
  /** Things the solve deliberately does not cover. */
  limits: string[];
}

export function solveAssumptions(packId: string): SolveAssumptions {
  return {
    packId,
    lines: [
      { label: "Game", value: "6-max cash, chip EV" },
      { label: "Stacks", value: "100bb effective" },
      { label: "Blinds", value: "0.5 / 1bb, no ante" },
      { label: "Rake", value: "None modelled" },
      { label: "Preflop", value: "BTN opens 2.5bb, BB calls or folds" },
      { label: "Postflop sizes", value: "One bet size per street, one raise size, all-in by threshold" },
      { label: "Accuracy", value: "Solved to <0.3% pot exploitability" },
      // The precision of the preflop numbers is part of the model, not a
      // footnote: it is why a marginal preflop choice grades as correct.
      { label: "Preflop precision", value: "EVs averaged over 25 flops, ±0.3bb typical" },
    ],
    limits: [
      // M8.7A retired reference-range preflop grading. What remains true, and
      // is a sharper caveat than the one it replaced: the preflop equilibrium
      // is an equilibrium of a game in which BB cannot 3-bet.
      "The preflop solve prices a tree where BB never 3-bets and the small blind is dead, so its opening range is far wider than a real 6-max button range.",
      "Preflop EVs are averaged over 25 flops. A choice inside that sampling error is graded correct rather than assigned a verdict the data cannot support.",
      "Only one bet size exists per decision, so sizing itself is not trainable here.",
      "Cold-calls, squeezes and limped pots end multiway and are outside the solved game.",
    ],
  };
}

/** Positions the pack can actually deal, for the seat selector. */
export const playablePositions = (): Position[] =>
  SIX_MAX_POSITIONS.filter((p) => SUPPORT.heroPosition[p].available);
