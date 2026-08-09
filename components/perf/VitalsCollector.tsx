"use client";

import { useReportWebVitals } from "next/web-vitals";
import { usePathname } from "next/navigation";
import { enqueue } from "@/lib/observability/report";
import { currentTraceId } from "@/lib/observability/clientTrace";
import { VITAL_NAMES, type VitalName } from "@/lib/observability/webVitals";

const KNOWN: ReadonlySet<string> = new Set(VITAL_NAMES);

/**
 * Core Web Vitals, from Next's own bundled library — M8.8A.
 *
 * `useReportWebVitals` comes from `next/web-vitals`, which is part of the
 * framework already installed here. **No analytics SDK is added for this
 * milestone**, which was a hard requirement: the whole point of M8.8C's bundle
 * work was to get 64 kB of Supabase off first paint, and paying it back in
 * telemetry would be a net loss dressed as a measurement.
 *
 * This component is loaded through `next/dynamic` with `ssr: false` from
 * `PerfReporter`, so the compiled web-vitals chunk is NOT in any route's
 * initial JS — it is fetched after hydration. That is safe for every metric
 * because web-vitals registers its `PerformanceObserver`s with
 * `buffered: true`: entries the browser recorded before this code ran are
 * replayed to the observer rather than lost. LCP and FCP therefore report the
 * real values even though the observer attached late, and TTFB is read from
 * the navigation entry, which persists for the life of the document.
 *
 * `route` is `usePathname()`, not `location.href`: the pathname alone, run
 * through `routeKey()` on the server, so no query string and no `/u/<someone>`
 * ever reaches the collector.
 */
export function VitalsCollector() {
  const pathname = usePathname();

  useReportWebVitals((metric) => {
    if (!KNOWN.has(metric.name)) return;
    enqueue({
      name: metric.name as VitalName,
      route: pathname,
      value: metric.value,
      rating: metric.rating,
      requestId: currentTraceId(),
    });
  });

  return null;
}
