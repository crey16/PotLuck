"use client";

import { useCallback, useEffect, useState } from "react";
import type { Beat } from "@/lib/play/beats";

/**
 * How long to wait before applying beat number `applied`, or null when the
 * queue is drained. Extracted from the hook so the pacing rule is testable
 * without React or fake timers.
 */
export function nextDelay(
  beats: readonly Beat[],
  applied: number,
  reducedMotion: boolean
): number | null {
  if (applied >= beats.length) return null;
  return reducedMotion ? 0 : beats[applied].ms;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface HandDirector {
  /** How many beats have been revealed. The table renders beats[0..applied). */
  applied: number;
  /** True while beats remain — the action bar stays disarmed. */
  playing: boolean;
  /** Drain the queue instantly. */
  skip: () => void;
}

/**
 * A timed cursor over the beat queue — the ONE place timers live.
 *
 * It deliberately holds no game state: the table derives everything from
 * `beats.slice(0, applied)`. That separation between "what has been revealed"
 * and "what has happened" is the whole reason PlayShell needed decomposing.
 *
 * `beats` is cumulative and only ever grows as the hero acts; when it grows,
 * the new tail animates. A new hand replaces it with a shorter queue, which
 * rewinds the cursor.
 */
export function useHandDirector(
  beats: readonly Beat[],
  opts: { reducedMotion?: boolean } = {}
): HandDirector {
  const [applied, setApplied] = useState(0);
  const reduced = opts.reducedMotion ?? prefersReducedMotion();

  // A new hand hands us a shorter queue; rewind so it does not start already
  // "applied". Adjusting state during render is the supported React pattern
  // for "props changed, derived state is stale" — and it is deliberately NOT
  // the banned setState-inside-useEffect, which would paint one frame with the
  // previous hand's cursor before correcting itself.
  if (applied > beats.length) setApplied(beats.length);

  useEffect(() => {
    const delay = nextDelay(beats, applied, reduced);
    if (delay === null) return;
    const timer = setTimeout(() => setApplied((n) => n + 1), delay);
    return () => clearTimeout(timer);
  }, [beats, applied, reduced]);

  const skip = useCallback(() => setApplied(beats.length), [beats.length]);

  return { applied, playing: applied < beats.length, skip };
}
