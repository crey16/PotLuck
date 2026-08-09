import { NextResponse, type NextRequest } from "next/server";
import { MAX_BODY_BYTES, parseBeaconBody, RateLimiter } from "@/lib/observability/beacon";
import { serverLog } from "@/lib/observability/log";
import { resolveRequestId, traceOf } from "@/lib/observability/requestId";

/**
 * The Web Vitals collector — M8.8A.
 *
 * ## Why it lives at `/perf/vitals` and not under `/api`
 *
 * `next.config.ts` rewrites **every** `/api/:path*` to the Python function.
 * A Next route handler under `/api` would therefore never run; the request
 * would reach FastAPI, which has no such route, and 404. This is the same
 * constraint that shapes the rest of the app's routing, and the reason the
 * middleware matcher has to exclude this path by name.
 *
 * ## Why it is not authenticated
 *
 * TTFB and LCP for `/login` are produced by people who are not signed in, and
 * those are the first numbers any visitor generates. Requiring a session would
 * leave the app's front door permanently unmeasured. The cost of that choice is
 * that the body is attacker-controlled, which is why every field goes through
 * `lib/observability/beacon.ts` before anything is written.
 *
 * ## Why the response is always 204
 *
 * A rejected payload, a rate-limited caller and a perfect batch all get the
 * same empty answer. Differentiated errors would make this a probing oracle —
 * "which of my fields was wrong", "am I over the limit yet" — and buy nothing,
 * because `sendBeacon` cannot read a response body at all.
 *
 * ## Runtime
 *
 * Node, not Edge. The rate limiter holds state in module memory, and Edge
 * instances are both more numerous and shorter-lived, so the per-instance
 * bucket would be even weaker there. It is weak here too — see the honest
 * limits note in `beacon.ts`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 120 beacons per minute per caller. A real page load sends one to three; the
 * limit is generous enough that a fast tab-switching session never trips it,
 * and low enough that a looping client fills nothing.
 */
const limiter = new RateLimiter(120, 60_000);

/**
 * Empty, no body, no header that says why. Built per call rather than shared:
 * a `Response` is single-use in the Web streams model, and handing the same
 * instance to two concurrent requests is a bug that only appears under load —
 * which is precisely when this endpoint is busiest.
 */
const accepted = () => new NextResponse(null, { status: 204 });

function callerKey(request: NextRequest): string {
  // `x-forwarded-for`'s first entry is what Vercel puts the client address in.
  // Spoofable by anything talking to the origin directly, which is why the
  // limiter also caps its own key count — see `RateLimiter.allow`.
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  // Truncated so a long header cannot become a long map key.
  return (first || "unknown").slice(0, 45);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!limiter.allow(callerKey(request))) return accepted();

  // Checked before reading. `content-length` is advisory, so the text is
  // length-checked again in `parseBeaconBody` — this only avoids buffering a
  // body that has already announced itself as too large.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return accepted();

  let text: string;
  try {
    text = await request.text();
  } catch {
    return accepted();
  }

  const entries = parseBeaconBody(text);
  for (const entry of entries) {
    // The browser's own request id when it had one, else an id minted here.
    // Minting keeps the line joinable to nothing rather than joinable to the
    // wrong thing, and `resolveRequestId` re-validates even though `beacon.ts`
    // already did — this is the boundary that owns the log key.
    const { requestId, trace } = resolveRequestId(entry.requestId);
    if ("kind" in entry) {
      serverLog({
        evt: "web.nav",
        rid: requestId,
        trace: traceOf(requestId),
        route: entry.route,
        ms: entry.ms,
        name: entry.outcome,
      });
    } else {
      // CLS is unitless, the other five are milliseconds — so the duration
      // goes in `ms` and CLS goes in `value`. One field for both would put a
      // 0.04 layout score in the same column as a 400ms TTFB.
      const isDuration = entry.name !== "CLS";
      serverLog({
        evt: "web.vital",
        rid: requestId,
        trace,
        route: entry.route,
        name: entry.name,
        ms: isDuration ? entry.value : undefined,
        value: isDuration ? undefined : entry.value,
      });
    }
  }

  return accepted();
}
