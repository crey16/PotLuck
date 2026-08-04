import type { NewPlayerRouting } from "../placement/server";

/**
 * The "start with the lessons" nudge's cookie and its decision rule.
 *
 * These live here, outside any `"use client"` module, precisely because BOTH
 * sides need them: the server component decides whether to render during SSR,
 * the dismiss button writes the cookie in the browser. Exporting them from the
 * client component instead type-checks, lints and builds clean, then fails at
 * request time with "Attempted to call parseNudgeDismissed() from the server" —
 * exactly the trap `lib/drill/oppMode.ts` documents and
 * `components/drill/clientBoundary.test.ts` exists to catch.
 *
 * A cookie rather than localStorage for the same reason as the opponent mode:
 * localStorage is unreadable during SSR, so the banner would render on the
 * server for a player who had already dismissed it and then vanish on hydration
 * — a flash on every single page load.
 */
export const NUDGE_DISMISSED_COOKIE = "hcwk_nudge";

/** Parse the dismissal out of a raw cookie value. Anything else means "show". */
export function parseNudgeDismissed(value: string | undefined): boolean {
  return value === "1";
}

export type NudgeKind = "finish-placement" | "start-lessons";

export interface Nudge {
  kind: NudgeKind;
  href: string;
  title: string;
  body: string;
  cta: string;
}

const NUDGES: Record<NudgeKind, Nudge> = {
  // The M8.5B dead-end recovery. PlacementPlayer writes its assessment row on
  // mount, so someone who abandons the assessment halfway has a row, is no
  // longer "new" to the router, and has nothing else pointing them back.
  "finish-placement": {
    kind: "finish-placement",
    href: "/placement",
    title: "You left your placement half-finished.",
    body:
      "Nine quick questions decide where your lessons start and how hard your " +
      "first drills are. Picking it back up takes a couple of minutes.",
    cta: "Finish placement",
  },
  "start-lessons": {
    kind: "start-lessons",
    href: "/learn",
    title: "New here? Start with the lessons.",
    body:
      "The drills assume the material the course teaches — they are for making " +
      "a decision automatic, not for learning it the first time.",
    cta: "Open the course",
  },
};

/**
 * Which nudge to show, if any.
 *
 * Null means show nothing: the player has a lesson behind them, has dismissed
 * it, or the routing read failed and fell back to its safe "established
 * player" default.
 */
export function nudgeFor(
  routing: Pick<NewPlayerRouting, "status" | "hasStartedLearning">,
  dismissed: boolean,
): Nudge | null {
  if (dismissed) return null;
  // A lesson behind them silences everything, including an abandoned
  // placement. They found the course on their own; placement no longer changes
  // where they start, so raising it at that point is pure noise.
  if (routing.hasStartedLearning) return null;
  // Among players who have not started, an unfinished assessment is the more
  // specific problem and finishing it changes where the lessons begin.
  if (routing.status === "in_progress") return NUDGES["finish-placement"];
  return NUDGES["start-lessons"];
}
