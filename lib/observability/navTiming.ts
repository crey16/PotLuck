"use client";

/**
 * Client-side route-transition timing — M8.8A.
 *
 * ## The distinction this file exists to keep
 *
 * A **client route transition** is not a server response time and is not a
 * document load. It is the interval between someone committing to a
 * destination and that destination being on screen, and in the App Router it
 * spans an RSC fetch, a React transition, and a paint. Reporting a server
 * duration under this name would be the single most misleading thing this
 * milestone could ship, so start and end are captured from the browser's own
 * clock and nothing else touches them.
 *
 * ## Start: the commit, not the render
 *
 * A capture-phase `click` on the document, resolved to the nearest `<a href>`.
 * Capture phase so the measurement starts before any handler can
 * `stopPropagation`, and before the router itself begins work.
 *
 * Modified clicks (⌘/ctrl/shift/alt, middle button), `target="_blank"`,
 * `download`, and cross-origin hrefs are all ignored — none of them produce an
 * in-page transition, and timing one would leave a pending measurement that
 * later attaches itself to an unrelated navigation.
 *
 * `popstate` starts a measurement too, with an unknown destination: back and
 * forward are transitions people wait on exactly as much as clicks.
 *
 * ## End: the destination is on screen
 *
 * `usePathname()` changing tells us React committed the new route. Commit is
 * not paint, so `finish()` is called from a double `requestAnimationFrame`:
 * the first callback runs before the next paint, the second after it. **This
 * is a documented proxy, not an exact signal** — the App Router exposes no
 * "this navigation is complete" event, and a route that streams in a Suspense
 * boundary (`/`'s recommendation, for one) is interactive at this moment with
 * content still arriving behind it. So the number means *"the destination
 * route's shell was painted"*, which is the same thing every entry in the
 * budget table is held to, and the report says so in those words.
 *
 * ## Why nothing here uses a timeout to decide success
 *
 * A `setTimeout(measure, 400)` would report 400ms for every navigation,
 * including the ones that took 40 and the ones that never arrived. The only
 * timer here is `MAX_PENDING_MS`, and it does the opposite job: it DISCARDS a
 * measurement that never completed, so an abandoned navigation is missing from
 * the data rather than present as a fast one.
 *
 * ## Outcomes, so a redirect is never a success
 *
 * If the pathname that arrives is not the one that was clicked, the transition
 * is recorded as `redirected`. `/` bounces a brand-new account to `/placement`
 * and middleware bounces signed-out requests to `/login`; both are real, both
 * are slower than the page they were aiming at, and pooling them into the
 * destination's distribution would report the bounce as the dashboard.
 */

import { startNavigationTrace } from "./clientTrace";

/** A navigation still in flight after this is treated as abandoned. */
export const MAX_PENDING_MS = 30_000;

export interface PendingNavigation {
  /** Destination pathname, or null for back/forward where it is unknown. */
  to: string | null;
  from: string;
  startedAt: number;
  trace: string;
}

let pending: PendingNavigation | null = null;

/**
 * Whether a click should start a measurement, and where it is going.
 *
 * Pure, and exported, because every rule above is a condition that is easy to
 * get subtly wrong and impossible to test through a real DOM event.
 */
export function navigationTarget(
  event: {
    defaultPrevented: boolean;
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  },
  anchor: { href: string; target: string; hasDownload: boolean } | null,
  origin: string,
  currentPath: string
): string | null {
  if (!anchor) return null;
  if (event.defaultPrevented) return null;
  // Only an unmodified primary click navigates this tab.
  if (event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (anchor.hasDownload) return null;
  if (anchor.target && anchor.target !== "_self") return null;

  let url: URL;
  try {
    // Resolved against the CURRENT page, not the bare origin. A bare origin
    // makes `#section` resolve to `/`, so an in-page anchor on `/learn` would
    // look like a navigation to the dashboard and open a measurement that
    // never closes.
    url = new URL(anchor.href, origin + currentPath);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  // Same pathname means no pathname change, so the end signal never fires and
  // the measurement would sit there until it timed out — or worse, attach
  // itself to whatever the person clicked next.
  if (url.pathname === currentPath) return null;
  return url.pathname;
}

/**
 * Begin timing. A second start replaces the first: the person changed their
 * mind mid-navigation, the abandoned one has no meaningful end, and keeping it
 * would mean attributing the new destination's arrival to the old click.
 */
export function beginNavigation(to: string | null, from: string, now: number): void {
  pending = { to, from, startedAt: now, trace: startNavigationTrace() };
}

export interface CompletedNavigation {
  route: string;
  ms: number;
  outcome: "rendered" | "redirected";
  trace: string;
}

/**
 * Close a measurement against the pathname that actually arrived, or return
 * null when there is nothing to close or it has expired.
 */
export function completeNavigation(
  arrivedAt: string,
  now: number
): CompletedNavigation | null {
  const current = pending;
  pending = null;
  if (!current) return null;
  if (arrivedAt === current.from) return null;
  const ms = now - current.startedAt;
  // Expired: report nothing. A navigation that took longer than half a minute
  // was almost certainly a backgrounded tab, and admitting it into the sample
  // would move a p95 by more than any real regression ever could.
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_PENDING_MS) return null;
  return {
    route: arrivedAt,
    ms,
    outcome:
      current.to === null || current.to === arrivedAt ? "rendered" : "redirected",
    trace: current.trace,
  };
}

/** Drop any in-flight measurement — used on `pagehide`. */
export function abandonNavigation(): void {
  pending = null;
}

/** Test seam. */
export function __pendingForTest(): PendingNavigation | null {
  return pending;
}
