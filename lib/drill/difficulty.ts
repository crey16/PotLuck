import { DRILL_KINDS, type DrillKind, type DrillLevel } from "./contract";
import type { Grade } from "./grade";

export const WINDOW_SIZE = 10;
export const MIN_SAMPLE = 6;
const PROMOTE_AT = 0.8;
const DEMOTE_BELOW = 0.5;

export type DrillWindows = Record<DrillKind, boolean[]>;

/** One empty rolling window per drill kind. */
export function emptyWindows(): DrillWindows {
  return Object.fromEntries(DRILL_KINDS.map((k) => [k, [] as boolean[]])) as DrillWindows;
}

/** Append a result, keeping only the most recent WINDOW_SIZE. Never mutates. */
export function pushResult(window: boolean[], ok: boolean): boolean[] {
  return [...window, ok].slice(-WINDOW_SIZE);
}

/**
 * The difficulty window's view of one answer, including "Not sure" (M8.5C).
 *
 * An unsure answer leaves the window untouched. That is a deliberate choice
 * between the two obvious alternatives, and both of them are wrong:
 *
 *  - Recording it as a miss treats "I don't know" as a confident error. It
 *    also makes "Not sure" the fastest route to easier questions — six of them
 *    demote a drill a level, which is precisely the farming the M8.5C brief
 *    rules out.
 *  - Recording it as a hit is obviously false.
 *
 * Not recording it at all means an unsure answer can neither promote nor
 * demote: the player stays where they are until they commit to a real answer.
 * The attempt is still stored, still graded a miss for XP and accuracy, and
 * still visible to M11 as its own signal — this function governs difficulty
 * only. `api/index.py`'s DRILL_STATE_SQL applies the same exclusion so a
 * reload reconstructs the same window.
 */
export function pushOutcome(window: boolean[], grade: Grade): boolean[] {
  if (grade === "unsure") return window;
  return pushResult(window, grade !== "wrong");
}

/**
 * Verbatim-semantics port of the reference trainer's `levelFrom()`
 * (poker-math-trainer.html lines 1162-1167), with the window scoped to a
 * single drill kind rather than shared across all of them.
 *
 * Boundaries are as written: exactly 0.80 promotes, exactly 0.50 does not
 * demote. Both are pinned by tests.
 */
export function nextLevel(window: boolean[], current: DrillLevel): DrillLevel {
  const recent = window.slice(-WINDOW_SIZE);
  if (recent.length < MIN_SAMPLE) return current;
  const accuracy = recent.filter(Boolean).length / recent.length;
  if (accuracy >= PROMOTE_AT) return Math.min(3, current + 1) as DrillLevel;
  if (accuracy < DEMOTE_BELOW) return Math.max(1, current - 1) as DrillLevel;
  return current;
}

/**
 * The difficulty a rolling window implies, reconstructed from scratch.
 *
 * `nextLevel` deliberately moves at most one step per answer, so calling it
 * once against a full window cannot express a level the user climbed to over
 * several answers — a perfect last-10 would restore as 2, never 3. Replaying it
 * over growing prefixes reproduces the climb the user actually made.
 */
export function levelFromHistory(window: readonly boolean[]): DrillLevel {
  let level: DrillLevel = 1;
  for (let i = 1; i <= window.length; i++) {
    level = nextLevel(window.slice(0, i), level);
  }
  return level;
}

/**
 * Fold server history into the session's windows, per kind.
 *
 * Seeding is first-paint restoration, not ongoing sync: the server snapshot is
 * a moment in the past, so a kind the user has already answered this session
 * must keep its local window — applying the snapshot there would roll that
 * answer back, and because Score and XP still show it the loss is invisible.
 *
 * The earlier guard was all-or-nothing: a single early answer discarded the
 * seed for all nine kinds, and since the first hand is always a level-1 hand
 * that is instantly answerable while the fetch waits on a session lookup, a
 * cold start and a JWKS fetch, a quick answer could silently pin every drill
 * to level 1 for the whole session. Merging per kind keeps the other eight.
 */
export function mergeSeededWindows(
  seeded: DrillWindows,
  local: DrillWindows,
  answeredKinds: Iterable<DrillKind>
): DrillWindows {
  const keepLocal = new Set(answeredKinds);
  const merged = {} as DrillWindows;
  for (const kind of DRILL_KINDS) {
    merged[kind] = keepLocal.has(kind) ? local[kind] : seeded[kind];
  }
  return merged;
}

/** The level each kind restores to, per `levelFromHistory`, ignoring session state. */
export type Levels = Partial<Record<DrillKind, DrillLevel>>;

/**
 * The levels implied by a server snapshot, folded over the session's own.
 *
 * This is the levels counterpart of `mergeSeededWindows` and exists for a
 * specific reason: it must be computable EAGERLY, outside a `setState`
 * updater. The seeding effect both stores these levels and re-deals the hand
 * on screen with them, and the re-deal reads them synchronously. Building them
 * inside the updater instead — as the first version did — meant React had not
 * run the updater yet when the re-deal fired, so it dealt from an empty object
 * and the first hand of EVERY page load was a level-1 hand, however strong the
 * user's history. The Difficulty tile then jumped to its real value on the
 * first tab switch, which is what made the bug look cosmetic rather than a
 * dead re-deal. Keep this pure and call it before touching state.
 */
export function seededLevels(
  seeded: DrillWindows,
  previous: Levels,
  answeredKinds: Iterable<DrillKind>,
  /**
   * Per-kind floors from the M8.5B placement assessment. A floor, not an
   * override: a player who demonstrated pot odds in placement starts that
   * drill at level 2 instead of grinding level 1, but a player whose actual
   * history says level 3 is never pulled back down to their placement, and a
   * player who has since been demoted by real answers stays demoted — the
   * window is the truth once it exists, placement only sets where it starts.
   *
   * Empty when placement was skipped, never taken, or taken under an older
   * assessment/generator version, which is exactly today's cold start.
   */
  placementFloors: Levels = {}
): Levels {
  const keepLocal = new Set(answeredKinds);
  const levels: Levels = {};
  for (const kind of DRILL_KINDS) {
    if (keepLocal.has(kind)) {
      levels[kind] = previous[kind] ?? 1;
      continue;
    }
    levels[kind] = levelWithPlacementFloor(seeded[kind], placementFloors[kind]);
  }
  return levels;
}

/**
 * One kind's level: the history-derived level, floored by placement.
 *
 * Extracted because it was being derived in TWO places and they disagreed on
 * production. The drill applied the floor, the dashboard did not — so a
 * player finished placement, was told "the drills you answered correctly
 * start one level up", and then saw every drill card reading LVL 1 while the
 * drills themselves opened at level 2. Both callers now go through here.
 *
 * The floor applies only while there is no history to speak of. Once the
 * rolling window has enough answers to move the level on its own, those
 * answers are better evidence than one placement question — so an
 * experienced player is never pulled back down to their placement, and one
 * demoted by real answers stays demoted.
 */
export function levelWithPlacementFloor(
  history: readonly boolean[] = [],
  placementFloor?: DrillLevel
): DrillLevel {
  const fromHistory = levelFromHistory(history);
  const floor = history.length >= MIN_SAMPLE ? 1 : (placementFloor ?? 1);
  return Math.max(fromHistory, floor) as DrillLevel;
}
