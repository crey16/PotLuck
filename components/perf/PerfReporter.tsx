"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { adoptTrace } from "@/lib/observability/clientTrace";
import { enqueue, flush } from "@/lib/observability/report";
import {
  abandonNavigation,
  beginNavigation,
  completeNavigation,
  navigationTarget,
} from "@/lib/observability/navTiming";

/**
 * The browser's measurement wiring — M8.8A.
 *
 * Rendered once from the root layout, returns no DOM, and does three things:
 *
 * 1. **Adopts the document's trace**, so every subsequent API call from this
 *    page carries the request id middleware minted for the page itself. This
 *    is the only mechanism joining browser, Next and FastAPI lines — after
 *    M8.8C there is no server-to-server hop that could carry the id instead.
 * 2. **Times client route transitions** (see `lib/observability/navTiming.ts`
 *    for what start and end actually mean).
 * 3. **Loads the Web Vitals collector after hydration**, never before.
 *
 * ## The bundle rule this component is built around
 *
 * M8.8C took 63.5 kB gzipped of Supabase SDK off first paint. A monitoring
 * feature that put a few kB back on every route would be spending the
 * milestone's result to observe it. So `VitalsCollector` — the only part with
 * a real dependency, Next's compiled web-vitals — is behind `next/dynamic`
 * with `ssr: false`, which puts it in its own chunk that no route's initial set
 * references. Deferring costs nothing in accuracy: web-vitals observes with
 * `buffered: true`, so metrics from before it attached are replayed.
 *
 * What remains in the shared bundle is this file plus three small pure modules,
 * measured in `docs/17-m88a-performance-baseline.md` rather than estimated.
 *
 * ## Ordering
 *
 * `adoptTrace` runs in a layout effect-free `useEffect` that has no
 * dependencies, so it lands on the first commit — before any drill or lesson
 * effect gets far enough to issue an authenticated fetch. A fetch that somehow
 * beats it mints its own trace rather than sending none.
 */

const VitalsCollector = dynamic(
  () => import("./VitalsCollector").then((m) => m.VitalsCollector),
  { ssr: false }
);

export function PerfReporter({ requestId }: { requestId: string | null }) {
  const pathname = usePathname();
  // The pathname the last completed measurement ended on. Compared during the
  // pathname effect so the first render — which is a document load, not a
  // transition — never closes a measurement that was never opened.
  const settled = useRef(pathname);

  useEffect(() => {
    adoptTrace(requestId);
  }, [requestId]);

  // Start: a real in-page navigation.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      const anchor =
        target instanceof Element ? target.closest("a[href]") : null;
      const to = navigationTarget(
        event,
        anchor instanceof HTMLAnchorElement
          ? {
              href: anchor.getAttribute("href") ?? "",
              target: anchor.target,
              hasDownload: anchor.hasAttribute("download"),
            }
          : null,
        window.location.origin,
        window.location.pathname
      );
      if (to !== null) beginNavigation(to, window.location.pathname, performance.now());
    };
    const onPopState = () => {
      // Destination unknown until the router settles — recorded as such, so
      // back/forward can never be scored as a redirect.
      beginNavigation(null, window.location.pathname, performance.now());
    };
    // A page being torn down mid-navigation has no end signal. Dropping the
    // measurement leaves a gap; keeping it would leave a fabricated duration.
    const onPageHide = () => {
      abandonNavigation();
      flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // End: the destination committed. Measured after the next paint.
  useEffect(() => {
    if (settled.current === pathname) return;
    settled.current = pathname;
    let cancelled = false;
    // Two frames: the first callback runs before the next paint, the second
    // after it. A single frame would stop the clock on commit, which is
    // earlier than anything a person can see.
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const done = completeNavigation(pathname, performance.now());
        if (!done) return;
        enqueue({
          kind: "nav",
          route: done.route,
          ms: done.ms,
          outcome: done.outcome,
          requestId: done.trace,
        });
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [pathname]);

  return <VitalsCollector />;
}
