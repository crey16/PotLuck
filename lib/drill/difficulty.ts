import { DRILL_KINDS, type DrillKind, type DrillLevel } from "./contract";

export const WINDOW_SIZE = 10;
const MIN_SAMPLE = 6;
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
export function levelFromHistory(window: boolean[]): DrillLevel {
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
