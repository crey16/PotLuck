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
 * An unsupported option is disabled and explained. It is never offered and
 * then quietly substituted, and it is never silently hidden. Those are the
 * two failure modes a trainer must avoid: the first tells the player they
 * practised something they did not, and the second leaves them unable to tell
 * a missing feature from a missing option.
 *
 * So `SUPPORT` below is deliberately written as "every option that exists,
 * each with its availability", not as "the options that work". When M8.7A
 * lands real preflop solver data and M10E widens the postflop catalog, this
 * table is where they become available — and the tests that assert the
 * *reasons* are what stop an option flipping to available before its data
 * exists.
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

export interface PracticeConfig {
  tableSize: TableSize;
  heroPosition: Position;
  actionFamily: ActionFamily;
  stoppingPoint: StoppingPoint;
}

/** The configuration `/play` has been hard-coded to since M6. */
export const DEFAULT_CONFIG: PracticeConfig = {
  tableSize: 6,
  heroPosition: "BTN",
  actionFamily: "single_raised_pot",
  stoppingPoint: "river",
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
    2: no("Heads-up is a different game, not 6-max with seats removed — it needs its own solves (M8.7D)."),
    9: no("Full ring has the largest preflop tree and has not been solved yet (M8.7D)."),
  } as Record<TableSize, Availability>,

  heroPosition: {
    BTN: YES,
    BB: YES,
    UTG: no("Only the BTN-versus-BB matchup is solved so far (M10E)."),
    HJ: no("Only the BTN-versus-BB matchup is solved so far (M10E)."),
    CO: no("Only the BTN-versus-BB matchup is solved so far (M10E)."),
    SB: no("Only the BTN-versus-BB matchup is solved so far (M10E)."),
  } as Record<Position, Availability>,

  actionFamily: {
    single_raised_pot: YES,
    three_bet: no("No 3-bet pot solves are published yet (M10E)."),
    four_bet: no("No 4-bet pot solves are published yet (M10E)."),
    // These three are not "not yet" — the M8.7A scope prunes the tree to
    // heads-up, so they are outside the solved game by design and saying
    // "coming soon" would be untrue.
    squeeze: no("Squeezes end multiway, which the pruned heads-up solve does not model at all."),
    limped: no("Limped pots end multiway, which the pruned heads-up solve does not model at all."),
    isolate: no("Isolation raises end multiway, which the pruned heads-up solve does not model at all."),
  } as Record<ActionFamily, Availability>,

  stoppingPoint: {
    river: YES,
    // Stopping early is not merely unimplemented UI. A hand that stops before
    // its scripted terminal cannot be recorded as complete — the server
    // validates completion by walking the saved branch to a terminal — and a
    // hand that reads as abandoned is excluded from every M11 aggregate.
    // Preflop-only additionally needs real preflop EVs, which do not exist.
    preflop: no("Preflop is graded against reference ranges, not solver EVs, so a preflop-only session cannot be graded honestly (M8.7A)."),
    flop: no("A hand that stops early cannot yet be recorded as complete rather than abandoned (M8.7C)."),
    turn: no("A hand that stops early cannot yet be recorded as complete rather than abandoned (M8.7C)."),
  } as Record<StoppingPoint, Availability>,
} as const;

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
