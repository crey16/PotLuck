import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/observability/requestId";
import { routeKey } from "@/lib/observability/route";
import { serverLog } from "@/lib/observability/log";

/**
 * The one boundary where a document request gets its id — M8.8A.
 *
 * Middleware is the correct place and the only one. It runs before the render,
 * before any Server Component, and before the auth redirect that may replace
 * the render entirely — so an id minted here is on the request whatever
 * happens to it, including the `/login` bounce that produces no page at all.
 * Minting inside a layout instead would leave every redirect untraceable, and
 * redirects are exactly what a "why is this slow" investigation trips over.
 *
 * The id goes three places, each for a different reader:
 *
 * - **Into the forwarded request headers**, so `lib/observability/serverTiming.ts`
 *   can attach every server read to it, and so `app/layout.tsx` can hand it to
 *   the browser.
 * - **Onto the response**, so it is visible in devtools and pasteable into a
 *   bug report without any tooling at all.
 * - **Into one log line**, with the status and the duration OF THIS MIDDLEWARE
 *   — which is a real cost (it revalidates the session on every request) and
 *   is not the render's cost. The two are never added together anywhere.
 *
 * `x-perf-route` rides along because middleware is also the only layer that
 * reliably knows the pathname; Next's own internal path headers differ across
 * versions and deployments.
 */
export async function middleware(request: NextRequest) {
  const { requestId, trace } = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const route = routeKey(request.nextUrl.pathname);
  const started = performance.now();

  let response: NextResponse;
  try {
    response = await updateSession(request, {
      [REQUEST_ID_HEADER]: requestId,
      "x-perf-route": route,
    });
  } catch (error) {
    serverLog({
      evt: "next.request",
      rid: requestId,
      trace,
      route,
      ms: performance.now() - started,
      error: error instanceof Error ? error.name : "error",
    });
    throw error;
  }

  response.headers.set(REQUEST_ID_HEADER, requestId);
  serverLog({
    evt: "next.request",
    rid: requestId,
    trace,
    route,
    ms: performance.now() - started,
    // Recorded, not assumed. A 307 to /login is a real outcome of a request to
    // `/`, and folding it into `/`'s success distribution would report the
    // signed-out bounce as a fast dashboard.
    status: response.status,
  });
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (FastAPI owns /api/*, including the dev rewrite to uvicorn —
     *   Next middleware must never intercept it)
     * - perf/vitals (the Web Vitals collector; a beacon has no session to
     *   refresh, and running the Supabase auth check on it would make the
     *   measurement endpoint cost more than the thing it measures)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     * - common image extensions
     */
    "/((?!api|perf/vitals|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
