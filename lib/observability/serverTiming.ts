import { headers } from "next/headers";
import { REQUEST_ID_HEADER, resolveRequestId, traceOf } from "./requestId";
import { routeKey } from "./route";
import { perfLoggingEnabled, serverLog } from "./log";

/**
 * Timing the server's own reads — M8.8A.
 *
 * ## What this can and cannot measure, stated exactly
 *
 * It measures **named groups of Supabase reads** on the render path. It does
 * NOT measure total Next render time, and no code inside the app can: a Server
 * Component has no hook that fires after the response is flushed, and
 * middleware runs strictly before the render it would need to time. Anyone
 * adding a "render ms" field here would be measuring a subtree and labelling it
 * a page.
 *
 * The honest decomposition this project actually has is therefore:
 *
 *   total document time  ⊇  middleware + render + these read groups
 *
 * with the read groups naming where the render's own waiting went.
 *
 * **TTFB is NOT the top of that containment, and the measured baseline proves
 * it.** `/` streams: its first byte leaves at ~92ms while `dashboard.stats`
 * inside it takes ~128ms. The shell flushes before the page body resolves, so
 * TTFB is "the shell left" and total is "the document arrived" — and a read
 * group can legitimately be longer than the TTFB of the page containing it.
 * Anyone reading TTFB as render time will conclude these timers are lying.
 * Compare read groups against **total**, never against TTFB.
 *
 * The same rule forbids adding a Next duration to a FastAPI one. They are
 * separate requests on separate clocks; the browser is what waits for both,
 * and the browser is what measures the sum.
 *
 * ## One clock
 *
 * `performance.now()` throughout — monotonic, unaffected by NTP steps, and the
 * same clock on both ends of every duration. `Date.now()` appears nowhere in a
 * subtraction in this module: mixing a wall clock into a duration is how a
 * measurement quietly goes negative on a clock adjustment.
 *
 * ## Failure
 *
 * A read group that throws is timed and logged with `error`, then the error is
 * rethrown unchanged. Instrumentation that swallowed an exception would turn a
 * broken page into a slow one, and the caller's own fail-soft behaviour — which
 * several of these readers have — is the caller's decision to make.
 */

/** The request id middleware minted for this request, or a fresh one. */
export async function requestIdFromHeaders(): Promise<{ rid: string; trace: string }> {
  try {
    const headerList = await headers();
    const resolved = resolveRequestId(headerList.get(REQUEST_ID_HEADER));
    return { rid: resolved.requestId, trace: resolved.trace };
  } catch {
    // `headers()` throws outside a request scope (a unit test, a build-time
    // prerender). An unjoined id is better than an exception from a timer.
    const resolved = resolveRequestId(null);
    return { rid: resolved.requestId, trace: resolved.trace };
  }
}

async function currentRoute(): Promise<string> {
  try {
    const headerList = await headers();
    // Next sets `x-invoke-path` / `next-url` inconsistently across versions and
    // deployments, so the pathname middleware stamped explicitly is preferred
    // and the rest are fallbacks. All three go through `routeKey`, so an
    // unexpected value becomes `/other` rather than a raw URL.
    return routeKey(
      headerList.get("x-perf-route") ??
        headerList.get("next-url") ??
        headerList.get("x-invoke-path")
    );
  } catch {
    return "/other";
  }
}

/**
 * Time one named group of server reads.
 *
 * `name` must be a literal at the call site — it is a log key, and a computed
 * one would grow the key space without bound.
 */
export async function timeServerRead<T>(name: string, run: () => Promise<T>): Promise<T> {
  // Checked first, and the whole wrapper is skipped when logging is off. With
  // `PERF_LOG` unset in production this adds one boolean read to each call
  // site and nothing else — instrumentation a team leaves permanently in place
  // must be free when it is not collecting.
  if (!perfLoggingEnabled()) return run();

  // Resolved BEFORE the timed work, not in the `finally`. `headers()` is async,
  // so awaiting it after the result is in hand would put two microtask turns
  // between the read finishing and the caller receiving it — the instrument
  // adding latency to the thing it measures.
  const [{ rid, trace }, route] = await Promise.all([
    requestIdFromHeaders(),
    currentRoute(),
  ]);

  const started = performance.now();
  try {
    const result = await run();
    serverLog({ evt: "next.read", rid, trace, route, name, ms: performance.now() - started });
    return result;
  } catch (error) {
    serverLog({
      evt: "next.read",
      rid,
      trace,
      route,
      name,
      ms: performance.now() - started,
      error: error instanceof Error ? error.name : "error",
    });
    // Rethrown unchanged: a timer that swallowed this would turn a broken page
    // into a slow one, and several callers here fail soft on purpose — that is
    // their decision, not the instrument's.
    throw error;
  }
}

export { traceOf };
